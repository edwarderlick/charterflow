import React, { useEffect, useState } from 'react';
import { useData } from '../services/dataAccess';
import { NETWORK_CONFIG, VERIFIED_DEPLOYMENT, isContractConfigured } from '../config/network';
import { readPersistedTransactions, type StorageState } from '../services/transactionService';

export const DesignPreviewBanner: React.FC = () => {
  const { isDesignPreview, setDesignPreview } = useData();
  const [storageState, setStorageState] = useState<StorageState | null>(null);

  useEffect(() => {
    try {
      const state = readPersistedTransactions();
      if (state.status === 'corrupt' || state.status === 'denied') {
        setStorageState(state);
      } else if (state.status === 'valid') {
        const unresolvedIntent = state.txs.find(
          (t) => t.status === 'broadcast-unknown' || t.status === 'intent-prepared'
        );
        if (unresolvedIntent) {
          setStorageState({
            status: 'denied',
            txs: state.txs,
            error: `Write intent "${unresolvedIntent.intentId}" (${unresolvedIntent.action}) remains in ${unresolvedIntent.status.toUpperCase()} state. Potential on-chain broadcast unknown; automatic retry is blocked.`,
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  if (storageState) {
    return (
      <div className="w-full bg-[#ff3344]/15 border-b border-[#ff3344] py-2 px-4 lg:px-10 flex flex-wrap items-center justify-between text-xs font-mono text-[#ff3344]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">warning</span>
          <span className="font-bold uppercase">MANUAL RECONCILIATION REQUIRED:</span>
          <span className="text-[#e5e2e1]">
            Local transaction persistence is in {storageState.status.toUpperCase()} state ({storageState.error}). Automatic resubmission is blocked to preserve data integrity.
          </span>
        </div>
        <span className="text-[10px] text-[#ff3344] uppercase tracking-wider font-bold">
          [WRITES BLOCKED]
        </span>
      </div>
    );
  }

  if (!isDesignPreview) {
    const configured = isContractConfigured();
    return (
      <div className="w-full bg-[#1c1b1b] border-b border-[#2a2a2a] py-1.5 px-4 lg:px-10 flex flex-wrap items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${configured ? 'bg-[#00e599]' : 'bg-[#ffb800]'}`}></span>
          <span className="text-[#c8c6c2]">
            {configured
              ? `DEPLOYED CONTRACT CONFIGURED // ${NETWORK_CONFIG.contractAddress.slice(0, 8)}...${NETWORK_CONFIG.contractAddress.slice(-6)} · Chain 61997 · Live reads may fail; round ${VERIFIED_DEPLOYMENT.intendedRoundId} remains unverified.`
              : `Contract address not configured // GenLayer Studio Next (Chain 61997 · RPC: ${NETWORK_CONFIG.rpcUrl}). Live reads are unavailable.`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDesignPreview(true)}
          className="px-2 py-0.5 bg-[#ff5719] text-[#521300] font-bold text-[11px] uppercase tracking-wider hover:bg-white hover:text-black transition-colors"
        >
          SWITCH TO DESIGN PREVIEW ↗
        </button>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#201f1f] border-b border-[#ff5719]/40 py-1.5 px-4 lg:px-10 flex flex-wrap items-center justify-between text-xs font-mono">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-1.5 py-0.5 bg-[#ff5719] text-[#521300] font-bold text-[10px] tracking-widest uppercase">
          DESIGN PREVIEW
        </span>
        <span className="text-[#e5e2e1]">
          Displaying simulated fixture rounds and validator data. A live contract exists, but preview records are separate and no on-chain writes are executed.
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[#c8c6c2] hidden sm:inline text-[11px]">
          [GENLAYER STUDIO NEXT · CHAIN 61997]
        </span>
        <button
          type="button"
          onClick={() => setDesignPreview(false)}
          className="px-2 py-0.5 bg-[#2a2a2a] text-[#e5e2e1] hover:bg-[#353534] border border-[#474743] text-[11px] uppercase tracking-wider transition-colors"
          title="Switch to truthful live reads from the configured deployed contract"
        >
          TOGGLE LIVE MODE (ON-CHAIN READS)
        </button>
      </div>
    </div>
  );
};
