/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AmlProvider, useAml } from './context/AmlContext';
import { AmlOfficerDashboard } from './components/AmlOfficerDashboard';
import { TransactionDetailsPanel } from './components/TransactionDetailsPanel';
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react';

const DashboardShell: React.FC = () => {
  const { toasts, dismissToast, selectedTxId } = useAml();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col relative antialiased selection:bg-orange-500/20 selection:text-purple-900">
      {/* Main Single-Screen Dashboard View */}
      <main className="flex-1">
        <AmlOfficerDashboard />
      </main>

      {/* Transaction Details Side-Panel (Opens when officer selects a row or clicks Review) */}
      {selectedTxId && <TransactionDetailsPanel />}

      {/* Interactive Toast Notifications (Light Mode with crisp shadows) */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto p-4 rounded-xl bg-white border border-slate-200 shadow-xl flex items-start justify-between gap-3 text-xs animate-slide-up"
          >
            <div className="flex items-start gap-2.5">
              {toast.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              )}
              {toast.type === 'warning' && (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              {toast.type === 'info' && (
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center shrink-0 mt-0.5 text-white">
                  <Info className="w-2.5 h-2.5" />
                </div>
              )}
              {toast.type === 'error' && (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-semibold text-slate-900">{toast.title}</div>
                <div className="text-slate-500 text-[11px] mt-0.5 leading-relaxed font-sans">
                  {toast.description}
                </div>
              </div>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AmlProvider>
      <DashboardShell />
    </AmlProvider>
  );
}
