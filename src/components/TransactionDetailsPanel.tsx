import React, { useState } from 'react';
import { useAml } from '../context/AmlContext';
import { formatINR } from '../data/mockAmlData';
import { AmlTransaction, AmlTransactionReview, AmlAlert, OfficerDecisionAction } from '../types/aml';
import {
  X,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
  ArrowUpRight,
  User,
  CreditCard,
  MapPin,
  Info,
  History,
  Lock,
  ChevronRight,
  ExternalLink,
  Layers,
  Sparkles,
  Sliders,
  Check,
  RotateCcw,
} from 'lucide-react';

export const TransactionDetailsPanel: React.FC = () => {
  const {
    selectedTx,
    closeTxPanel,
    customers,
    reviews,
    alerts,
    transactions,
    verifyAndPass,
    holdTransaction,
    terminateTransaction,
    escalateTransaction,
    resolveAlertGroup,
    evaluateTransactionWithMl,
    selectTx,
    officerName,
    currentRole,
  } = useAml();

  // Active sub-tab in panel: Details or Decision Audit History
  const [activeTab, setActiveTab] = useState<'review' | 'history'>('review');
  const [isEvaluatingMl, setIsEvaluatingMl] = useState(false);

  // Decision Modal States
  const [decisionModal, setDecisionModal] = useState<
    'verify' | 'hold' | 'terminate' | 'escalate' | null
  >(null);
  const [reasonInput, setReasonInput] = useState('');
  const [holdDuration, setHoldDuration] = useState('48 Hours');
  const [applyToGroup, setApplyToGroup] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Customer notification preview modal
  const [previewNotification, setPreviewNotification] = useState<{
    subject: string;
    body: string;
    recipient: string;
  } | null>(null);

  if (!selectedTx) return null;

  const customer = customers[selectedTx.customer_id] || {
    customer_id: selectedTx.customer_id,
    name: selectedTx.customer_name,
    category: 'Individual',
    kyc_status: 'Full KYC',
    account_opened_date: '2022-04-12',
    account_balance: 145000,
    customer_risk_tier: selectedTx.risk_tier,
    customer_risk_score: selectedTx.risk_score ?? 0,
    dormancy_status: selectedTx.is_dormant_account ? 'Dormant Reactivated' : 'Active',
    monitoring_status: 'Standard',
    historical_volume_30d: selectedTx.avg_30d_amount * 4,
    typical_amount: selectedTx.avg_30d_amount,
    previous_alerts_count: 2,
    recent_beneficiary_changes: selectedTx.is_new_beneficiary ? 1 : 0,
    recent_device_changes: selectedTx.is_device_change ? 1 : 0,
    recent_location_changes: selectedTx.is_location_change ? 1 : 0,
    risk_indicators: [],
  };

  // Associated alert if this transaction belongs to a pattern group
  const associatedAlert: AmlAlert | undefined = selectedTx.alert_id
    ? alerts.find((a) => a.alert_id === selectedTx.alert_id)
    : undefined;

  // Transactions linked to the same alert (e.g. all 10 repeated transactions)
  const linkedGroupTransactions: AmlTransaction[] = associatedAlert
    ? transactions.filter((t) => associatedAlert.transaction_ids.includes(t.transaction_id))
    : [];

  // Associated reviews for this specific transaction
  const txReviews = reviews.filter((r) => r.transaction_id === selectedTx.transaction_id);

  const handleConfirmDecision = async () => {
    if (!reasonInput.trim()) return;
    setIsSubmitting(true);

    try {
      if (associatedAlert && applyToGroup && decisionModal) {
        // Resolve entire alert pattern group (e.g. all 10 transactions)
        let decAction: OfficerDecisionAction = 'Verify & Pass';
        if (decisionModal === 'hold') decAction = 'Hold Transaction';
        if (decisionModal === 'terminate') decAction = 'Terminate Transaction';
        if (decisionModal === 'escalate') decAction = 'Escalate';

        await resolveAlertGroup(associatedAlert.alert_id, decAction, reasonInput, holdDuration);
      } else {
        // Individual transaction resolution
        if (decisionModal === 'verify') {
          await verifyAndPass(selectedTx.transaction_id, reasonInput);
        } else if (decisionModal === 'hold') {
          await holdTransaction(selectedTx.transaction_id, reasonInput, holdDuration);
        } else if (decisionModal === 'terminate') {
          await terminateTransaction(selectedTx.transaction_id, reasonInput);
        } else if (decisionModal === 'escalate') {
          await escalateTransaction(selectedTx.transaction_id, reasonInput);
        }
      }
      setDecisionModal(null);
      setReasonInput('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs transition-opacity"
        onClick={closeTxPanel}
      />

      {/* Sliding Slide-Over Panel (Universal Arial font & light theme) */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-slide-left">
        {/* Panel Header */}
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-purple-800 font-bold font-mono">{selectedTx.transaction_id}</span>
              <span className="text-slate-400">·</span>
              <span
                className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                  selectedTx.status === 'Auto-Verified'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : selectedTx.status === 'Urgent Review'
                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                    : selectedTx.status === 'Further Review'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : selectedTx.status === 'Verified / Passed'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : selectedTx.status === 'On Hold'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : selectedTx.status === 'Terminated'
                    ? 'bg-rose-100 text-rose-900 border border-rose-300'
                    : 'bg-slate-100 text-slate-800 border border-slate-200'
                }`}
              >
                {selectedTx.status}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 mt-1">
              Transaction & Pattern Investigation Workspace
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab switch between Details and Decision History */}
            <div className="flex items-center p-0.5 bg-slate-200/80 rounded-lg text-xs">
              <button
                onClick={() => setActiveTab('review')}
                className={`px-3 py-1 rounded-md transition-all font-semibold ${
                  activeTab === 'review'
                    ? 'bg-white text-purple-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Investigation
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 font-semibold ${
                  activeTab === 'history'
                    ? 'bg-white text-purple-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <History className="w-3 h-3" />
                <span>Audit Trail ({txReviews.length})</span>
              </button>
            </div>

            <button
              onClick={closeTxPanel}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Panel Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs">
          {activeTab === 'review' ? (
            <>
              {/* Pattern Alert Group Banner (If linked to an aml_alert like repeated transactions) */}
              {associatedAlert && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-orange-50 via-purple-50 to-white border-2 border-purple-200 space-y-3 shadow-2xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-600 to-purple-700 flex items-center justify-center text-white shrink-0 mt-0.5">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-900 font-bold border border-purple-200">
                            {associatedAlert.alert_id}
                          </span>
                          <span className="font-bold text-slate-900 text-xs">
                            {associatedAlert.alert_type}
                          </span>
                        </div>
                        <p className="text-slate-700 text-xs mt-1 leading-snug">
                          {associatedAlert.description}
                        </p>
                      </div>
                    </div>

                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold shrink-0 border border-rose-200">
                      {associatedAlert.priority} Priority
                    </span>
                  </div>

                  {/* Group Members Preview */}
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 border-b border-slate-100 pb-1">
                      <span>Related Group Transactions ({linkedGroupTransactions.length} items):</span>
                      <span className="font-mono text-purple-800">
                        Total: {formatINR(associatedAlert.total_amount)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1">
                      {linkedGroupTransactions.map((tx) => {
                        const isCurrent = tx.transaction_id === selectedTx.transaction_id;
                        return (
                          <button
                            key={tx.transaction_id}
                            onClick={() => selectTx(tx.transaction_id)}
                            className={`p-1.5 rounded border text-left transition-colors font-mono text-[10px] ${
                              isCurrent
                                ? 'bg-purple-100 border-purple-400 font-bold text-purple-900 ring-1 ring-purple-400'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <div className="truncate">{tx.transaction_id}</div>
                            <div className="text-slate-500 mt-0.5">{tx.transaction_timestamp.substring(11, 16)}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Detected Pattern Highlight */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">
                    Pattern Detected by Monitoring Engine:
                  </div>
                  <div className="font-bold text-slate-900 text-xs mt-0.5">
                    {selectedTx.pattern_detected}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-slate-500">Risk Score</div>
                  <div
                    className={`font-mono text-base font-bold tabular-nums ${
                      selectedTx.risk_score === null
                        ? 'text-slate-500'
                        : selectedTx.risk_score >= 70
                        ? 'text-rose-700'
                        : selectedTx.risk_score >= 40
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {selectedTx.risk_score !== null ? `${selectedTx.risk_score}/100` : 'Unavailable'}
                  </div>
                </div>
              </div>

              {/* Section 1: Transaction Details */}
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-900 tracking-wide flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-purple-700" />
                    <span>1. Transaction Details</span>
                  </h3>
                  <span className="font-mono text-slate-500 text-[11px] font-medium">
                    Channel: {selectedTx.transaction_type}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-500 font-mono font-medium">Transaction ID</span>
                    <div className="font-mono font-bold text-purple-800 text-xs mt-0.5">
                      {selectedTx.transaction_id}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-500 font-mono font-medium">Customer</span>
                    <div className="font-semibold text-slate-900 text-xs mt-0.5">
                      {selectedTx.customer_name} ({selectedTx.customer_id})
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-500 font-mono font-medium">Amount</span>
                    <div className="font-mono font-bold text-slate-900 text-sm tabular-nums mt-0.5">
                      {formatINR(selectedTx.transaction_amount)}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-500 font-mono font-medium">Origin Account</span>
                    <div className="font-mono text-slate-700 text-xs mt-0.5">
                      {selectedTx.account_number}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-500 font-mono font-medium">Beneficiary</span>
                    <div className="font-semibold text-slate-900 text-xs truncate mt-0.5" title={selectedTx.beneficiary_name}>
                      {selectedTx.beneficiary_name}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-500 font-mono font-medium">Location</span>
                    <div className="text-slate-700 text-[11px] mt-0.5">
                      {selectedTx.origin_city} ({selectedTx.beneficiary_country})
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>Timestamp: <strong className="text-slate-800">{selectedTx.transaction_timestamp}</strong></span>
                  <span>Scoring: <strong className="text-slate-800">{selectedTx.prediction_timestamp}</strong></span>
                </div>
              </div>

              {/* Section 2: AI Risk Assessment & Explanations (3 Mechanisms) */}
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-900 tracking-wide flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-orange-600" />
                    <span>2. Intelligent Monitoring Diagnostics</span>
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">
                    Tri-Tier Detection Engine
                  </span>
                </div>

                {/* The 3 complementary mechanisms from brief */}
                <div className="space-y-2.5">
                  {/* Mechanism A: Individual Transaction Assessment */}
                  <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-600" />
                        <span>A. Individual Transaction Assessment (Random Forest ML)</span>
                        <span className="font-mono text-purple-800 text-[10px] bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200">
                          random_forest_v1
                        </span>
                      </div>

                      <button
                        onClick={async () => {
                          if (!selectedTx || isEvaluatingMl) return;
                          setIsEvaluatingMl(true);
                          try {
                            await evaluateTransactionWithMl(selectedTx.transaction_id);
                          } finally {
                            setIsEvaluatingMl(false);
                          }
                        }}
                        disabled={isEvaluatingMl}
                        className="px-2.5 py-1 text-[11px] rounded bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-300 font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-60 shadow-2xs"
                        title="Evaluate transaction features through trained Random Forest pipeline and update Supabase"
                      >
                        {isEvaluatingMl ? (
                          <>
                            <RotateCcw className="w-3.5 h-3.5 animate-spin text-purple-700" />
                            <span>Scoring via Random Forest...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-purple-700" />
                            <span>Run ML Inference</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                      <div className="p-2 rounded bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-mono text-slate-500 block">ML Risk Score</span>
                        <span className={`text-sm font-bold font-mono ${
                          (selectedTx.risk_score ?? 0) >= 70 ? 'text-rose-700' : (selectedTx.risk_score ?? 0) >= 40 ? 'text-amber-700' : 'text-emerald-700'
                        }`}>
                          {selectedTx.risk_score !== null ? `${selectedTx.risk_score}/100` : 'Unavailable'}
                        </span>
                      </div>

                      <div className="p-2 rounded bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-mono text-slate-500 block">Risk Tier</span>
                        <span className={`text-xs font-bold font-mono ${
                          selectedTx.risk_tier === 'High' ? 'text-rose-700' : selectedTx.risk_tier === 'Medium' ? 'text-amber-700' : 'text-emerald-700'
                        }`}>
                          {selectedTx.risk_tier}
                        </span>
                      </div>

                      <div className="p-2 rounded bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-mono text-slate-500 block">Risk Probability</span>
                        <span className="text-xs font-bold font-mono text-slate-800">
                          {selectedTx.risk_probability !== null && selectedTx.risk_probability !== undefined
                            ? `${(selectedTx.risk_probability * 100).toFixed(2)}%`
                            : 'Unavailable'}
                        </span>
                      </div>

                      <div className="p-2 rounded bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-mono text-slate-500 block">DB Ground Truth</span>
                        <span className={`text-xs font-bold font-mono ${selectedTx.db_suspicious === 1 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {selectedTx.db_suspicious === 1 ? '1 (Suspicious)' : '0 (Routine)'}
                        </span>
                      </div>
                    </div>

                    {/* Explainability Feature Contributions */}
                    {selectedTx.feature_contributions && selectedTx.feature_contributions.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                        <span className="text-[10px] font-mono font-semibold text-slate-500 uppercase block">
                          Model Explainability (Top Feature Contributions):
                        </span>
                        <div className="space-y-1">
                          {selectedTx.feature_contributions.map((feat, i) => (
                            <div
                              key={i}
                              className="p-1.5 rounded bg-slate-50 border border-slate-200 text-[10px] flex items-center justify-between gap-2"
                            >
                              <div>
                                <span className="font-bold text-slate-800">{feat.feature}: </span>
                                <span className="text-slate-600">{feat.description}</span>
                              </div>
                              <span
                                className={`font-mono text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 ${
                                  feat.impact > 0
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {feat.impact > 0 ? `+${feat.impact}` : feat.impact} pts ({feat.observed_value})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-100">
                      Notice: Model predictions provide decision support and prioritized routing for authorized AML officers; final disposition requires human officer review.
                    </div>
                  </div>

                  {/* Mechanism B: Rule-Based Monitoring */}
                  <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
                        <span>B. Rule-Based Monitoring</span>
                      </span>
                      <span className="font-mono text-slate-500 text-[10px]">
                        Dynamic Clearance & Threat Rules
                      </span>
                    </div>

                    <div className="space-y-1 pt-1">
                      {(() => {
                        const activeRules: { id: string; name: string; desc: string; severity: 'critical' | 'high' | 'medium' }[] = [];
                        if (selectedTx.transaction_frequency_24h >= 8) {
                          activeRules.push({
                            id: 'RULE-VEL-01',
                            name: 'Structuring / High-Frequency Burst',
                            desc: `Customer executed ${selectedTx.transaction_frequency_24h} transactions in a 24-hour cycle. Potential smurfing threshold exceeded.`,
                            severity: 'critical',
                          });
                        }
                        if (selectedTx.amount_deviation_ratio >= 3.0) {
                          activeRules.push({
                            id: 'RULE-DEV-02',
                            name: 'Severe Baseline Amount Deviation',
                            desc: `Amount ₹${selectedTx.transaction_amount.toLocaleString()} is ${selectedTx.amount_deviation_ratio.toFixed(1)}x greater than customer 30-day baseline average (₹${selectedTx.avg_30d_amount.toLocaleString()}).`,
                            severity: 'high',
                          });
                        }
                        if (selectedTx.is_new_beneficiary) {
                          activeRules.push({
                            id: 'RULE-BEN-03',
                            name: 'Newly Added Counterparty Outflow',
                            desc: `Recipient account was registered in last 24h. Counterparty total count in 7d is ${selectedTx.beneficiary_count_7d || 1}.`,
                            severity: 'medium',
                          });
                        }
                        if (selectedTx.is_dormant_account) {
                          activeRules.push({
                            id: 'RULE-DOR-04',
                            name: 'Dormant Account High-Value Reactivation',
                            desc: 'Dormant bank account reactivated with immediate high-value fund movement.',
                            severity: 'high',
                          });
                        }
                        if (selectedTx.is_device_change || selectedTx.is_location_change) {
                          activeRules.push({
                            id: 'RULE-ENV-05',
                            name: 'Environmental Telemetry Anomaly',
                            desc: `Device shift: ${selectedTx.is_device_change ? 'New hardware fingerprint' : 'Consistent'} · Location anomaly: ${selectedTx.is_location_change ? 'Unusual IP geocoding' : 'Normal geofence'}.`,
                            severity: 'medium',
                          });
                        }
                        if ((selectedTx.failed_transactions_24h || 0) > 0) {
                          activeRules.push({
                            id: 'RULE-FAIL-06',
                            name: 'Preceding Payment Failures',
                            desc: `${selectedTx.failed_transactions_24h} failed payment attempts observed in last 24 hours prior to successful execution.`,
                            severity: 'medium',
                          });
                        }
                        if (selectedTx.is_unusual_time) {
                          activeRules.push({
                            id: 'RULE-TIME-07',
                            name: 'Unusual Off-Hours Activity',
                            desc: 'Transaction initiated outside customer standard temporal activity window.',
                            severity: 'medium',
                          });
                        }

                        if (activeRules.length === 0) {
                          return (
                            <div className="p-2 rounded bg-emerald-50 text-emerald-800 text-[11px] flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>No rule violations triggered. Transaction satisfies bank automated clearance policy (AML-CLR-01).</span>
                            </div>
                          );
                        }

                        return activeRules.map((rule) => (
                          <div
                            key={rule.id}
                            className={`p-2 rounded text-[11px] space-y-0.5 border ${
                              rule.severity === 'critical'
                                ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                                : rule.severity === 'high'
                                ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                                : 'bg-slate-50 border-slate-200 text-slate-900'
                            }`}
                          >
                            <div className="font-bold flex items-center justify-between">
                              <span>{rule.id}: {rule.name}</span>
                              <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold bg-white border border-slate-200">
                                {rule.severity}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-700">{rule.desc}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* Mechanism C: Behavioural Anomaly Detection */}
                  <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <span>C. Behavioural Anomaly Detection (Supabase Telemetry)</span>
                      </div>
                      <span className="font-mono text-slate-500 text-[10px]">17 Feature Indicators</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[10px]">
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">30d Avg Amount:</span>
                        <strong className="text-slate-900">{formatINR(selectedTx.avg_30d_amount)}</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">Amount Deviation:</span>
                        <strong className="text-slate-900">{selectedTx.amount_deviation_ratio.toFixed(2)}x baseline</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">24h Frequency:</span>
                        <strong className="text-slate-900">{selectedTx.transaction_frequency_24h} transfers</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">7d Beneficiaries:</span>
                        <strong className="text-slate-900">{selectedTx.beneficiary_count_7d || 1} recipients</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">Account Vintage:</span>
                        <strong className="text-slate-900">{selectedTx.account_age_days ?? customer.account_age_days ?? 'N/A'} days</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">Ledger Balance:</span>
                        <strong className="text-slate-900">{formatINR(selectedTx.account_balance ?? customer.account_balance ?? 0)}</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">Failed Tx (24h):</span>
                        <strong className={`${(selectedTx.failed_transactions_24h || 0) > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                          {selectedTx.failed_transactions_24h || 0} attempts
                        </strong>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-slate-500 block">Dormancy Status:</span>
                        <strong className={`${selectedTx.is_dormant_account ? 'text-amber-700' : 'text-slate-900'}`}>
                          {selectedTx.is_dormant_account ? 'Reactivated' : 'Active'}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Important Caution Notice */}
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    Important: A transaction being unusual does not automatically establish guilt or illegality. The monitoring engine prioritizes investigation; the AML officer makes the authorized decision.
                  </span>
                </div>
              </div>

              {/* Section 3: Customer Context */}
              <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-900 tracking-wide flex items-center gap-1.5">
                    <User className="w-4 h-4 text-purple-700" />
                    <span>3. Customer Profile & Historical Risk (Supabase public.customers)</span>
                  </h3>
                  <span className="font-mono text-slate-600 text-[11px] font-semibold">
                    {customer.kyc_status} · {customer.category}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Account Number</span>
                    <div className="text-purple-900 font-mono font-bold mt-0.5">{customer.account_number || selectedTx.account_number}</div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Branch & Type</span>
                    <div className="text-slate-800 text-[11px] font-medium mt-0.5 truncate" title={`${customer.branch} · ${customer.account_type}`}>
                      {customer.branch} · {customer.account_type}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Customer Risk Score</span>
                    <div className={`font-mono font-bold mt-0.5 ${
                      customer.customer_risk_score >= 80 ? 'text-rose-700' : customer.customer_risk_score >= 40 ? 'text-amber-700' : 'text-emerald-700'
                    }`}>
                      {customer.customer_risk_tier} ({customer.customer_risk_score}/100)
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Suspicious Tx on Record</span>
                    <div className="text-amber-800 font-mono font-bold tabular-nums mt-0.5">
                      {customer.suspicious_transactions_count || 0} of {customer.total_transactions_count || 50}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Account Vintage</span>
                    <div className="text-slate-800 font-mono mt-0.5">{customer.account_opened_date}</div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Ledger Balance</span>
                    <div className="text-slate-900 font-mono font-bold tabular-nums mt-0.5">
                      {formatINR(customer.account_balance)}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">30d Total Volume</span>
                    <div className="text-slate-800 font-mono tabular-nums mt-0.5">
                      {formatINR(customer.historical_volume_30d)}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-mono">Prior AML Alerts</span>
                    <div className="text-slate-900 font-mono font-bold tabular-nums mt-0.5">
                      {customer.previous_alerts_count} recorded
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 4: Officer Decision & Disposition */}
              <div className="p-5 rounded-xl bg-gradient-to-br from-orange-50/50 via-purple-50/40 to-white border-2 border-purple-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-purple-100">
                  <div>
                    <h3 className="font-bold text-slate-900 tracking-wide text-sm flex items-center gap-2">
                      <Lock className="w-4 h-4 text-purple-700" />
                      <span>4. Officer Decision & Disposition</span>
                    </h3>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Authorized Officer: <strong className="text-slate-900">{officerName}</strong> ({currentRole})
                    </div>
                  </div>

                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-900 font-bold uppercase">
                    Audited Release
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Action 1: Verify & Pass */}
                  <button
                    onClick={() => {
                      setDecisionModal('verify');
                      setReasonInput(
                        associatedAlert
                          ? `Cleared pattern: Verified commercial documentation for ${associatedAlert.customer_name}. Consistent with legitimate business.`
                          : 'Transaction verified against customer documentation and commercial trade contract.'
                      );
                    }}
                    className="p-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-300 text-left transition-all group shadow-2xs hover:scale-[1.01]"
                  >
                    <div className="flex items-center justify-between font-bold text-emerald-900 text-xs">
                      <span>Verify & Pass</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
                    </div>
                    <p className="text-[11px] text-emerald-700 mt-1 leading-snug">
                      Authorize payment release and transmit instruction to payment gateway.
                    </p>
                  </button>

                  {/* Action 2: Hold Transaction */}
                  <button
                    onClick={() => {
                      setDecisionModal('hold');
                      setReasonInput(
                        'Placing temporary hold pending verification of commercial invoice documentation and counterparty relationship.'
                      );
                      setHoldDuration('48 Hours');
                    }}
                    className="p-3.5 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-300 text-left transition-all group shadow-2xs hover:scale-[1.01]"
                  >
                    <div className="flex items-center justify-between font-bold text-amber-900 text-xs">
                      <span>Hold Transaction</span>
                      <Clock className="w-4 h-4 text-amber-600 group-hover:scale-110 transition-transform" />
                    </div>
                    <p className="text-[11px] text-amber-800 mt-1 leading-snug">
                      Freeze payment in processor; dispatch neutral non-prejudicial customer notice.
                    </p>
                  </button>

                  {/* Action 3: Terminate Transaction */}
                  <button
                    onClick={() => {
                      setDecisionModal('terminate');
                      setReasonInput('Confirmed unauthorized pattern violating AML policy thresholds. Transaction rejected.');
                    }}
                    className="p-3.5 rounded-xl bg-rose-50 hover:bg-rose-100/80 border border-rose-300 text-left transition-all group shadow-2xs hover:scale-[1.01]"
                  >
                    <div className="flex items-center justify-between font-bold text-rose-900 text-xs">
                      <span>Terminate</span>
                      <Ban className="w-4 h-4 text-rose-600 group-hover:scale-110 transition-transform" />
                    </div>
                    <p className="text-[11px] text-rose-700 mt-1 leading-snug">
                      Reject and cancel payment in core system; record termination audit trail.
                    </p>
                  </button>
                </div>

                {/* Secondary Escalation option */}
                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <span className="text-slate-600">Complex cross-border syndicate or legal ambiguity?</span>
                  <button
                    onClick={() => {
                      setDecisionModal('escalate');
                      setReasonInput('Escalating to Compliance Supervisor for secondary syndicate assessment.');
                    }}
                    className="text-purple-800 hover:text-purple-950 font-bold hover:underline flex items-center gap-1"
                  >
                    <span>Escalate to Supervisor</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* History & Audit Tab */
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <h3 className="font-semibold text-slate-900 tracking-wide">
                  Review Decisions & Payment Processor Audit Trail
                </h3>
                <span className="text-[11px] font-mono text-purple-800 font-bold">
                  {txReviews.length} Historical Records
                </span>
              </div>

              {txReviews.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-mono text-xs">
                  No previous review records found for this transaction. Current state: {selectedTx.status}.
                </div>
              ) : (
                txReviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs shadow-2xs"
                  >
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="font-bold text-purple-800">{rev.decision}</span>
                      <span className="text-slate-500">{rev.created_at}</span>
                    </div>

                    <p className="text-slate-800 leading-relaxed text-[11px]">
                      <strong className="text-slate-600">Reason:</strong> {rev.reason}
                    </p>

                    <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
                      <div>
                        Officer: <strong className="text-slate-800">{rev.officer_name}</strong> ({rev.officer_role})
                      </div>
                      <div>
                        Payment Ref: <strong className="text-emerald-700 font-bold">{rev.payment_gateway_ref || 'N/A'}</strong>
                      </div>
                      {rev.customer_notified && (
                        <button
                          onClick={() => {
                            setPreviewNotification({
                              subject: rev.customer_notification_subject || 'Update Regarding Your Transaction',
                              body: rev.customer_notification_body || '',
                              recipient: `${selectedTx.customer_name} (${selectedTx.customer_id})`,
                            });
                          }}
                          className="text-purple-800 hover:underline font-bold flex items-center gap-1"
                        >
                          <span>View Customer Notice</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Decision Actions */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fade-in">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                {decisionModal === 'verify' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {decisionModal === 'hold' && <Clock className="w-5 h-5 text-amber-600" />}
                {decisionModal === 'terminate' && <Ban className="w-5 h-5 text-rose-600" />}
                {decisionModal === 'escalate' && <ShieldAlert className="w-5 h-5 text-purple-600" />}
                <span>
                  Confirm Decision: {decisionModal === 'verify' ? 'Verify & Pass' : decisionModal === 'hold' ? 'Hold Transaction' : decisionModal === 'terminate' ? 'Terminate Transaction' : 'Escalate'}
                </span>
              </h3>
              <button
                onClick={() => setDecisionModal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Information */}
            <div className="p-3 rounded-xl bg-slate-50 text-[11px] text-slate-700 space-y-1.5 border border-slate-200">
              <div className="flex justify-between font-mono">
                <span>TX: <strong className="text-purple-800">{selectedTx.transaction_id}</strong></span>
                <span>Amount: <strong className="text-slate-900">{formatINR(selectedTx.transaction_amount)}</strong></span>
                <span>Score: <strong className="text-rose-700 font-bold">{selectedTx.risk_score !== null ? selectedTx.risk_score : 'Unavailable'}</strong></span>
              </div>
              <div className="text-slate-600 truncate">
                Customer: <strong>{selectedTx.customer_name}</strong> ({selectedTx.customer_id})
              </div>
            </div>

            {/* If part of a group: offer Batch resolution of all linked transactions */}
            {associatedAlert && (
              <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-200 text-xs space-y-2">
                <div className="font-bold text-purple-900 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-purple-700" />
                  <span>Pattern Group Alert: {associatedAlert.alert_id}</span>
                </div>
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyToGroup}
                    onChange={(e) => setApplyToGroup(e.target.checked)}
                    className="mt-0.5 accent-purple-600"
                  />
                  <span className="text-slate-800 leading-tight">
                    Apply this decision to <strong>all {linkedGroupTransactions.length} transactions</strong> in this pattern alert (Total: {formatINR(associatedAlert.total_amount)}).
                  </span>
                </label>
              </div>
            )}

            {decisionModal === 'hold' && (
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Hold Duration Window:
                </label>
                <select
                  value={holdDuration}
                  onChange={(e) => setHoldDuration(e.target.value)}
                  className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:border-purple-500 focus:bg-white"
                >
                  <option value="24 Hours">24 Hours (Fast Commercial Triage)</option>
                  <option value="48 Hours">48 Hours (Standard Verification Window)</option>
                  <option value="7 Days">7 Days (Enhanced Due Diligence / Request for Info)</option>
                  <option value="Indefinite pending KYC">Indefinite (Pending Customer Re-KYC)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Documented Reason & Officer Justification (Mandatory):
              </label>
              <textarea
                rows={3}
                placeholder="State the commercial justification, invoice verification, or AML policy rationale..."
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-500 focus:bg-white leading-relaxed"
              />
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
              {decisionModal === 'verify' && 'The payment processing system will receive an authorized release instruction (simulation mode). Customer will receive release confirmation.'}
              {decisionModal === 'hold' && 'The core system will place a regulatory hold. Neutral customer notice dispatched without tipping off.'}
              {decisionModal === 'terminate' && 'The payment processing system will cancel this transaction. A neutral non-disclosing cancellation notice will be recorded.'}
              {decisionModal === 'escalate' && 'Transfers case responsibility to senior compliance supervisor review.'}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                onClick={() => setDecisionModal(null)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
              <button
                disabled={!reasonInput.trim() || isSubmitting}
                onClick={handleConfirmDecision}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg text-white transition-all disabled:opacity-50 shadow-xs ${
                  decisionModal === 'verify'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : decisionModal === 'hold'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : decisionModal === 'terminate'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-gradient-to-r from-orange-600 to-purple-700 hover:opacity-95'
                }`}
              >
                {isSubmitting ? 'Dispatching...' : applyToGroup && associatedAlert ? `Confirm for Group (${linkedGroupTransactions.length} tx)` : 'Confirm Decision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Dispatched Customer Notice */}
      {previewNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fade-in">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-mono text-purple-800 uppercase font-semibold">
                  Customer Communications Log
                </span>
                <h3 className="text-sm font-bold text-slate-900 mt-0.5">Approved Bank Notification Dispatch</h3>
              </div>
              <button
                onClick={() => setPreviewNotification(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 font-mono text-[11px] text-slate-600 border border-slate-200">
              Recipient: <strong className="text-slate-900">{previewNotification.recipient}</strong>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-xs font-bold text-slate-900 font-mono border-b border-slate-200 pb-1.5">
                {previewNotification.subject}
              </div>
              <div className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                {previewNotification.body}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setPreviewNotification(null)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-purple-700 rounded-lg hover:opacity-95 transition-opacity"
              >
                Close Notice
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
