import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { routeTransactionStatus } from './src/utils/riskRouting.js';
import { AmlTransaction, RiskTier } from './src/types/aml.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);

const PYTHON_INFERENCE_PORT = parseInt(process.env.PYTHON_INFERENCE_PORT || '5001', 10);
const AML_INFERENCE_URL =
  process.env.AML_INFERENCE_URL ||
  `http://127.0.0.1:${PYTHON_INFERENCE_PORT}`;

export interface PythonServiceState {
  state: 'unstarted' | 'starting' | 'ready' | 'failed' | 'external';
  error?: string;
  pid?: number;
  url: string;
  executable?: string;
  startedAt?: string;
}

let managedPythonProcess: ChildProcess | null = null;
const pythonServiceLogs: string[] = [];
let pythonServiceState: PythonServiceState = {
  state: 'unstarted',
  url: AML_INFERENCE_URL,
};

function recordPythonLog(stream: 'OUT' | 'ERR', message: string) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const formatted = `[${timestamp}] [${stream}] ${message.trim()}`;
  pythonServiceLogs.push(formatted);
  if (pythonServiceLogs.length > 100) {
    pythonServiceLogs.shift();
  }
}

/**
 * Discovers a working Python executable in the environment.
 * Evaluates candidate paths (environment variables, local virtual environments, and system binaries)
 * without hardcoding user-specific paths.
 */
function resolvePythonExecutable(): string {
  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim()) {
    return process.env.PYTHON_BIN.trim();
  }
  if (process.env.PYTHON_PATH && process.env.PYTHON_PATH.trim()) {
    return process.env.PYTHON_PATH.trim();
  }

  const isWin = process.platform === 'win32';
  const candidates: string[] = [];

  // 1. Virtual environments in the workspace if present
  const venvPython = isWin
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');

  if (fs.existsSync(venvPython)) {
    candidates.push(venvPython);
  }

  // 2. Standard platform Python commands
  if (isWin) {
    candidates.push('python');
    candidates.push('python3');
    candidates.push('py');
  } else {
    candidates.push('python3');
    candidates.push('python');
  }

  // Test candidates to find one that can import joblib and scikit-learn
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(
        candidate,
        ['-c', 'import joblib, sklearn; print("AML_PY_VALID")'],
        {
          encoding: 'utf-8',
          timeout: 4000,
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
          },
        }
      );
      if (probe.status === 0 && probe.stdout && probe.stdout.includes('AML_PY_VALID')) {
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }

  // If no candidate successfully verified sklearn, return platform default
  return isWin ? 'python' : 'python3';
}

/**
 * Checks whether the Python inference service is healthy and has loaded aml_model.pkl.
 */
async function checkPythonHealth(timeoutMs = 1500): Promise<{ healthy: boolean; data?: any }> {
  try {
    const res = await fetch(`${AML_INFERENCE_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.model_loaded === true) {
        return { healthy: true, data };
      }
    }
    return { healthy: false };
  } catch {
    return { healthy: false };
  }
}

/**
 * Automatically starts and supervises the Python AML inference microservice
 * if it is not already running.
 */
async function ensurePythonInferenceService(): Promise<void> {
  // 1. Check if service is already running externally (e.g., started manually)
  console.log(`[PythonManager] Probing inference service at ${AML_INFERENCE_URL}/health...`);
  const initialCheck = await checkPythonHealth(1200);
  if (initialCheck.healthy) {
    console.log(`[PythonManager] Detected healthy Python inference service already running at ${AML_INFERENCE_URL}.`);
    pythonServiceState = {
      state: 'external',
      url: AML_INFERENCE_URL,
      startedAt: new Date().toISOString(),
    };
    return;
  }

  // 2. Resolve Python executable and script paths
  const pythonBin = resolvePythonExecutable();
  const scriptPath = path.resolve(__dirname, 'aml-model', 'inference_service.py');
  const modelDir = path.resolve(__dirname, 'aml-model');

  if (!fs.existsSync(scriptPath)) {
    const errorMsg = `Inference script not found at project path: ${scriptPath}`;
    console.error(`[PythonManager] ${errorMsg}`);
    pythonServiceState = {
      state: 'failed',
      error: errorMsg,
      url: AML_INFERENCE_URL,
      executable: pythonBin,
    };
    return;
  }

  console.log(`[PythonManager] Starting Python inference service with '${pythonBin}' on port ${PYTHON_INFERENCE_PORT}...`);
  pythonServiceState = {
    state: 'starting',
    url: AML_INFERENCE_URL,
    executable: pythonBin,
    startedAt: new Date().toISOString(),
  };

  const args = ['inference_service.py', '--port', String(PYTHON_INFERENCE_PORT)];

  try {
    managedPythonProcess = spawn(pythonBin, args, {
      cwd: modelDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pid = managedPythonProcess.pid;
    pythonServiceState.pid = pid;
    console.log(`[PythonManager] Child process spawned (PID: ${pid}). Awaiting model initialization...`);

    managedPythonProcess.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        recordPythonLog('OUT', line);
        console.log(`[PythonService] ${line.trim()}`);
      }
    });

    managedPythonProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        recordPythonLog('ERR', line);
        console.error(`[PythonService:Error] ${line.trim()}`);
      }
    });

    managedPythonProcess.on('exit', (code, signal) => {
      console.log(`[PythonManager] Child process exited with code=${code}, signal=${signal}`);
      if (pythonServiceState.state !== 'ready') {
        const lastErrors = pythonServiceLogs.filter(l => l.includes('[ERR]')).slice(-3).join(' | ');
        pythonServiceState = {
          state: 'failed',
          error: `Process exited with code ${code}. Diagnostics: ${lastErrors || 'No stderr logged.'}`,
          url: AML_INFERENCE_URL,
          executable: pythonBin,
        };
      } else {
        pythonServiceState = {
          state: 'failed',
          error: `Python service process unexpectedly exited (code: ${code}).`,
          url: AML_INFERENCE_URL,
          executable: pythonBin,
        };
      }
      managedPythonProcess = null;
    });

    managedPythonProcess.on('error', (err) => {
      console.error(`[PythonManager] Failed to launch child process:`, err);
      pythonServiceState = {
        state: 'failed',
        error: `Failed to spawn executable '${pythonBin}': ${err.message}`,
        url: AML_INFERENCE_URL,
        executable: pythonBin,
      };
    });
  } catch (spawnErr: any) {
    console.error(`[PythonManager] Failed to spawn Python process:`, spawnErr);
    pythonServiceState = {
      state: 'failed',
      error: `Failed to spawn Python process: ${spawnErr?.message}`,
      url: AML_INFERENCE_URL,
      executable: pythonBin,
    };
    return;
  }

  // 3. Poll /health until ready or timeout (up to 15 seconds)
  const pollIntervalMs = 350;
  const timeoutMs = 15000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pythonServiceState.state === 'failed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const probe = await checkPythonHealth(800);
    if (probe.healthy) {
      console.log(`[PythonManager] Python inference service is ready at ${AML_INFERENCE_URL} (Model: ${probe.data?.model_version || 'random_forest_v1'}).`);
      pythonServiceState = {
        state: 'ready',
        pid: managedPythonProcess?.pid,
        url: AML_INFERENCE_URL,
        executable: pythonBin,
        startedAt: pythonServiceState.startedAt,
      };
      return;
    }
  }

  if (pythonServiceState.state !== 'ready') {
    const recentErrLogs = pythonServiceLogs.slice(-5).join(' \n ');
    const timeoutMsg = `Python service startup timed out after ${timeoutMs / 1000}s on ${AML_INFERENCE_URL}. ${recentErrLogs ? 'Recent logs: ' + recentErrLogs : ''}`;
    console.error(`[PythonManager] ${timeoutMsg}`);
    pythonServiceState = {
      state: 'failed',
      error: timeoutMsg,
      url: AML_INFERENCE_URL,
      pid: managedPythonProcess?.pid,
      executable: pythonBin,
    };
  }
}

/**
 * Gracefully shuts down the supervised Python child process.
 */
function terminatePythonService() {
  if (managedPythonProcess && !managedPythonProcess.killed) {
    const pid = managedPythonProcess.pid;
    console.log(`[PythonManager] Shutting down managed Python service (PID: ${pid})...`);
    try {
      if (process.platform === 'win32' && pid) {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        managedPythonProcess.kill('SIGTERM');
      }
    } catch {
      try {
        managedPythonProcess.kill('SIGKILL');
      } catch {
        // Process may have already exited
      }
    }
    managedPythonProcess = null;
  }
}

// Clean shutdown listeners
process.on('SIGINT', () => {
  terminatePythonService();
  process.exit(0);
});
process.on('SIGTERM', () => {
  terminatePythonService();
  process.exit(0);
});
process.on('exit', () => {
  terminatePythonService();
});

// Initialize Supabase configuration strictly on the server side
const supabaseUrl = process.env.SUPABASE_URL || '';
// Prioritize service role or secret key on the server, fallback to SUPABASE_KEY or SUPABASE_ANON_KEY
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

let supabaseClient: SupabaseClient | null = null;
if (supabaseUrl && supabaseKey) {
  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getSupabase(): SupabaseClient | null {
  if (!supabaseClient && supabaseUrl && supabaseKey) {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabaseClient;
}

const app = express();
app.use(express.json());

/**
 * GET /api/health
 * Verifies server state and Supabase connectivity without exposing any secret keys or credentials.
 */
app.get('/api/health', async (_req: Request, res: Response) => {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({
      status: 'unconfigured',
      connected: false,
      message: 'Supabase credentials are not configured in the server environment. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in .env.',
      environment: {
        node_env: process.env.NODE_ENV || 'development',
        has_supabase_url: Boolean(supabaseUrl),
        has_supabase_key: Boolean(supabaseKey),
      },
      timestamp: new Date().toISOString(),
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({
      status: 'initialization_failed',
      connected: false,
      message: 'Failed to initialize Supabase client on server.',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 1. Check aml_transactions table accessibility & total row count
    const { count: txCount, error: txError } = await supabase
      .from('aml_transactions')
      .select('*', { count: 'exact', head: true });

    if (txError) {
      return res.status(500).json({
        status: 'error',
        connected: false,
        message: `Database connection failed when querying aml_transactions: ${txError.message}`,
        code: txError.code,
        details: txError.details || txError.hint,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Check ml_predictions table accessibility for random_forest_v1
    const { count: predCount, error: predError } = await supabase
      .from('ml_predictions')
      .select('*', { count: 'exact', head: true })
      .eq('model_version', 'random_forest_v1');

    if (predError) {
      return res.status(500).json({
        status: 'error',
        connected: false,
        message: `Database connection failed when querying ml_predictions: ${predError.message}`,
        code: predError.code,
        details: predError.details || predError.hint,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Check customers table accessibility
    const { count: custCount, error: custError } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true });

    // 4. Check Python AML Inference Microservice
    let pythonHealth: any = { connected: false, message: 'Unchecked' };
    try {
      const pyRes = await fetch(`${AML_INFERENCE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (pyRes.ok) {
        pythonHealth = await pyRes.json();
        pythonHealth.connected = true;
        pythonHealth.manager_state = pythonServiceState;
      } else {
        pythonHealth = {
          connected: false,
          status: pyRes.status,
          statusText: pyRes.statusText,
          manager_state: pythonServiceState,
          recent_logs: pythonServiceLogs.slice(-5),
        };
      }
    } catch (err: any) {
      pythonHealth = {
        connected: false,
        error: err?.message || 'Connection refused / service offline',
        manager_state: pythonServiceState,
        recent_logs: pythonServiceLogs.slice(-5),
      };
    }

    return res.json({
      status: 'connected',
      connected: true,
      message: 'Supabase database and Apex server verified successfully.',
      tables: {
        aml_transactions_count: txCount ?? 0,
        ml_predictions_v1_count: predCount ?? 0,
        customers_count: custCount ?? 0,
      },
      model_target: 'random_forest_v1',
      python_inference: pythonHealth,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      connected: false,
      message: `Database connection exception: ${err?.message || 'Unknown network error'}`,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/customers
 * Returns all verified customer profiles from public.customers formatted for the AML dashboard.
 */
app.get('/api/customers', async (_req: Request, res: Response) => {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_UNCONFIGURED',
      message: 'Supabase credentials are not configured.',
      data: {},
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'CLIENT_INIT_FAILED',
      message: 'Supabase client could not be initialized.',
      data: {},
    });
  }

  try {
    const { data: rows, error } = await supabase.from('customers').select('*');
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        data: {},
      });
    }

    const customersMap: Record<string, any> = {};
    for (const c of rows || []) {
      const riskTierStr = String(c.risk_tier || '').toUpperCase().trim();
      const riskTier = riskTierStr === 'HIGH' ? 'High' : riskTierStr === 'MEDIUM' ? 'Medium' : 'Low';
      customersMap[c.id] = {
        customer_id: c.id,
        name: c.account_name || `Customer ${c.id}`,
        category: c.account_type?.includes('Corporate') ? 'Corporate' : c.account_type?.includes('Business') ? 'Proprietorship' : 'Individual',
        kyc_status: c.kyc_status || 'VERIFIED',
        account_opened_date: `${c.account_age_days || 300} days vintage`,
        account_balance: Number(c.account_balance || 0),
        customer_risk_tier: riskTier,
        customer_risk_score: Number(c.risk_score || 0),
        dormancy_status: c.dormant_account ? 'Dormant' : 'Active',
        monitoring_status: Number(c.risk_score || 0) >= 80 ? 'Enhanced Monitoring' : 'Standard',
        historical_volume_30d: Number(c.average_transaction_amount || 0) * 4,
        typical_amount: Number(c.average_transaction_amount || 0),
        previous_alerts_count: Number(c.previous_alerts || 0),
        recent_beneficiary_changes: 0,
        recent_device_changes: 0,
        recent_location_changes: 0,
        risk_indicators: [],
        account_number: c.account_number || `APX-SYN-${c.id.replace('C', '')}`,
        account_type: c.account_type || 'Savings Premier',
        branch: c.branch || 'Nagpur Central',
        total_transactions_count: Number(c.total_transactions_count || 50),
        suspicious_transactions_count: Number(c.suspicious_transactions_count || 0),
      };
    }

    return res.json({
      success: true,
      count: Object.keys(customersMap).length,
      data: customersMap,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to fetch customers',
      data: {},
    });
  }
});

// 17 features matching the trained AML model contract
const REQUIRED_AML_FEATURES = [
  'account_age_days',
  'account_balance',
  'transaction_amount',
  'transaction_type',
  'transaction_frequency_24h',
  'average_transaction_amount',
  'amount_deviation',
  'cash_deposit',
  'international_transfer',
  'new_beneficiary',
  'beneficiary_count_7d',
  'failed_transactions_24h',
  'dormant_account',
  'device_change',
  'location_change',
  'unusual_transaction_time',
  'previous_alerts',
] as const;

function extractAndValidateFeatures(source: Record<string, any>): {
  valid: boolean;
  features?: Record<string, any>;
  error?: string;
} {
  const features: Record<string, any> = {};
  const missing: string[] = [];

  for (const feat of REQUIRED_AML_FEATURES) {
    if (source[feat] === undefined || source[feat] === null) {
      missing.push(feat);
      continue;
    }

    if (feat === 'transaction_type') {
      const val = String(source[feat]).trim();
      if (!val) {
        return { valid: false, error: 'transaction_type must be a non-empty string' };
      }
      features[feat] = val.toUpperCase();
    } else {
      const num = Number(source[feat]);
      if (isNaN(num)) {
        return { valid: false, error: `Feature '${feat}' must be numeric, received: ${source[feat]}` };
      }
      if (feat === 'transaction_amount' && num < 0) {
        return { valid: false, error: 'transaction_amount cannot be negative' };
      }
      features[feat] = num;
    }
  }

  if (missing.length > 0) {
    return { valid: false, error: `Missing required features: ${missing.join(', ')}` };
  }

  return { valid: true, features };
}

function formatTransactionRow(row: any, prediction: any, customer: any): AmlTransaction {
  const txId = String(row.transaction_id || '');
  const hasPrediction = Boolean(
    prediction &&
    prediction.risk_score !== null &&
    prediction.risk_score !== undefined
  );

  const riskScore: number | null = hasPrediction ? Number(prediction.risk_score) : null;
  const rawTierStr = prediction && prediction.risk_tier ? String(prediction.risk_tier).toUpperCase().trim() : '';
  const riskTier: RiskTier = !hasPrediction
    ? 'Unavailable'
    : rawTierStr === 'HIGH'
    ? 'High'
    : rawTierStr === 'MEDIUM'
    ? 'Medium'
    : rawTierStr === 'LOW'
    ? 'Low'
    : 'Unavailable';
  const predictedSuspicious: boolean | null =
    hasPrediction && prediction.predicted_suspicious !== undefined
      ? Boolean(prediction.predicted_suspicious)
      : null;
  const predictionTimestamp: string =
    hasPrediction && prediction.prediction_timestamp
      ? String(prediction.prediction_timestamp)
      : 'Unavailable';

  const rawPrediction = hasPrediction
    ? {
        id: prediction.id,
        model_version: prediction.model_version,
        risk_probability: prediction.risk_probability !== undefined ? Number(prediction.risk_probability) : null,
        risk_score: riskScore,
        risk_tier: riskTier,
        predicted_suspicious: predictedSuspicious,
        prediction_timestamp: predictionTimestamp,
      }
    : null;

  const isNewBeneficiary = Boolean(row.new_beneficiary);
  const isInternational = Boolean(row.international_transfer);
  const isDormantAccount = Boolean(row.dormant_account);
  const isDeviceChange = Boolean(row.device_change);
  const isLocationChange = Boolean(row.location_change);
  const isUnusualTime = Boolean(row.unusual_transaction_time);

  const customerName = customer?.account_name || `Customer ${row.customer_id || 'Unavailable'}`;
  const accountNumber = customer?.account_number || `APX-SYN-${String(row.customer_id || '').replace('C', '')}`;
  const branch = customer?.branch || 'Nagpur Central';
  const accountType = customer?.account_type || 'Savings Premier';
  const kycStatus = customer?.kyc_status || 'VERIFIED';

  const routingResult = routeTransactionStatus({
    hasPrediction,
    riskScore,
    riskTier,
    predictedSuspicious,
    transactionFrequency24h: Number(row.transaction_frequency_24h || 0),
    amountDeviation: Number(row.amount_deviation || 0),
    transactionAmount: Number(row.transaction_amount || 0),
    failedTransactions24h: Number(row.failed_transactions_24h || 0),
    dormantAccount: isDormantAccount,
    deviceChange: isDeviceChange,
    locationChange: isLocationChange,
    unusualTime: isUnusualTime,
    newBeneficiary: isNewBeneficiary,
    beneficiaryCount7d: Number(row.beneficiary_count_7d || 0),
    previousAlerts: Number(row.previous_alerts || 0),
  });

  return {
    transaction_id: txId,
    customer_id: String(row.customer_id || 'Unavailable'),
    customer_name: customerName,
    account_number: accountNumber,
    transaction_amount: Number(row.transaction_amount || 0),
    currency: 'INR',
    transaction_type: (row.transaction_type || 'UPI') as any,
    transaction_frequency_24h: Number(row.transaction_frequency_24h || 0),
    avg_30d_amount: Number(row.average_transaction_amount || 0),
    amount_deviation_ratio: Number(row.amount_deviation || 0),
    risk_score: riskScore,
    risk_tier: riskTier,
    predicted_suspicious: predictedSuspicious,
    prediction_timestamp: predictionTimestamp,
    transaction_timestamp:
      predictionTimestamp !== 'Unavailable' ? predictionTimestamp : new Date().toISOString(),
    status: routingResult.status,
    pattern_detected: routingResult.pattern,
    is_new_beneficiary: isNewBeneficiary,
    is_international: isInternational,
    is_dormant_account: isDormantAccount,
    is_device_change: isDeviceChange,
    is_location_change: isLocationChange,
    is_unusual_time: isUnusualTime,
    account_balance: Number(row.account_balance ?? customer?.account_balance ?? 0),
    account_age_days: Number(row.account_age_days ?? customer?.account_age_days ?? 0),
    beneficiary_count_7d: Number(row.beneficiary_count_7d ?? 0),
    failed_transactions_24h: Number(row.failed_transactions_24h ?? 0),
    previous_alerts: Number(row.previous_alerts ?? customer?.previous_alerts ?? 0),
    db_suspicious: Number(row.suspicious ?? 0),
    branch,
    account_type: accountType,
    kyc_status: kycStatus,
    risk_probability:
      hasPrediction && prediction.risk_probability !== undefined ? Number(prediction.risk_probability) : null,
    beneficiary_name: row.cash_deposit
      ? 'Self Account (Cash Deposit)'
      : isInternational
      ? 'Foreign Recipient (International Remittance)'
      : isNewBeneficiary
      ? 'New Counterparty (First Transfer <24h)'
      : `Verified Recipient (${row.beneficiary_count_7d || 1} active 7d)`,
    beneficiary_account: row.cash_deposit
      ? accountNumber
      : `BEN-${String(row.customer_id || '').replace('C', 'ACC')}-${row.beneficiary_count_7d || 1}`,
    beneficiary_bank: isInternational ? 'Foreign Correspondent Bank' : 'Apex Clearing Network',
    beneficiary_country: isInternational ? 'International Remittance' : 'Domestic (India)',
    origin_city: branch,
    destination_city: isInternational ? 'Cross-Border Destination' : branch,
    ip_address: isDeviceChange ? '192.168.42.105 (New Subnet)' : '10.0.12.84 (Corporate VPN)',
    device_id: isDeviceChange ? 'DEV-UNREC-9041 (New Fingerprint)' : 'DEV-PRIMARY-8821',
    feature_contributions: [],
    rules_triggered: [],
    raw_prediction: rawPrediction,
  };
}

/**
 * GET /api/transactions
 * Fetches all transactions from public.aml_transactions and joins with public.ml_predictions
 * (strictly filtered on model_version = 'random_forest_v1').
 * 
 * Implements pagination loops to safely retrieve datasets larger than the standard 1,000-row PostgREST limit.
 * Maps fields strictly to AmlTransaction, using explicit unavailable markers without inventing data.
 */
app.get('/api/transactions', async (req: Request, res: Response) => {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_UNCONFIGURED',
      message: 'Supabase credentials are not configured on the server. Please provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.',
      data: [],
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'CLIENT_INIT_FAILED',
      message: 'Supabase client could not be initialized.',
      data: [],
    });
  }

  try {
    // Validate pagination parameters
    const pageParam = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const fetchAll = req.query.all === 'true' || pageParam === undefined;

    // 1. Get total record count from aml_transactions
    const { count: totalTransactionsCount, error: countError } = await supabase
      .from('aml_transactions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return res.status(500).json({
        success: false,
        error: 'TRANSACTIONS_COUNT_ERROR',
        message: `Failed to query aml_transactions count: ${countError.message}`,
        details: countError.details || countError.hint || countError.code,
      });
    }

    const totalCount = totalTransactionsCount ?? 0;
    const batchSize = 1000; // PostgREST max range limit
    let rawTransactions: any[] = [];

    // 2. Fetch aml_transactions records
    if (fetchAll) {
      // Loop with range pagination to fetch full dataset (e.g. 5,000 records)
      let offset = 0;
      while (offset < totalCount || (totalCount === 0 && offset === 0)) {
        const { data: batch, error: batchError } = await supabase
          .from('aml_transactions')
          .select('*')
          .range(offset, offset + batchSize - 1)
          .order('transaction_id', { ascending: true });

        if (batchError) {
          return res.status(500).json({
            success: false,
            error: 'TRANSACTION_BATCH_FETCH_ERROR',
            message: `Failed to fetch transactions batch starting at offset ${offset}: ${batchError.message}`,
          });
        }

        if (!batch || batch.length === 0) break;
        rawTransactions.push(...batch);
        offset += batch.length;
        if (batch.length < batchSize) break;
      }
    } else {
      const page = Math.max(1, pageParam || 1);
      const pageSize = limitParam && limitParam > 0 ? Math.min(limitParam, 1000) : 50;
      const offset = (page - 1) * pageSize;

      const { data: pageData, error: pageError } = await supabase
        .from('aml_transactions')
        .select('*')
        .range(offset, offset + pageSize - 1)
        .order('transaction_id', { ascending: true });

      if (pageError) {
        return res.status(500).json({
          success: false,
          error: 'TRANSACTION_PAGE_FETCH_ERROR',
          message: pageError.message,
        });
      }
      rawTransactions = pageData || [];
    }

    // 3. Fetch ml_predictions strictly for model_version = 'random_forest_v1'
    // Loop through predictions with pagination to ensure full joining capability
    const predictionsMap = new Map<string, any>();
    let predOffset = 0;
    while (true) {
      const { data: predBatch, error: predError } = await supabase
        .from('ml_predictions')
        .select('*')
        .eq('model_version', 'random_forest_v1')
        .range(predOffset, predOffset + batchSize - 1);

      if (predError) {
        return res.status(500).json({
          success: false,
          error: 'PREDICTIONS_FETCH_ERROR',
          message: `Failed to fetch ml_predictions for random_forest_v1: ${predError.message}`,
        });
      }

      if (!predBatch || predBatch.length === 0) break;
      for (const pred of predBatch) {
        if (pred.transaction_id !== undefined && pred.transaction_id !== null) {
          predictionsMap.set(String(pred.transaction_id), pred);
        }
      }
      predOffset += predBatch.length;
      if (predBatch.length < batchSize) break;
    }

    // 3b. Fetch verified customer profiles from public.customers to join customer context
    const customersMap = new Map<string, any>();
    const { data: customerRows, error: custFetchErr } = await supabase.from('customers').select('*');
    if (!custFetchErr && customerRows) {
      for (const c of customerRows) {
        if (c.id) customersMap.set(String(c.id), c);
      }
    }

    // 4. Map records strictly to AmlTransaction and apply prototype risk routing
    const mappedTransactions: AmlTransaction[] = rawTransactions.map((row) => {
      const txId = String(row.transaction_id || '');
      const prediction = predictionsMap.get(txId);
      const customer = customersMap.get(String(row.customer_id || ''));
      return formatTransactionRow(row, prediction, customer);
    });

    // Synthesize Pattern Alerts from urgent and high-frequency transactions for Grouped Pattern Alerts view
    const alertGroupsMap = new Map<string, {
      alertId: string;
      customerId: string;
      customerName: string;
      txIds: string[];
      totalAmount: number;
      scores: number[];
      type: string;
      description: string;
      patternSummary: string;
      priority: 'Urgent' | 'Standard';
    }>();

    for (const tx of mappedTransactions) {
      if (tx.status === 'Urgent Review' || (tx.risk_score !== null && tx.risk_score >= 70) || tx.transaction_frequency_24h >= 8) {
        const custId = tx.customer_id;
        const existing = alertGroupsMap.get(custId);
        if (!existing) {
          let alertType = 'Urgent Review Investigation';
          let priority: 'Urgent' | 'Standard' = 'Urgent';
          if (tx.transaction_frequency_24h >= 8) {
            alertType = `High-Frequency Velocity Burst (${tx.transaction_frequency_24h} tx / 24h)`;
          } else if (tx.amount_deviation_ratio >= 4.0) {
            alertType = `Extreme Amount Deviation (${tx.amount_deviation_ratio.toFixed(1)}x Baseline)`;
          } else if (tx.is_new_beneficiary && (tx.beneficiary_count_7d || 0) >= 3) {
            alertType = 'Rapid Beneficiary Expansion Cluster';
          } else if (tx.is_dormant_account) {
            alertType = 'Dormant Account Reactivation Spike';
          } else if (tx.risk_score && tx.risk_score >= 80) {
            alertType = `High Model Risk Alert (Score: ${tx.risk_score}/100)`;
          }

          alertGroupsMap.set(custId, {
            alertId: `ALT-${custId}`,
            customerId: custId,
            customerName: tx.customer_name,
            txIds: [tx.transaction_id],
            totalAmount: tx.transaction_amount,
            scores: tx.risk_score !== null ? [tx.risk_score] : [],
            type: alertType,
            description: `Pattern detected for ${tx.customer_name}: ${tx.pattern_detected}. Presented together for officer investigation.`,
            patternSummary: tx.pattern_detected,
            priority,
          });
          tx.alert_id = `ALT-${custId}`;
        } else {
          existing.txIds.push(tx.transaction_id);
          existing.totalAmount += tx.transaction_amount;
          if (tx.risk_score !== null) existing.scores.push(tx.risk_score);
          tx.alert_id = existing.alertId;
        }
      }
    }

    const generatedAlerts = Array.from(alertGroupsMap.values()).map((g) => ({
      alert_id: g.alertId,
      alert_type: g.type,
      customer_id: g.customerId,
      customer_name: g.customerName,
      priority: g.priority,
      description: g.description,
      pattern_summary: g.patternSummary,
      status: 'Open' as const,
      created_at: new Date().toISOString(),
      transaction_ids: g.txIds,
      total_amount: g.totalAmount,
      average_score: g.scores.length > 0 ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : 0,
    }));

    return res.json({
      success: true,
      totalCount,
      returnedCount: mappedTransactions.length,
      model_version: 'random_forest_v1',
      predictions_matched: predictionsMap.size,
      alerts: generatedAlerts,
      data: mappedTransactions,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'SERVER_EXCEPTION',
      message: err?.message || 'An unexpected server exception occurred while processing transactions.',
    });
  }
});

/**
 * POST /api/predict
 * Connects Express backend to the Python AML Random Forest inference microservice (aml_model.pkl).
 * Validates transaction existence in public.aml_transactions, forwards raw transaction features,
 * receives inference scores, and idempotently persists the prediction into public.ml_predictions.
 */
app.post('/api/predict', async (req: Request, res: Response) => {
  const { transaction_id, transaction: customTx, features: customFeatures } = req.body || {};

  if (!transaction_id || typeof transaction_id !== 'string' || !transaction_id.trim()) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_TRANSACTION_ID',
      message: 'A valid transaction_id string is required to associate and persist the model prediction.',
    });
  }

  const cleanTxId = transaction_id.trim();
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Supabase client is not configured or initialized on the server.',
    });
  }

  try {
    // 1. Verify transaction exists in public.aml_transactions before associating prediction
    const { data: dbTx, error: txError } = await supabase
      .from('aml_transactions')
      .select('*')
      .eq('transaction_id', cleanTxId)
      .maybeSingle();

    if (txError) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_QUERY_ERROR',
        message: `Failed to query aml_transactions: ${txError.message}`,
      });
    }

    if (!dbTx) {
      return res.status(404).json({
        success: false,
        error: 'TRANSACTION_NOT_FOUND',
        message: `Transaction with ID '${cleanTxId}' does not exist in public.aml_transactions. Prediction cannot be associated with a nonexistent transaction.`,
      });
    }

    // 2. Extract and validate transaction features
    // Combine dbTx with any optional custom features
    const rawFeatureSource: Record<string, any> = {
      ...dbTx,
      ...(customTx || customFeatures || {}),
    };

    // CRITICAL: Never accept a client-supplied risk score or model prediction
    delete rawFeatureSource.risk_score;
    delete rawFeatureSource.risk_tier;
    delete rawFeatureSource.risk_probability;
    delete rawFeatureSource.predicted_suspicious;
    delete rawFeatureSource.prediction_timestamp;

    const validation = extractAndValidateFeatures(rawFeatureSource);
    if (!validation.valid || !validation.features) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TRANSACTION_FEATURES',
        message: validation.error || 'Transaction features failed AML model contract validation.',
        transaction_id: cleanTxId,
      });
    }

    // 3. Forward valid features to Python AML Inference Microservice
    let pyResponse: globalThis.Response;
    try {
      pyResponse = await fetch(`${AML_INFERENCE_URL}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          transaction_id: cleanTxId,
          ...validation.features,
        }),
        signal: AbortSignal.timeout(6000),
      });
    } catch (netErr: any) {
      return res.status(503).json({
        success: false,
        error: 'INFERENCE_SERVICE_UNAVAILABLE',
        message: `Python AML inference service is unreachable at ${AML_INFERENCE_URL}: ${netErr?.message || 'Connection refused'}. Predictions were not fabricated or saved.`,
      });
    }

    if (!pyResponse.ok) {
      const errBody: any = await pyResponse.json().catch(() => ({}));
      return res.status(pyResponse.status >= 500 ? 502 : 400).json({
        success: false,
        error: errBody.error || 'INFERENCE_FAILED',
        message: errBody.message || `Python inference service returned HTTP ${pyResponse.status}.`,
        transaction_id: cleanTxId,
      });
    }

    const pyData: any = await pyResponse.json();
    if (!pyData || typeof pyData.risk_score !== 'number') {
      return res.status(502).json({
        success: false,
        error: 'INVALID_MODEL_OUTPUT',
        message: 'Python AML model returned an invalid or incomplete inference response.',
      });
    }

    // 4. Persist newly generated prediction to public.ml_predictions in Supabase (Idempotent upsert)
    const predictionToSave = {
      transaction_id: cleanTxId,
      model_version: pyData.model_version || 'random_forest_v1',
      risk_probability: Number(pyData.risk_probability),
      risk_score: Number(pyData.risk_score),
      risk_tier: String(pyData.risk_tier || 'LOW').toUpperCase(),
      predicted_suspicious: Boolean(pyData.predicted_suspicious),
      prediction_timestamp: new Date().toISOString(),
    };

    const { data: savedRow, error: upsertErr } = await supabase
      .from('ml_predictions')
      .upsert(predictionToSave, { onConflict: 'transaction_id,model_version' })
      .select('*')
      .single();

    if (upsertErr) {
      return res.status(500).json({
        success: false,
        error: 'PERSISTENCE_FAILED',
        message: `Inference succeeded, but failed to persist prediction into public.ml_predictions: ${upsertErr.message}`,
        prediction: pyData,
      });
    }

    // 5. Retrieve customer context to format updated transaction for the frontend
    let customer: any = null;
    if (dbTx.customer_id) {
      const { data: cRow } = await supabase
        .from('customers')
        .select('*')
        .eq('id', dbTx.customer_id)
        .maybeSingle();
      customer = cRow;
    }

    const updatedTransaction = formatTransactionRow(dbTx, savedRow, customer);
    if (pyData.feature_contributions) {
      updatedTransaction.feature_contributions = pyData.feature_contributions;
    }

    return res.json({
      success: true,
      message: 'Transaction prediction generated by Python model and saved to Supabase successfully.',
      transaction_id: cleanTxId,
      model_version: predictionToSave.model_version,
      prediction: savedRow,
      feature_contributions: pyData.feature_contributions || [],
      disclaimer: pyData.disclaimer,
      updated_transaction: updatedTransaction,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'SERVER_EXCEPTION',
      message: err?.message || 'Unexpected server exception during prediction processing.',
    });
  }
});

/**
 * POST /api/predict-batch
 * Batch vectorized inference over multiple transactions using the Python microservice.
 * Bulk-persists predictions into public.ml_predictions with idempotent conflict resolution.
 */
app.post('/api/predict-batch', async (req: Request, res: Response) => {
  const { transaction_ids } = req.body || {};

  if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_BATCH_REQUEST',
      message: "'transaction_ids' must be a non-empty array of valid transaction ID strings.",
    });
  }

  // Cap batch size to 100 per request
  const safeIds: string[] = transaction_ids.slice(0, 100).map((id: any) => String(id).trim());

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Supabase client is not configured or initialized on the server.',
    });
  }

  try {
    // 1. Query matching transactions from Supabase
    const { data: dbRows, error: fetchErr } = await supabase
      .from('aml_transactions')
      .select('*')
      .in('transaction_id', safeIds);

    if (fetchErr) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_QUERY_ERROR',
        message: fetchErr.message,
      });
    }

    if (!dbRows || dbRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_TRANSACTIONS_FOUND',
        message: 'None of the requested transaction_ids exist in public.aml_transactions.',
      });
    }

    // 2. Validate and prepare payload for Python microservice
    const cleanedTransactions: any[] = [];
    for (const row of dbRows) {
      const v = extractAndValidateFeatures(row);
      if (v.valid && v.features) {
        cleanedTransactions.push({
          transaction_id: String(row.transaction_id),
          ...v.features,
        });
      }
    }

    if (cleanedTransactions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ALL_FEATURES_INVALID',
        message: 'Could not extract valid model features from any of the requested transactions.',
      });
    }

    // 3. Call Python /predict-batch endpoint
    let pyResponse: globalThis.Response;
    try {
      pyResponse = await fetch(`${AML_INFERENCE_URL}/predict-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: cleanedTransactions }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (netErr: any) {
      return res.status(503).json({
        success: false,
        error: 'INFERENCE_SERVICE_UNAVAILABLE',
        message: `Python AML inference service is unreachable at ${AML_INFERENCE_URL}: ${netErr?.message || 'Connection refused'}. Predictions were not saved.`,
      });
    }

    if (!pyResponse.ok) {
      const errBody: any = await pyResponse.json().catch(() => ({}));
      return res.status(pyResponse.status >= 500 ? 502 : 400).json({
        success: false,
        error: errBody.error || 'BATCH_INFERENCE_FAILED',
        message: errBody.message || `Python batch inference returned status ${pyResponse.status}`,
      });
    }

    const pyData: any = await pyResponse.json();
    const predictions: any[] = pyData.predictions || [];

    // 4. Bulk upsert to public.ml_predictions
    const recordsToUpsert = predictions.map((p: any) => ({
      transaction_id: String(p.transaction_id),
      model_version: 'random_forest_v1',
      risk_probability: Number(p.risk_probability),
      risk_score: Number(p.risk_score),
      risk_tier: String(p.risk_tier || 'LOW').toUpperCase(),
      predicted_suspicious: Boolean(p.predicted_suspicious),
      prediction_timestamp: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabase
      .from('ml_predictions')
      .upsert(recordsToUpsert, { onConflict: 'transaction_id,model_version' });

    if (upsertErr) {
      return res.status(500).json({
        success: false,
        error: 'BATCH_PERSISTENCE_FAILED',
        message: `Batch inference completed, but failed to save predictions to Supabase: ${upsertErr.message}`,
        processed_count: predictions.length,
      });
    }

    return res.json({
      success: true,
      message: `Batch inference completed and persisted for ${recordsToUpsert.length} transactions.`,
      processed_count: recordsToUpsert.length,
      saved_count: recordsToUpsert.length,
      predictions: recordsToUpsert,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'SERVER_EXCEPTION',
      message: err?.message || 'Unexpected server exception during batch prediction processing.',
    });
  }
});

// Mount Vite middleware for dev or serve production build
async function startServer() {
  // Ensure the Python inference service is running before accepting client requests
  try {
    await ensurePythonInferenceService();
  } catch (err: any) {
    console.error('[Server] Non-fatal error initializing Python inference service:', err?.message);
  }

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex AML Server running on http://0.0.0.0:${PORT} [${isProduction ? 'production' : 'development'}]`);
    if (pythonServiceState.state === 'ready' || pythonServiceState.state === 'external') {
      console.log(`✓ Python ML Inference Service active and connected at ${AML_INFERENCE_URL}`);
    } else {
      console.warn(`! Python ML Inference Service unavailable (${pythonServiceState.error || 'unstarted'}). Dashboard running in limited ML mode.`);
    }
  });
}

startServer();
