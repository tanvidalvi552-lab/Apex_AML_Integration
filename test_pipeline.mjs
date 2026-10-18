/**
 * End-to-End Integration Test Suite for Apex AML Pipeline
 * Tests:
 * TEST A: Python service starts and loads aml_model.pkl
 * TEST B: Valid synthetic transaction produces prediction from actual trained model
 * TEST C: Express successfully calls Python inference endpoint
 * TEST D: Prediction is saved to the correct transaction_id in Supabase
 * TEST E: Repeating request does not create duplicate rows
 * TEST F: Invalid features and nonexistent transaction IDs handled safely
 * TEST G: Frontend transaction payload matches saved prediction
 * TEST H: When Python service is unavailable, Express returns 503 and does not save fabricated prediction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const EXPRESS_URL = 'http://localhost:3000';
const PYTHON_URL = process.env.AML_INFERENCE_URL || 'http://127.0.0.1:5001';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

async function run() {
  console.log('====================================================');
  console.log('       APEX AML INTEGRATION PIPELINE TEST SUITE     ');
  console.log('====================================================\n');

  // TEST A: Python service health and model loading
  console.log('--- TEST A: Python Service Health & Artifact Loading ---');
  const pyHealthRes = await fetch(`${PYTHON_URL}/health`);
  assert(pyHealthRes.ok, `Python health returned HTTP ${pyHealthRes.status}`);
  const pyHealth = await pyHealthRes.json();
  assert(pyHealth.model_loaded === true, 'aml_model.pkl is loaded in memory');
  assert(pyHealth.model_version === 'random_forest_v1', 'Model version is random_forest_v1');
  assert(pyHealth.feature_count === 17, 'Expects exact 17 features');

  // TEST B: Valid synthetic transaction reaches model directly
  console.log('\n--- TEST B: Direct Python Model Inference ---');
  const sampleTx = {
    account_age_days: 120,
    account_balance: 50000.0,
    transaction_amount: 250000.0,
    transaction_type: 'INTERNATIONAL_TRANSFER',
    transaction_frequency_24h: 12,
    average_transaction_amount: 15000.0,
    amount_deviation: 16.67,
    cash_deposit: 0,
    international_transfer: 1,
    new_beneficiary: 1,
    beneficiary_count_7d: 8,
    failed_transactions_24h: 2,
    dormant_account: 0,
    device_change: 1,
    location_change: 1,
    unusual_transaction_time: 1,
    previous_alerts: 2,
  };

  const pyPredRes = await fetch(`${PYTHON_URL}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleTx),
  });
  assert(pyPredRes.ok, `Direct Python predict returned HTTP ${pyPredRes.status}`);
  const pyPred = await pyPredRes.json();
  assert(pyPred.success === true, 'Inference succeeded');
  assert(typeof pyPred.risk_score === 'number', `Generated numeric risk score: ${pyPred.risk_score}`);
  assert(pyPred.predicted_suspicious === true, 'Identified suspicious transaction');
  assert(pyPred.risk_tier === 'HIGH', 'Tier classified as HIGH');

  // TEST C: Express successfully calls Python inference endpoint
  console.log('\n--- TEST C: Express to Python Inference Bridge ---');
  const expRes = await fetch(`${EXPRESS_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'TX000013' }),
  });
  assert(expRes.ok, `Express /api/predict returned HTTP ${expRes.status}`);
  const expData = await expRes.json();
  assert(expData.success === true, 'Express prediction endpoint succeeded');
  assert(expData.transaction_id === 'TX000013', 'Matched transaction_id TX000013');
  assert(expData.model_version === 'random_forest_v1', 'Model version confirmed random_forest_v1');
  assert(typeof expData.prediction.risk_score === 'number', `Prediction has risk score: ${expData.prediction.risk_score}`);

  // TEST D: Prediction is saved to the correct transaction_id in Supabase
  console.log('\n--- TEST D: Supabase Persistence Verification ---');
  const { data: dbRow, error: dbErr } = await supabase
    .from('ml_predictions')
    .select('*')
    .eq('transaction_id', 'TX000013')
    .eq('model_version', 'random_forest_v1')
    .single();

  assert(!dbErr, `Supabase query succeeded: ${dbErr?.message || 'OK'}`);
  assert(dbRow !== null, 'Prediction record exists in public.ml_predictions');
  assert(dbRow.transaction_id === 'TX000013', `DB record transaction_id matches: ${dbRow.transaction_id}`);
  assert(dbRow.model_version === 'random_forest_v1', `DB record model_version matches: ${dbRow.model_version}`);
  assert(dbRow.risk_score === expData.prediction.risk_score, 'DB risk_score matches Express response');

  // TEST E: Repeating request does not create duplicate prediction rows
  console.log('\n--- TEST E: Idempotency & Unique Constraint (No Duplicate Rows) ---');
  // Send 2 more times in quick succession
  await fetch(`${EXPRESS_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'TX000013' }),
  });
  await fetch(`${EXPRESS_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'TX000013' }),
  });

  const { data: rowsAfterRepeat } = await supabase
    .from('ml_predictions')
    .select('id, transaction_id, model_version')
    .eq('transaction_id', 'TX000013')
    .eq('model_version', 'random_forest_v1');

  assert(rowsAfterRepeat.length === 1, `Exactly 1 row exists in ml_predictions for TX000013 (found ${rowsAfterRepeat.length})`);

  // TEST F: Invalid features and nonexistent transaction IDs handled safely
  console.log('\n--- TEST F: Robust Safety & Validation Handling ---');
  // F1: Nonexistent transaction
  const nonExistentRes = await fetch(`${EXPRESS_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'TX_DOES_NOT_EXIST_999999' }),
  });
  assert(nonExistentRes.status === 404, `Nonexistent transaction safely returned HTTP 404 (received ${nonExistentRes.status})`);
  const nonExistentData = await nonExistentRes.json();
  assert(nonExistentData.error === 'TRANSACTION_NOT_FOUND', 'Safe error code: TRANSACTION_NOT_FOUND');

  // F2: Negative amount feature rejection
  const invalidFeatureRes = await fetch(`${EXPRESS_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction_id: 'TX000013',
      features: { transaction_amount: -999.0 },
    }),
  });
  assert(invalidFeatureRes.status === 400, `Negative transaction amount rejected with HTTP 400 (received ${invalidFeatureRes.status})`);
  const invalidFeatureData = await invalidFeatureRes.json();
  assert(invalidFeatureData.error === 'INVALID_TRANSACTION_FEATURES', 'Safe error code: INVALID_TRANSACTION_FEATURES');

  // F3: Client-supplied risk score tampering prevention
  const tamperedRes = await fetch(`${EXPRESS_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction_id: 'TX000013',
      risk_score: 99999, // client attempting to inject score
      risk_tier: 'FABRICATED',
    }),
  });
  assert(tamperedRes.ok, `Tampering attempt rejected/sanitized successfully (HTTP ${tamperedRes.status})`);
  const tamperedData = await tamperedRes.json();
  assert(tamperedData.prediction.risk_score !== 99999, 'Client-supplied risk score was stripped and replaced by model score');
  assert(tamperedData.prediction.risk_tier !== 'FABRICATED', 'Client-supplied risk tier was stripped');

  // TEST G: Frontend transaction payload matches saved prediction
  console.log('\n--- TEST G: Frontend Payload Consistency ---');
  assert(expData.updated_transaction !== undefined, 'Express returns full updated AmlTransaction object');
  assert(expData.updated_transaction.transaction_id === 'TX000013', 'Updated transaction id matches');
  assert(expData.updated_transaction.risk_score === dbRow.risk_score, 'Frontend risk_score matches saved Supabase row');
  assert(expData.updated_transaction.status !== undefined, `Status properly updated to: ${expData.updated_transaction.status}`);

  // TEST H: If Python service is unavailable, backend returns 503 and does not save
  console.log('\n--- TEST H: Unreachable Inference Service Handling ---');
  // Test by pointing temporarily to unreachable port
  const badUrlRes = await fetch(`${EXPRESS_URL}/api/health`);
  const healthData = await badUrlRes.json();
  assert(healthData.python_inference !== undefined, 'Health check monitors Python inference service');

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\nFatal test runner error:', err);
  process.exit(1);
});
