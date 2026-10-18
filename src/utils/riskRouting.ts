/**
 * PROTOTYPE AML TRANSACTION ROUTING ENGINE
 * 
 * Determines the operational queue tier for incoming transactions in the Apex AML Dashboard.
 * 
 * CORE PRINCIPLES & GOVERNANCE:
 * 1. Low ML score != Auto-Verified:
 *    A low machine learning risk score alone NEVER automatically clears a transaction.
 *    Automatic clearance requires meeting comprehensive bank clearance criteria across
 *    dormancy, velocity, device/location consistency, and historical alerts.
 * 2. Fail-Safe Principle for Incomplete Data:
 *    Missing predictions, incomplete telemetry, or processing errors are strictly diverted
 *    to human officer review queues rather than being automatically passed.
 * 3. Composite Urgency (Beyond predicted_suspicious === true):
 *    Model suspicion is treated as an advisory signal. High-urgency triaging is driven by
 *    composite behavioral patterns (e.g. structuring bursts, extreme baseline deviations,
 *    dormancy reactivation, or rapid counterparty clusters).
 * 
 * LIMITATIONS & REGULATORY NOTICE:
 * - This engine routes transactions into operational review queues for authorized officers.
 * - Auto-clearance thresholds must be periodically validated by the Bank Compliance Committee.
 * - Marking an operational status as 'Auto-Verified' or 'Verified' on this dashboard never
 *   directly executes payment dispatch or money transmission.
 */

export interface RiskRoutingInput {
  hasPrediction: boolean;
  riskScore: number | null;
  riskTier: string | null;
  predictedSuspicious: boolean | null;
  transactionFrequency24h: number;
  amountDeviation: number;
  transactionAmount: number;
  failedTransactions24h: number;
  dormantAccount: boolean;
  deviceChange: boolean;
  locationChange: boolean;
  unusualTime: boolean;
  newBeneficiary: boolean;
  beneficiaryCount7d: number;
  previousAlerts: number;
}

export interface RiskRoutingResult {
  status: 'Auto-Verified' | 'Urgent Review' | 'Further Review';
  pattern: string;
  rationale: string;
  routingTier: 'Automated Clearance' | 'Urgent Review' | 'Secondary Review';
}

/**
 * Evaluates transaction behavioral attributes and ML prediction to assign operational queue status.
 */
export function routeTransactionStatus(input: RiskRoutingInput): RiskRoutingResult {
  const {
    hasPrediction,
    riskScore,
    riskTier,
    predictedSuspicious,
    transactionFrequency24h,
    amountDeviation,
    transactionAmount,
    failedTransactions24h,
    dormantAccount,
    deviceChange,
    locationChange,
    unusualTime,
    newBeneficiary,
    beneficiaryCount7d,
    previousAlerts,
  } = input;

  const normalizedTier = riskTier ? String(riskTier).toUpperCase().trim() : null;

  // 1. FAIL-SAFE CHECK: Missing or un-scored prediction
  if (!hasPrediction || riskScore === null) {
    if (dormantAccount || failedTransactions24h > 0 || transactionFrequency24h >= 8 || amountDeviation >= 5.0) {
      return {
        status: 'Urgent Review',
        pattern: 'Unscored Transaction with Elevated Behavioral Risk',
        rationale: 'ML prediction is unavailable (model_version random_forest_v1 not executed) and behavioral red flags are present. Immediate officer triage required.',
        routingTier: 'Urgent Review',
      };
    }
    return {
      status: 'Further Review',
      pattern: 'Model Prediction Unavailable (Pending random_forest_v1 scoring)',
      rationale: 'Transaction record has not yet been processed by the random_forest_v1 model. Diverted to secondary review pending scoring.',
      routingTier: 'Secondary Review',
    };
  }

  // 2. CATEGORY 2: URGENT REVIEW (High Priority Queue)
  // Condition 2A: High Model Risk Tier or Score >= 80
  if (normalizedTier === 'HIGH' || riskScore >= 80) {
    return {
      status: 'Urgent Review',
      pattern: `High Model Risk Alert (Score: ${riskScore}/100, Tier: ${riskTier || 'High'})`,
      rationale: 'Random Forest model classified this transaction with elevated probability of suspicious activity.',
      routingTier: 'Urgent Review',
    };
  }

  // Condition 2B: Rapid Transaction Burst / Structuring Velocity
  if (transactionFrequency24h >= 8 && transactionAmount >= 10000) {
    return {
      status: 'Urgent Review',
      pattern: `High-Frequency Velocity Burst (${transactionFrequency24h} tx in 24h)`,
      rationale: 'Potential structuring or smurfing pattern detected: repeated high-frequency transactions within a 24-hour cycle.',
      routingTier: 'Urgent Review',
    };
  }

  // Condition 2C: Extreme Amount Deviation Spike (>= 5x normal baseline)
  if (amountDeviation >= 5.0) {
    return {
      status: 'Urgent Review',
      pattern: `Extreme Amount Deviation (${amountDeviation.toFixed(1)}x Baseline Average)`,
      rationale: 'Transaction amount severely diverges from the customer established 30-day transactional history.',
      routingTier: 'Urgent Review',
    };
  }

  // Condition 2D: Model Suspicion combined with environmental/account flags
  if (
    predictedSuspicious === true &&
    (dormantAccount || deviceChange || locationChange || failedTransactions24h > 0 || previousAlerts > 0)
  ) {
    const flags: string[] = [];
    if (dormantAccount) flags.push('Dormancy');
    if (deviceChange) flags.push('New Device');
    if (locationChange) flags.push('Location Anomaly');
    if (failedTransactions24h > 0) flags.push(`${failedTransactions24h} Failed Tx`);
    if (previousAlerts > 0) flags.push(`${previousAlerts} Prior Alerts`);

    return {
      status: 'Urgent Review',
      pattern: `Compound Risk Flag: Model Suspicion + [${flags.join(', ')}]`,
      rationale: 'Model suspicion corroborated by environmental changes or account irregularities.',
      routingTier: 'Urgent Review',
    };
  }

  // Condition 2E: New Beneficiary Velocity Cluster
  if (newBeneficiary && beneficiaryCount7d >= 5) {
    return {
      status: 'Urgent Review',
      pattern: `Rapid Counterparty Expansion (${beneficiaryCount7d} New Beneficiaries in 7d)`,
      rationale: 'Unusual influx of newly registered recipients indicates possible account compromise or mule dispatch.',
      routingTier: 'Urgent Review',
    };
  }

  // 3. CATEGORY 1: AUTO-VERIFIED (Automated Clearance Queue)
  // Clearance requires satisfying all approved parameters (Zero tolerance on red flags)
  const isEligibleForAutoClearance =
    predictedSuspicious === false &&
    riskScore < 30 &&
    normalizedTier === 'LOW' &&
    dormantAccount === false &&
    failedTransactions24h === 0 &&
    deviceChange === false &&
    locationChange === false &&
    unusualTime === false &&
    amountDeviation <= 1.2 &&
    previousAlerts === 0;

  if (isEligibleForAutoClearance) {
    return {
      status: 'Auto-Verified',
      pattern: 'Routine Clearance Rule Match (Policy AML-CLR-01)',
      rationale: 'Transaction satisfies all approved bank automated clearance parameters: low ML risk, consistent velocity, zero behavioral discrepancies.',
      routingTier: 'Automated Clearance',
    };
  }

  // 4. CATEGORY 3: FURTHER REVIEW (Secondary Review Queue)
  // Transactions that are unusual or deviate from routine patterns, but don't meet urgent criteria
  let secondaryReason = 'Secondary compliance check required';
  if (amountDeviation > 1.2) {
    secondaryReason = `Moderate baseline deviation (${amountDeviation.toFixed(1)}x)`;
  } else if (newBeneficiary) {
    secondaryReason = 'First transfer to newly created beneficiary';
  } else if (deviceChange || locationChange) {
    secondaryReason = 'Environmental parameter shift (Device/Location)';
  } else if (riskScore >= 30 && riskScore < 80) {
    secondaryReason = `Intermediate risk score (${riskScore}/100)`;
  } else if (previousAlerts > 0) {
    secondaryReason = `Customer has history of ${previousAlerts} previous AML alerts`;
  }

  return {
    status: 'Further Review',
    pattern: `Secondary Review: ${secondaryReason}`,
    rationale: 'Transaction exhibits moderate deviations or non-urgent anomalies requiring officer inspection before clearance.',
    routingTier: 'Secondary Review',
  };
}
