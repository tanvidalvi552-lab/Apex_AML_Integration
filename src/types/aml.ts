export type TransactionType =
  | 'NEFT'
  | 'RTGS'
  | 'IMPS'
  | 'SWIFT'
  | 'UPI'
  | 'Cash Deposit'
  | 'CARD'
  | 'CASH_DEPOSIT'
  | 'INTERNATIONAL_TRANSFER'
  | string;

export type RiskTier = 'High' | 'Medium' | 'Low' | 'Unavailable';

export type TransactionDecisionStatus =
  | 'Auto-Verified'
  | 'Urgent Review'
  | 'Further Review'
  | 'On Hold'
  | 'Verified / Passed'
  | 'Terminated'
  | 'Escalated';

export type OfficerDecisionAction = 'Verify & Pass' | 'Hold Transaction' | 'Terminate Transaction' | 'Escalate';

export type OfficerRole =
  | 'AML Investigator'
  | 'AML Supervisor'
  | 'Compliance Manager'
  | 'System Administrator';

export interface RawMlPrediction {
  id?: string | number;
  model_version?: string;
  risk_probability?: number | null;
  risk_score?: number | null;
  risk_tier?: string | null;
  predicted_suspicious?: boolean | null;
  prediction_timestamp?: string | null;
}

export interface FeatureContribution {
  feature: string;
  impact: number; // positive = pushes score higher, negative = mitigating
  description: string;
  observed_value: string;
}

export interface RuleTrigger {
  rule_id: string;
  rule_name: string;
  severity: 'critical' | 'high' | 'medium';
  threshold_condition: string;
  why: string;
}

export interface AmlTransactionReview {
  id: string;
  transaction_id: string;
  officer_id: string;
  officer_name: string;
  officer_role: OfficerRole;
  decision: OfficerDecisionAction;
  reason: string;
  status: 'Payment System Confirmed' | 'Hold Active' | 'Terminated & Dispatched' | 'Escalation Logged';
  hold_duration?: string;
  customer_notified: boolean;
  customer_notification_subject?: string;
  customer_notification_body?: string;
  payment_gateway_ref?: string;
  created_at: string;
  updated_at: string;
}

export interface AmlAlert {
  alert_id: string;
  alert_type: string;
  customer_id: string;
  customer_name: string;
  priority: 'Urgent' | 'Standard';
  description: string;
  pattern_summary: string;
  status: 'Open' | 'Under Review' | 'Resolved';
  created_at: string;
  transaction_ids: string[];
  total_amount: number;
  average_score: number;
}

export interface AmlTransaction {
  transaction_id: string;
  customer_id: string;
  customer_name: string;
  account_number: string;
  transaction_amount: number;
  currency: string;
  transaction_type: TransactionType;
  transaction_frequency_24h: number;
  avg_30d_amount: number;
  amount_deviation_ratio: number;
  risk_score: number | null; // 0-100 or null if unavailable
  risk_tier: RiskTier;
  predicted_suspicious: boolean | null;
  prediction_timestamp: string;
  transaction_timestamp: string;
  status: TransactionDecisionStatus;
  pattern_detected: string; // The detected pattern or rule reason
  alert_id?: string; // Links transaction to an aml_alert pattern
  
  // Behavioral & Environmental context from Supabase aml_transactions
  is_new_beneficiary: boolean;
  is_international: boolean;
  is_dormant_account: boolean;
  is_device_change: boolean;
  is_location_change: boolean;
  is_unusual_time: boolean;
  beneficiary_name: string;
  beneficiary_account: string;
  beneficiary_bank: string;
  beneficiary_country: string;
  origin_city: string;
  destination_city: string;
  ip_address: string;
  device_id: string;

  // Supabase Database Specific Fields
  account_balance?: number;
  account_age_days?: number;
  beneficiary_count_7d?: number;
  failed_transactions_24h?: number;
  previous_alerts?: number;
  db_suspicious?: number; // Ground truth suspicious flag from aml_transactions
  branch?: string; // Customer bank branch
  account_type?: string; // Customer account type
  kyc_status?: string; // Customer KYC status
  risk_probability?: number | null; // Random Forest ML probability
  
  // AI Diagnostics
  feature_contributions: FeatureContribution[];
  rules_triggered: RuleTrigger[];
  
  // Review linkage
  reviews?: AmlTransactionReview[];

  // Separate preservation of raw ML prediction from operational status
  raw_prediction?: RawMlPrediction | null;
}

export interface CustomerRiskIndicator {
  name: string;
  severity: 'high' | 'medium' | 'info';
  rationale: string;
  observed: string;
}

export interface CustomerProfile {
  customer_id: string;
  name: string;
  category: 'Individual' | 'Corporate' | 'Proprietorship';
  kyc_status: 'Full KYC' | 'Simplified KYC' | 'Pending Re-KYC' | 'Enhanced Due Diligence' | 'VERIFIED' | string;
  account_opened_date: string;
  account_balance: number;
  customer_risk_tier: RiskTier;
  customer_risk_score: number;
  dormancy_status: 'Active' | 'Dormant Reactivated' | 'Dormant';
  monitoring_status: 'Standard' | 'Enhanced Monitoring' | 'Watchlist' | 'Restricted';
  historical_volume_30d: number;
  typical_amount: number;
  previous_alerts_count: number;
  recent_beneficiary_changes: number;
  recent_device_changes: number;
  recent_location_changes: number;
  risk_indicators: CustomerRiskIndicator[];
  account_number?: string;
  account_type?: string;
  branch?: string;
  account_age_days?: number;
  total_transactions_count?: number;
  suspicious_transactions_count?: number;
}

export interface OfficerAuditLog {
  id: string;
  timestamp: string;
  officer_name: string;
  officer_role: OfficerRole;
  action: string;
  target_type: 'Transaction' | 'Customer' | 'Payment Gateway' | 'Model' | 'Alert Pattern';
  target_id: string;
  details: string;
  hash: string;
}
