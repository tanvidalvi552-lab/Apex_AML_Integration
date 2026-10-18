import React, { useState, useMemo } from 'react';
import { useAml, PrimaryFilterKey, SubFilterKey } from '../context/AmlContext';
import { formatINR } from '../data/mockAmlData';
import { AmlTransaction, AmlAlert, OfficerRole } from '../types/aml';
import {
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Ban,
  UserCheck,
  Layers,
  ArrowUpRight,
  ShieldAlert,
  Info,
  Sliders,
  Filter,
  AlertCircle,
} from 'lucide-react';

export const AmlOfficerDashboard: React.FC = () => {
  const {
    transactions,
    alerts,
    summaryMetrics,
    primaryFilter,
    setPrimaryFilter,
    subFilter,
    setSubFilter,
    filters,
    setFilters,
    resetFilters,
    selectTx,
    selectedTxId,
    selectAlert,
    groupingMode,
    setGroupingMode,
    officerName,
    currentRole,
    setCurrentRole,
    showToast,
    isLoading,
    dbError,
    dbConnected,
    dataSource,
    refreshData,
    loadDemoData,
  } = useAml();

  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [sortField, setSortField] = useState<'risk_score' | 'transaction_amount' | 'transaction_timestamp'>('risk_score');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Expanded alerts set (which pattern alert groups are currently expanded in the table)
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>({
    'ALT-001': true, // Expanded by default so the officer immediately sees the 10 repeated transactions!
    'ALT-003': false,
  });

  const toggleAlertExpanded = (alertId: string) => {
    setExpandedAlerts((prev) => ({
      ...prev,
      [alertId]: !prev[alertId],
    }));
  };

  const roles: OfficerRole[] = [
    'AML Investigator',
    'AML Supervisor',
    'Compliance Manager',
    'System Administrator',
  ];

  // Filtering Logic based on Primary Filter and Sub Filter
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // 1. Primary Filters: ALL TRANSACTIONS | AUTO-VERIFIED | NEEDS ATTENTION
      if (primaryFilter === 'auto_verified') {
        if (tx.status !== 'Auto-Verified') return false;
      } else if (primaryFilter === 'needs_attention') {
        // Needs Attention: transactions that require officer review or action
        if (subFilter === 'all') {
          // Shows unresolved exceptions: Urgent Review, Further Review, and On Hold
          if (
            tx.status !== 'Urgent Review' &&
            tx.status !== 'Further Review' &&
            tx.status !== 'On Hold' &&
            tx.status !== 'Escalated'
          ) {
            return false;
          }
        } else if (subFilter === 'urgent') {
          if (tx.status !== 'Urgent Review') return false;
        } else if (subFilter === 'further') {
          if (tx.status !== 'Further Review') return false;
        } else if (subFilter === 'on_hold') {
          if (tx.status !== 'On Hold') return false;
        } else if (subFilter === 'passed') {
          if (tx.status !== 'Verified / Passed') return false;
        } else if (subFilter === 'terminated') {
          if (tx.status !== 'Terminated') return false;
        }
      } else {
        // ALL TRANSACTIONS mode
        if (subFilter === 'urgent' && tx.status !== 'Urgent Review') return false;
        if (subFilter === 'further' && tx.status !== 'Further Review') return false;
        if (subFilter === 'on_hold' && tx.status !== 'On Hold') return false;
        if (subFilter === 'passed' && tx.status !== 'Verified / Passed') return false;
        if (subFilter === 'terminated' && tx.status !== 'Terminated') return false;
      }

      // 2. Search Field
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase().trim();
        const matchId = tx.transaction_id.toLowerCase().includes(q);
        const matchCust =
          tx.customer_id.toLowerCase().includes(q) ||
          tx.customer_name.toLowerCase().includes(q) ||
          (tx.account_number && tx.account_number.toLowerCase().includes(q)) ||
          (tx.branch && tx.branch.toLowerCase().includes(q));
        const matchType = (tx.transaction_type || '').toLowerCase().includes(q);
        const matchPattern = tx.pattern_detected.toLowerCase().includes(q);
        const matchBen =
          tx.beneficiary_name.toLowerCase().includes(q) ||
          tx.beneficiary_account.toLowerCase().includes(q);
        if (!matchId && !matchCust && !matchType && !matchPattern && !matchBen) return false;
      }

      // 3. Amount Filter
      if (filters.minAmount !== null && tx.transaction_amount < filters.minAmount) return false;
      if (filters.maxAmount !== null && tx.transaction_amount > filters.maxAmount) return false;

      // 4. Transaction Type (Matching Supabase values and human-friendly aliases)
      if (filters.transactionType !== 'all') {
        const f = filters.transactionType.toUpperCase().replace(/\s+/g, '_');
        const t = (tx.transaction_type || '').toUpperCase().replace(/\s+/g, '_');
        const isMatch =
          t === f ||
          (f === 'CASH_DEPOSIT' && t === 'CASH_DEPOSIT') ||
          (f === 'SWIFT' && t === 'INTERNATIONAL_TRANSFER') ||
          (f === 'INTERNATIONAL_TRANSFER' && t === 'INTERNATIONAL_TRANSFER');
        if (!isMatch) return false;
      }

      // 5. Customer ID
      if (filters.customerId && !tx.customer_id.toLowerCase().includes(filters.customerId.toLowerCase())) return false;

      // 6. Risk Score range
      if (tx.risk_score !== null) {
        if (tx.risk_score < filters.minScore || tx.risk_score > filters.maxScore) return false;
      } else if (filters.minScore > 0) {
        return false;
      }

      return true;
    });
  }, [transactions, primaryFilter, subFilter, filters]);

  // Sorting & Prioritization
  const sortedTransactions = useMemo(() => {
    const list = [...filteredTransactions];

    if (filters.autoPrioritize) {
      list.sort((a, b) => {
        const aUrgent = a.status === 'Urgent Review' ? 200 : a.status === 'Further Review' ? 100 : 0;
        const bUrgent = b.status === 'Urgent Review' ? 200 : b.status === 'Further Review' ? 100 : 0;
        const scoreA = a.risk_score ?? -1;
        const scoreB = b.risk_score ?? -1;
        const weightA = scoreA * 2 + aUrgent + (a.transaction_amount > 200000 ? 30 : 0);
        const weightB = scoreB * 2 + bUrgent + (b.transaction_amount > 200000 ? 30 : 0);
        return weightB - weightA;
      });
    } else {
      list.sort((a, b) => {
        let comp = 0;
        if (sortField === 'risk_score') {
          const scoreA = a.risk_score ?? -1;
          const scoreB = b.risk_score ?? -1;
          comp = scoreB - scoreA;
        } else if (sortField === 'transaction_amount') {
          comp = b.transaction_amount - a.transaction_amount;
        } else if (sortField === 'transaction_timestamp') {
          comp = b.transaction_timestamp.localeCompare(a.transaction_timestamp);
        }
        return sortOrder === 'desc' ? comp : -comp;
      });
    }

    return list;
  }, [filteredTransactions, filters.autoPrioritize, sortField, sortOrder]);

  // Grouped Pattern Alerts matching current filters
  const visibleAlerts = useMemo(() => {
    if (groupingMode !== 'alerts') return [];

    return alerts.filter((alert) => {
      // Find transactions in this alert that match current criteria
      const matchingTxs = alert.transaction_ids.filter((id) =>
        filteredTransactions.some((tx) => tx.transaction_id === id)
      );
      return matchingTxs.length > 0;
    });
  }, [alerts, filteredTransactions, groupingMode]);

  // Pagination for flat table
  const totalItems = sortedTransactions.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedTransactions.slice(start, start + pageSize);
  }, [sortedTransactions, currentPage, pageSize]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
      {/* Top Header: Brand Wordmark with Orange Ink to Purple Gradient & Tanvi Dalvi Persona */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-600 via-amber-600 to-purple-700 flex items-center justify-center text-white font-bold text-base tracking-wider shadow-2xs">
            A
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Apex AML</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-gradient-to-r from-orange-500/10 to-purple-600/10 text-purple-800 border border-purple-200 font-mono">
                Intelligent Monitoring Terminal
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                PMLA / FATF Tier-1
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Automated clearance for routine activity · Human intervention for suspicious patterns
            </p>
          </div>
        </div>

        {/* Lead AML Investigator Persona: Tanvi Dalvi */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <button
              onClick={() => setRoleMenuOpen(!roleMenuOpen)}
              className="flex items-center gap-2.5 px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-200 hover:border-purple-300 shadow-2xs transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-orange-600 via-amber-600 to-purple-700 flex items-center justify-center text-white text-xs font-bold shadow-2xs">
                TD
              </div>
              <div className="leading-tight">
                <div className="text-slate-900 font-bold">{officerName}</div>
                <div className="text-[10px] text-purple-700 font-mono font-medium">
                  {currentRole === 'AML Investigator' ? 'Lead AML Investigator' : currentRole}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
            </button>

            {roleMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setRoleMenuOpen(false)} />
                <div className="absolute right-0 mt-1.5 w-68 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 z-40 animate-fade-in text-xs">
                  <div className="px-3 py-2 border-b border-slate-100 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
                    Authorized Compliance Roles
                  </div>
                  {roles.map((r) => {
                    const nameForRole =
                      r === 'AML Investigator'
                        ? 'Tanvi Dalvi'
                        : r === 'AML Supervisor'
                        ? 'Vikram Mehta'
                        : r === 'Compliance Manager'
                        ? 'Priya Sharma'
                        : 'Rajesh Nair';
                    const isSelected = currentRole === r;

                    return (
                      <button
                        key={r}
                        onClick={() => {
                          setCurrentRole(r);
                          setRoleMenuOpen(false);
                          showToast('Role Switched', `Active officer persona set to ${nameForRole} (${r})`, 'info');
                        }}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors ${
                          isSelected ? 'text-purple-800 font-bold bg-purple-50/60' : 'text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{nameForRole}</div>
                          <div className="text-[10px] font-mono text-slate-500">{r}</div>
                        </div>
                        {isSelected && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold border border-purple-200">
                            ACTIVE
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>


      {/* 2. Top Section: Four Summary Cards (Live Database Counts) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Total Transactions */}
        <div
          onClick={() => {
            setPrimaryFilter('all');
            setSubFilter('all');
            setCurrentPage(1);
          }}
          className={`p-4 rounded-xl border bg-white cursor-pointer transition-all ${
            primaryFilter === 'all' && subFilter === 'all'
              ? 'border-purple-500 ring-2 ring-purple-500/20 shadow-xs'
              : 'border-slate-200 hover:border-purple-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Total Transactions</span>
            <span className="text-[10px] font-mono text-slate-400">All Processed</span>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">
            {summaryMetrics.totalTransactions.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>Complete bank transaction volume</span>
          </div>
        </div>

        {/* Card 2: Auto-Verified */}
        <div
          onClick={() => {
            setPrimaryFilter('auto_verified');
            setSubFilter('all');
            setCurrentPage(1);
          }}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            primaryFilter === 'auto_verified'
              ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
              : 'bg-white border-slate-200 hover:border-emerald-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
            <span>Auto-Verified</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-semibold border border-emerald-200">
              CLEARED
            </span>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-700">
            {summaryMetrics.autoVerified.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-700 font-mono mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            <span>Automatically cleared routine activity</span>
          </div>
        </div>

        {/* Card 3: Urgent Review */}
        <div
          onClick={() => {
            setPrimaryFilter('needs_attention');
            setSubFilter('urgent');
            setCurrentPage(1);
          }}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            primaryFilter === 'needs_attention' && subFilter === 'urgent'
              ? 'bg-rose-50/70 border-rose-500 ring-2 ring-rose-500/20 shadow-xs'
              : 'bg-white border-slate-200 hover:border-rose-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-rose-800">
            <span>Urgent Review</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 font-bold border border-rose-200">
              PRIORITY 1
            </span>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-rose-700">
            {summaryMetrics.urgentReview.toLocaleString()}
          </div>
          <div className="text-[11px] text-rose-700 font-mono mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
            <span>Immediate attention required</span>
          </div>
        </div>

        {/* Card 4: Further Review */}
        <div
          onClick={() => {
            setPrimaryFilter('needs_attention');
            setSubFilter('further');
            setCurrentPage(1);
          }}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            primaryFilter === 'needs_attention' && subFilter === 'further'
              ? 'bg-amber-50/70 border-amber-500 ring-2 ring-amber-500/20 shadow-xs'
              : 'bg-white border-slate-200 hover:border-amber-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-amber-800">
            <span>Further Review</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold border border-amber-200">
              SECONDARY
            </span>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-700">
            {summaryMetrics.furtherReview.toLocaleString()}
          </div>
          <div className="text-[11px] text-amber-700 font-mono mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Awaiting additional verification</span>
          </div>
        </div>
      </div>

      {/* 2. Below: Three Primary Filters Bar & Search / Grouping Controls */}
      <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3">
        {/* The 3 Primary Filters: ALL TRANSACTIONS · AUTO-VERIFIED · NEEDS ATTENTION */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-slate-100">
          <div className="inline-flex p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs font-bold">
            {/* Needs Attention (Default!) */}
            <button
              onClick={() => {
                setPrimaryFilter('needs_attention');
                setSubFilter('all');
                setCurrentPage(1);
              }}
              className={`px-4 py-2 rounded-md transition-all flex items-center gap-2 ${
                primaryFilter === 'needs_attention'
                  ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-rose-600" />
              <span>NEEDS ATTENTION</span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-800">
                {(summaryMetrics.urgentReview + summaryMetrics.furtherReview).toLocaleString()}
              </span>
            </button>

            {/* Auto-Verified */}
            <button
              onClick={() => {
                setPrimaryFilter('auto_verified');
                setSubFilter('all');
                setCurrentPage(1);
              }}
              className={`px-4 py-2 rounded-md transition-all flex items-center gap-2 ${
                primaryFilter === 'auto_verified'
                  ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>AUTO-VERIFIED</span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                {summaryMetrics.autoVerified.toLocaleString()}
              </span>
            </button>

            {/* All Transactions */}
            <button
              onClick={() => {
                setPrimaryFilter('all');
                setSubFilter('all');
                setCurrentPage(1);
              }}
              className={`px-4 py-2 rounded-md transition-all flex items-center gap-2 ${
                primaryFilter === 'all'
                  ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <span>ALL TRANSACTIONS</span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                {summaryMetrics.totalTransactions.toLocaleString()}
              </span>
            </button>
          </div>

          {/* Grouping Toggle: Grouped Pattern Alerts vs Flat Transactions */}
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-slate-500 font-medium">View Mode:</div>
            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
              <button
                onClick={() => setGroupingMode('alerts')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all text-xs ${
                  groupingMode === 'alerts'
                    ? 'bg-white text-purple-900 font-bold border border-slate-200 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Group related transactions into single pattern alert cards (e.g. 10 repeated transfers)"
              >
                <Layers className="w-3.5 h-3.5 text-purple-700" />
                <span>Grouped Pattern Alerts</span>
              </button>
              <button
                onClick={() => setGroupingMode('transactions')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all text-xs ${
                  groupingMode === 'transactions'
                    ? 'bg-white text-purple-900 font-bold border border-slate-200 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Flat Transactions</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sub-Filters & Search Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 pt-1">
          {/* Sub-Filter Tabs for Needs Attention or All Transactions */}
          {primaryFilter !== 'auto_verified' && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <button
                onClick={() => {
                  setSubFilter('all');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  subFilter === 'all'
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                All Exceptions
              </button>
              <button
                onClick={() => {
                  setSubFilter('urgent');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                  subFilter === 'urgent'
                    ? 'bg-rose-700 text-white font-bold'
                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                <span>Urgent Review ({summaryMetrics.urgentReview})</span>
              </button>
              <button
                onClick={() => {
                  setSubFilter('further');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                  subFilter === 'further'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Further Review ({summaryMetrics.furtherReview})</span>
              </button>
              <button
                onClick={() => {
                  setSubFilter('on_hold');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                  subFilter === 'on_hold'
                    ? 'bg-amber-700 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>On Hold ({summaryMetrics.onHold})</span>
              </button>
              <button
                onClick={() => {
                  setSubFilter('passed');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                  subFilter === 'passed'
                    ? 'bg-emerald-700 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Cleared ({summaryMetrics.verifiedPassed})</span>
              </button>
            </div>
          )}

          {/* Search Box */}
          <div className="relative flex-1 max-w-md ml-auto">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search Customer (C0042), Transaction ID, or Pattern..."
              value={filters.searchQuery}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, searchQuery: e.target.value }));
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-500 focus:bg-white font-mono"
            />
          </div>

          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition-colors ${
              showAdvancedFilters
                ? 'bg-purple-50 border-purple-300 text-purple-800 font-semibold'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
          </button>
        </div>

        {/* Advanced Filters Expandable Drawer */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-slate-50/70 p-3 rounded-lg">
            <div>
              <label className="block text-[11px] font-mono text-slate-600 mb-1">
                Amount Range (INR):
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  placeholder="Min ₹"
                  value={filters.minAmount ?? ''}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      minAmount: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className="w-1/2 p-1.5 bg-white border border-slate-200 rounded text-slate-900 font-mono text-xs"
                />
                <input
                  type="number"
                  placeholder="Max ₹"
                  value={filters.maxAmount ?? ''}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      maxAmount: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className="w-1/2 p-1.5 bg-white border border-slate-200 rounded text-slate-900 font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-600 mb-1">
                Payment Channel:
              </label>
              <select
                value={filters.transactionType}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, transactionType: e.target.value }))
                }
                className="w-full p-1.5 bg-white border border-slate-200 rounded text-slate-900 font-mono text-xs"
              >
                <option value="all">All Channels (All Types)</option>
                <option value="CARD">CARD (Debit/Credit)</option>
                <option value="UPI">UPI (Unified Payments)</option>
                <option value="NEFT">NEFT (Electronic Funds)</option>
                <option value="RTGS">RTGS (High-Value Settlement)</option>
                <option value="IMPS">IMPS (Immediate Payment)</option>
                <option value="CASH_DEPOSIT">Cash Deposit (CASH_DEPOSIT)</option>
                <option value="INTERNATIONAL_TRANSFER">International (INTERNATIONAL_TRANSFER)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-600 mb-1">
                Customer Identifier:
              </label>
              <input
                type="text"
                placeholder="e.g. C0042"
                value={filters.customerId}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, customerId: e.target.value }))
                }
                className="w-full p-1.5 bg-white border border-slate-200 rounded text-slate-900 font-mono text-xs"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 mb-1">
                <span>Min Risk Score:</span>
                <span className="text-purple-800 font-bold">{filters.minScore}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={filters.minScore}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, minScore: Number(e.target.value) }))
                }
                className="w-full accent-purple-600 mt-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. The Core Workspace: Grouped Pattern Alerts OR Transaction Table */}
      {groupingMode === 'alerts' && visibleAlerts.length > 0 && primaryFilter !== 'auto_verified' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
            <span className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-purple-700" />
              <span>Pattern-Level Suspicious Clusters ({visibleAlerts.length} Group Alerts)</span>
            </span>
            <span className="text-slate-500 font-normal">
              Review related transactions together without investigating disconnected individual rows
            </span>
          </div>

          {/* Grouped Alert Cards */}
          {visibleAlerts.map((alert) => {
            const isExpanded = !!expandedAlerts[alert.alert_id];
            const linkedTxs = transactions.filter((t) =>
              alert.transaction_ids.includes(t.transaction_id)
            );
            const isResolved = alert.status === 'Resolved';

            return (
              <div
                key={alert.alert_id}
                className={`rounded-xl border transition-all overflow-hidden ${
                  isResolved
                    ? 'bg-slate-50 border-slate-200 opacity-80'
                    : alert.priority === 'Urgent'
                    ? 'bg-white border-rose-300 ring-1 ring-rose-200 shadow-2xs'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}
              >
                {/* Alert Group Header */}
                <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleAlertExpanded(alert.alert_id)}
                      className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 mt-0.5"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-purple-800">
                          {alert.alert_id}
                        </span>
                        <span className="font-bold text-slate-900 text-sm">
                          {alert.alert_type}
                        </span>
                        <span
                          className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                            alert.priority === 'Urgent'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {alert.priority} Priority
                        </span>
                        {isResolved && (
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                            RESOLVED
                          </span>
                        )}
                      </div>
                      <p className="text-slate-600 text-xs mt-1">
                        Customer: <strong className="text-slate-900">{alert.customer_name}</strong> ({alert.customer_id}) · {alert.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono">
                      <div className="text-xs text-slate-500">{linkedTxs.length} Transactions Grouped</div>
                      <div className="text-sm font-bold text-slate-900">{formatINR(alert.total_amount)}</div>
                    </div>

                    <button
                      onClick={() => {
                        selectAlert(alert.alert_id);
                        if (linkedTxs.length > 0) selectTx(linkedTxs[0].transaction_id);
                      }}
                      className="px-3.5 py-1.5 text-xs font-bold rounded-lg text-white bg-gradient-to-r from-orange-600 via-amber-600 to-purple-700 hover:opacity-95 shadow-2xs"
                    >
                      Investigate Pattern
                    </button>
                  </div>
                </div>

                {/* Expanded Group Members Table */}
                {isExpanded && (
                  <div className="overflow-x-auto bg-white">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-100/60 text-slate-600 font-mono text-[11px] uppercase border-b border-slate-200">
                          <th className="py-2.5 px-4">Transaction ID</th>
                          <th className="py-2.5 px-3">Time</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3">Pattern Detected</th>
                          <th className="py-2.5 px-3 text-center">Risk Score</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {linkedTxs.map((tx) => (
                          <tr
                            key={tx.transaction_id}
                            onClick={() => selectTx(tx.transaction_id)}
                            className={`hover:bg-purple-50/40 cursor-pointer transition-colors ${
                              selectedTxId === tx.transaction_id ? 'bg-purple-50/80 font-semibold' : ''
                            }`}
                          >
                            <td className="py-2.5 px-4 font-mono font-bold text-purple-800">
                              {tx.transaction_id}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600">
                              {tx.transaction_timestamp.substring(11, 16)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-slate-900">
                              {formatINR(tx.transaction_amount)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">
                              {tx.pattern_detected}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {tx.risk_score !== null ? (
                                <span className="font-mono font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-xs border border-rose-200">
                                  {tx.risk_score}
                                </span>
                              ) : (
                                <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] border border-slate-200">
                                  Unavailable
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono text-[11px] text-slate-700">
                                {tx.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectTx(tx.transaction_id);
                                }}
                                className="px-3 py-1 text-xs rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold"
                              >
                                Review
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Flat Transaction Table (Shown if Flat mode selected OR in Auto-Verified view OR when scrolling complete table) */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden shadow-2xs space-y-0">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="font-semibold text-slate-800 flex items-center gap-2">
            <span>Transaction Register</span>
            <span className="font-mono text-[11px] text-slate-500 font-normal">
              Showing {paginatedData.length} of {totalItems.toLocaleString()} transactions
            </span>
          </div>

          <div className="text-[11px] text-slate-500 font-mono">
            Mode: {primaryFilter === 'auto_verified' ? 'Auto-Cleared' : primaryFilter === 'needs_attention' ? 'Officer Queue' : 'Complete Ledger'}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3 px-3.5">Transaction ID</th>
                <th className="py-3 px-3.5">Customer</th>
                <th className="py-3 px-3.5 text-right">Amount</th>
                <th className="py-3 px-3.5">Pattern Detected</th>
                <th className="py-3 px-3.5 text-center">Risk Score</th>
                <th className="py-3 px-3.5">Status</th>
                <th className="py-3 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-3 px-3.5">
                      <div className="h-4 bg-slate-200 rounded w-20"></div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="h-4 bg-slate-200 rounded w-36 mb-1"></div>
                      <div className="h-3 bg-slate-100 rounded w-24"></div>
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="h-4 bg-slate-200 rounded w-48"></div>
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <div className="h-5 bg-slate-200 rounded w-10 mx-auto"></div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="h-4 bg-slate-200 rounded w-24"></div>
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <div className="h-6 bg-slate-200 rounded w-16 ml-auto"></div>
                    </td>
                  </tr>
                ))
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    {dbError ? (
                      <div className="max-w-md mx-auto p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900">
                        <AlertCircle className="w-6 h-6 text-rose-600 mx-auto mb-2" />
                        <div className="text-sm font-bold">Supabase Database Access Failed</div>
                        <div className="text-xs text-rose-700 mt-1 font-mono">{dbError}</div>
                        <div className="mt-3 flex items-center justify-center gap-2">
                          <button
                            onClick={() => refreshData()}
                            className="px-3 py-1.5 text-xs text-white bg-rose-700 hover:bg-rose-800 rounded-lg font-semibold shadow-xs"
                          >
                            Retry Database Query
                          </button>
                          <button
                            onClick={() => loadDemoData()}
                            className="px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg font-semibold"
                          >
                            Inspect Demo Dataset
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-semibold text-slate-700">
                          No transactions match the selected criteria
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Reset filters or switch to "All Transactions" to inspect the full dataset.
                        </div>
                        <button
                          onClick={resetFilters}
                          className="mt-3 px-3.5 py-1.5 text-xs text-purple-800 border border-purple-200 rounded-lg bg-purple-50 hover:bg-purple-100 font-semibold"
                        >
                          Reset All Filters
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedData.map((tx) => {
                  const isSelected = selectedTxId === tx.transaction_id;
                  const isUrgent = tx.status === 'Urgent Review';
                  const isFurther = tx.status === 'Further Review';
                  const isAuto = tx.status === 'Auto-Verified';

                  return (
                    <tr
                      key={tx.transaction_id}
                      onClick={() => selectTx(tx.transaction_id)}
                      className={`hover:bg-purple-50/40 transition-colors cursor-pointer group ${
                        isSelected
                          ? 'bg-purple-50/90 ring-1 ring-purple-300 font-semibold'
                          : isUrgent
                          ? 'bg-rose-50/20'
                          : isFurther
                          ? 'bg-amber-50/20'
                          : ''
                      }`}
                    >
                      {/* Transaction ID */}
                      <td className="py-3 px-3.5 font-mono font-bold text-purple-800 whitespace-nowrap">
                        {tx.transaction_id}
                      </td>

                      {/* Customer */}
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{tx.customer_name}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {tx.customer_id} · {tx.account_number !== 'Unavailable' ? tx.account_number : 'Account: Unavailable'}
                          {tx.branch ? ` · ${tx.branch}` : ''}
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatINR(tx.transaction_amount)}
                      </td>

                      {/* Pattern Detected */}
                      <td className="py-3 px-3.5 text-slate-700 max-w-[260px] truncate" title={tx.pattern_detected}>
                        <div className="truncate font-medium">{tx.pattern_detected}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {tx.transaction_timestamp.substring(11, 16)} · {tx.transaction_type}
                        </div>
                      </td>

                      {/* Risk Score & Database Suspicious Indicator */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          {tx.risk_score !== null ? (
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded font-mono font-bold text-xs tabular-nums border ${
                                tx.risk_score >= 70
                                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                                  : tx.risk_score >= 40
                                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              }`}
                            >
                              {tx.risk_score}/100
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded font-mono font-medium text-[10px] text-slate-500 bg-slate-100 border border-slate-200">
                              Unavailable
                            </span>
                          )}
                          {tx.db_suspicious === 1 && (
                            <span
                              className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold"
                              title="Flagged suspicious (suspicious: 1) in Supabase public.aml_transactions table"
                            >
                              DB SUSPICIOUS
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3.5 whitespace-nowrap font-mono text-[11px]">
                        {isAuto && (
                          <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Auto-Verified</span>
                          </span>
                        )}
                        {isUrgent && (
                          <span className="text-rose-700 font-bold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-rose-600" />
                            <span>Urgent Review</span>
                          </span>
                        )}
                        {isFurther && (
                          <span className="text-amber-700 font-semibold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <span>Further Review</span>
                          </span>
                        )}
                        {tx.status === 'On Hold' && (
                          <span className="text-amber-800 font-bold flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>On Hold</span>
                          </span>
                        )}
                        {tx.status === 'Verified / Passed' && (
                          <span className="text-emerald-800 font-bold flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verified / Passed</span>
                          </span>
                        )}
                        {tx.status === 'Terminated' && (
                          <span className="text-rose-800 font-bold flex items-center gap-1.5">
                            <Ban className="w-3.5 h-3.5" />
                            <span>Terminated</span>
                          </span>
                        )}
                        {tx.status === 'Escalated' && (
                          <span className="text-purple-800 font-semibold">Escalated</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectTx(tx.transaction_id);
                          }}
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                            isAuto
                              ? 'text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200'
                              : isUrgent
                              ? 'text-white bg-gradient-to-r from-orange-600 via-amber-600 to-purple-700 hover:opacity-95 shadow-2xs'
                              : isFurther
                              ? 'text-white bg-gradient-to-r from-amber-600 to-purple-700 hover:opacity-95 shadow-2xs'
                              : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200'
                          }`}
                        >
                          {isAuto ? 'View' : 'Review'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div className="font-mono">
            Showing <strong className="text-slate-900">{Math.min(totalItems, (currentPage - 1) * pageSize + 1)}</strong> to{' '}
            <strong className="text-slate-900">{Math.min(totalItems, currentPage * pageSize)}</strong> of{' '}
            <strong className="text-slate-900">{totalItems.toLocaleString()}</strong> transactions
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 font-mono text-xs">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-900"
              >
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1 font-mono">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-100 text-slate-700"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-slate-700 font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-100 text-slate-700"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
