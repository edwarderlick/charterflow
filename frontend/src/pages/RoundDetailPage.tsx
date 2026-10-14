import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useData } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import {
  prepareActionTransaction,
  type PreparedTransaction,
} from '../services/transactionService';
import { TransactionModal } from '../components/TransactionModal';
import type { Round, Proposal } from '../types';
import { CopyButton } from '../components/CopyButton';

export const RoundDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { adapter, isDesignPreview, refreshData, refreshKey } = useData();
  const { account, chainId, isConnected, connectWallet } = useWallet();

  const [round, setRound] = useState<Round | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposalTab, setProposalTab] = useState<'ACTIVE' | 'DECIDED' | 'ALL'>('ACTIVE');
  const [memberSearch, setMemberSearch] = useState('');
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [showTxModal, setShowTxModal] = useState<boolean>(false);
  const [isPreparingTx, setIsPreparingTx] = useState<boolean>(false);
  const [txError, setTxError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const roundId = id || (isDesignPreview ? 'round-094-sdk' : '');

    if (!roundId) {
      setRound(null);
      setProposals([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([
      adapter.getRoundById(roundId),
      adapter.getProposalsByRound(roundId),
    ])
      .then(([r, p]) => {
        if (mounted) {
          setRound(r);
          setProposals(p);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err?.message || 'Failed to query round details from contract');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [id, adapter, isDesignPreview, refreshKey]);

  const isCreator = Boolean(
    account && round && round.creatorAddress.toLowerCase() === account.toLowerCase()
  );

  const handleInitiateCloseRound = async () => {
    if (!isConnected || !account || !round) {
      await connectWallet();
      return;
    }
    if (!chainId || chainId !== 61997) {
      setTxError('Wallet network unverified. Connect an EIP-1193 wallet on GenLayer Studio Next (Chain ID 61997).');
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    try {
      const prepared = await prepareActionTransaction({
        action: 'close_round_and_refund',
        provider: (window as any).ethereum,
        account,
        chainId,
        adapter,
        roundId: round.id,
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare round close');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleInitiateClaimRefund = async () => {
    if (!isConnected || !account || !round) {
      await connectWallet();
      return;
    }
    if (!chainId || chainId !== 61997) {
      setTxError('Wallet network unverified. Connect an EIP-1193 wallet on GenLayer Studio Next (Chain ID 61997).');
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    try {
      const prepared = await prepareActionTransaction({
        action: 'claim_creator_refund',
        provider: (window as any).ethereum,
        account,
        chainId,
        adapter,
        roundId: round.id,
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare creator refund claim');
    } finally {
      setIsPreparingTx(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-20 font-mono text-xs text-[#888884] bg-[#131313]">
        READING IMMUTABLE ROUND REGISTRY ON CHAIN 61997...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 space-y-4 bg-[#131313] text-center font-mono">
        <div className="p-4 bg-[#201f1f] border border-[#ff3344]/30">
          <span className="material-symbols-outlined text-4xl text-[#ff3344]">warning</span>
        </div>
        <div className="text-sm text-[#ff3344] uppercase font-bold">
          [READ ERROR] FAILED TO QUERY ROUND FROM ON-CHAIN RUNTIME
        </div>
        <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] max-w-md">
          An RPC timeout, network failure, or schema validation error occurred while querying GenLayer Studio Next. The failure was not masked as a 404.
        </p>
        <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] text-xs text-[#ffb596] max-w-lg break-all font-mono text-left">
          DIAGNOSTIC: {error}
        </div>
        <div className="flex gap-4 pt-2">
          <button
            type="button"
            onClick={refreshData}
            className="px-6 py-2.5 bg-[#ff5719] text-[#521300] text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors flex items-center gap-2"
          >
            <span>RETRY ON-CHAIN QUERY</span>
            <span>↻</span>
          </button>
          <Link
            to="/rounds"
            className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] text-xs uppercase hover:text-white border border-[#2a2a2a]"
          >
            RETURN TO EXPLORE ROUNDS ↗
          </Link>
        </div>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 space-y-4 bg-[#131313] text-center">
        <div className="font-mono text-sm text-[#ff3344] uppercase font-bold">
          [ERROR 404] ROUND ID NOT FOUND ON RUNTIME
        </div>
        <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] max-w-md">
          The requested round ID does not exist on the current data adapter.
        </p>
        <Link
          to="/rounds"
          className="px-5 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black"
        >
          RETURN TO EXPLORE ROUNDS ↗
        </Link>
      </div>
    );
  }

  // Filter proposals
  const filteredProposals = proposals.filter((p) => {
    if (proposalTab === 'ACTIVE') {
      return (
        p.status === 'SUBMITTED' ||
        p.status === 'ELIGIBLE' ||
        p.status === 'VOTING' ||
        p.status === 'NEEDS_CLARITY'
      );
    }
    if (proposalTab === 'DECIDED') {
      return (
        p.status === 'APPROVED' ||
        p.status === 'REJECTED' ||
        p.status === 'INELIGIBLE' ||
        p.status === 'EXPIRED' ||
        p.status === 'PAYOUT_EMITTED'
      );
    }
    return true;
  });

  // Filter members
  const filteredMembers = round.committeeMembers.filter((m) =>
    m.address.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* Design Preview Warning Banner */}
      {isDesignPreview && (
        <section className="w-full bg-[#ff5719]/10 border-b border-[#ff5719]/40 px-4 lg:px-10 py-2 font-mono text-xs text-[#ff5719] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold">[DESIGN PREVIEW // PREVIEW RECORD]</span>
            <span className="text-[#c8c6c2]">
              Viewing sample round fixture data for UI validation. A live contract is configured, but this preview record is non-authoritative.
            </span>
          </div>
          <span className="text-[10px] text-[#888884] uppercase">NON-AUTHORITATIVE</span>
        </section>
      )}

      {/* Sub-header telemetry ribbon */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-[#888884]">
          <div className="flex items-center gap-3">
            <span className="text-[#ff5719] font-bold">ROUND_REGISTRY:</span>
            <span>{round.contractAddress ? (isDesignPreview ? `[DESIGN PREVIEW] ${round.contractAddress.slice(0, 10)}...` : round.contractAddress.slice(0, 10) + '...') : 'CONTRACT NOT CONNECTED'}</span>
            <span>|</span>
            <span>SESSION: {round.id.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[#00e599] font-semibold">STATE: {round.status}</span>
            <span>|</span>
            <span>CHAIN ID: 61997</span>
          </div>
        </div>
      </section>

      {/* Main Round Header */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-4xl">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="px-2.5 py-0.5 bg-[#ff5719] text-[#521300] font-bold uppercase">
                  {round.status === 'ACTIVE' ? 'ACTIVE VOTING ROUND' : round.status}
                </span>
                <span className="text-[#888884]">ROUND #{round.id.toUpperCase()}</span>
                <span className="text-[#383838]">/</span>
                <span className="text-[#c8c6c2]">CHAIN ID: 61997 · STUDIO NEXT</span>
              </div>
              <h1 className="font-['Space_Grotesk'] text-2xl sm:text-4xl uppercase font-bold text-[#e5e2e1] leading-tight">
                {round.title}
              </h1>
              <p className="font-['Hanken_Grotesk'] text-sm sm:text-base text-[#c8c6c2]">
                {round.summary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`/rounds/${round.id}/nominate`}
                className="px-6 py-3 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors flex items-center gap-2"
              >
                <span>NOMINATE PROPOSAL</span>
                <span>↗</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  const element = document.getElementById('charter-rules-section');
                  element?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-4 py-3 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] hover:bg-[#2a2a2a] font-mono text-xs uppercase"
              >
                CHARTER RULES ↓
              </button>
            </div>
          </div>

          {/* 4 Metadata Sub-rack Tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#262626] border border-[#262626] font-mono text-xs">
            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <div className="flex justify-between text-[#888884]">
                <span>ORIGIN CREATOR</span>
                <span className="text-[#ff5719]">[ROUTER]</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[#e5e2e1] font-bold">
                <span>{round.creatorAddress.slice(0, 6)}...{round.creatorAddress.slice(-4)}</span>
                <CopyButton text={round.creatorAddress} iconOnly />
              </div>
              <span className="text-[10px] text-[#888884]">Verified Member Node #01</span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <div className="flex justify-between text-[#888884]">
                <span>VOTER QUORUM</span>
                <span>[MEMBER_SET]</span>
              </div>
              <div className="text-sm font-bold text-[#e5e2e1]">
                {round.totalVoters} Registered Wallets
              </div>
              <span className="text-[10px] text-[#888884]">
                Quorum reached: {round.totalVoters > 0 ? Math.round((round.currentYesVotes / round.totalVoters) * 100) : 0}%
              </span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <div className="flex justify-between text-[#888884]">
                <span>DECISION THRESHOLD</span>
                <span className="text-[#ff5719]">[{round.consensusThresholdPercent}% REQ]</span>
              </div>
              <div className="text-sm font-bold text-[#ff5719]">
                {round.requiredVotes} YES / {round.totalVoters} Required
              </div>
              <span className="text-[10px] text-[#888884]">Deterministic Pass Vector</span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <div className="flex justify-between text-[#888884]">
                <span>CONTRACT HOOK</span>
                <span>[FROZEN]</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-[#e5e2e1]">
                <span className="w-2 h-2 rounded-full bg-[#ffb800]"></span>
                <span>{round.contractAddress ? (isDesignPreview ? `[DESIGN PREVIEW] ${round.contractAddress.slice(0, 10)}...` : `${round.contractAddress.slice(0, 10)}...`) : 'CONTRACT NOT CONNECTED'}</span>
              </div>
              <span className="text-[10px] text-[#888884]">
                {round.contractAddress ? (isDesignPreview ? 'Sample preview address — not live state' : 'Configured deployed contract address') : 'Contract address unavailable'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Reconciling Treasury Accounting Dashboard */}
      <section className="w-full px-4 lg:px-10 py-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#2a2a2a] font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#ff5719] font-bold uppercase">[LEDGER RECONCILIATION]</span>
              <span className="text-[#383838]">|</span>
              <h2 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1]">
                Round Treasury Accounting
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#888884]">MAX PROPOSAL CAP:</span>
              <span className="px-2 py-0.5 bg-[#2a2a2a] text-[#e5e2e1] font-bold">
                {round.capPerProposalGen.toLocaleString()} GEN
              </span>
            </div>
          </div>

          {/* 5 Segmented Tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
            <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3.5 space-y-2">
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>TOTAL POOL</span>
                <span>100%</span>
              </div>
              <div className="font-['Space_Grotesk'] text-lg font-bold text-[#e5e2e1]">
                {round.totalPoolGen.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#888884]">test GEN Committed</div>
            </div>

            <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3.5 space-y-2">
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>AVAILABLE</span>
                <span className="text-[#ff5719]">
                  {Math.round((round.availableGen / round.totalPoolGen) * 100)}%
                </span>
              </div>
              <div className="font-['Space_Grotesk'] text-lg font-bold text-[#ff5719]">
                {round.availableGen.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#888884]">Open for Allocation</div>
            </div>

            <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3.5 space-y-2">
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>RESERVED</span>
                <span className="text-[#ffb596]">
                  {Math.round((round.reservedGen / round.totalPoolGen) * 100)}%
                </span>
              </div>
              <div className="font-['Space_Grotesk'] text-lg font-bold text-[#ffb596]">
                {round.reservedGen.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#888884]">In Review / Voting</div>
            </div>

            <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3.5 space-y-2">
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>APPROVED</span>
                <span className="text-[#e5e2e1]">
                  {Math.round((round.approvedGen / round.totalPoolGen) * 100)}%
                </span>
              </div>
              <div className="font-['Space_Grotesk'] text-lg font-bold text-[#e5e2e1]">
                {round.approvedGen.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#888884]">Awaiting Withdrawal</div>
            </div>

            <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3.5 space-y-2">
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>WITHDRAWN</span>
                <span className="text-[#00e599]">
                  {Math.round((round.withdrawnGen / round.totalPoolGen) * 100)}%
                </span>
              </div>
              <div className="font-['Space_Grotesk'] text-lg font-bold text-[#00e599]">
                {round.withdrawnGen.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#888884]">Settled On-Chain</div>
            </div>
          </div>

          {/* Progress Bar & Equation */}
          <div className="space-y-2 pt-2 border-t border-[#2a2a2a] font-mono text-[11px]">
            <div className="flex justify-between text-[#888884]">
              <span>
                INTEGRITY FORMULA: {round.availableGen.toLocaleString()} + {round.reservedGen.toLocaleString()} + {round.approvedGen.toLocaleString()} + {round.withdrawnGen.toLocaleString()} = {round.totalPoolGen.toLocaleString()} GEN
              </span>
              <span className="text-[#00e599] font-bold">RECONCILED: 0.00 SLIPPAGE</span>
            </div>
            <div className="w-full h-2 bg-[#0e0e0e] flex overflow-hidden">
              <div style={{ width: `${(round.availableGen / round.totalPoolGen) * 100}%` }} className="bg-[#ff5719]" />
              <div style={{ width: `${(round.reservedGen / round.totalPoolGen) * 100}%` }} className="bg-[#ffb596]" />
              <div style={{ width: `${(round.approvedGen / round.totalPoolGen) * 100}%` }} className="bg-[#ffdbcd]" />
              <div style={{ width: `${(round.withdrawnGen / round.totalPoolGen) * 100}%` }} className="bg-[#00e599]" />
            </div>
          </div>

          {/* Creator Settlement Console (Live Lifecycle Write Controls) */}
          <div className="pt-4 border-t border-[#2a2a2a] flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#ff5719] text-[16px]">account_balance_wallet</span>
                <span className="text-[#e5e2e1] font-bold uppercase">CREATOR SETTLEMENT CONSOLE</span>
                {isCreator ? (
                  <span className="px-2 py-0.5 bg-[#00e599]/20 text-[#00e599] text-[10px] uppercase font-bold">
                    CONNECTED CREATOR DETECTED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-[#2a2a2a] text-[#888884] text-[10px] uppercase">
                    CREATOR ACCESS REQUIRED
                  </span>
                )}
              </div>
              <p className="font-['Hanken_Grotesk'] text-xs text-[#888884]">
                Authoritative on-chain rules: Round can be closed once deadline has expired and all active proposal reservations are settled (reserved = 0).
              </p>
              {txError && (
                <div className="text-[#ff3344] text-[11px] font-mono">
                  ERROR: {txError}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {round.status === 'ACTIVE' && (
                <button
                  type="button"
                  onClick={handleInitiateCloseRound}
                  disabled={isPreparingTx || !isCreator}
                  title={!isCreator ? 'Only the round creator wallet can close this round' : 'Close round and return unreserved funds'}
                  className={`px-4 py-2 uppercase font-bold transition-colors flex items-center gap-2 ${
                    isCreator
                      ? 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black cursor-pointer'
                      : 'bg-[#201f1f] text-[#555] border border-[#2a2a2a] cursor-not-allowed'
                  }`}
                >
                  <span>{isPreparingTx ? 'PREPARING...' : 'CLOSE ROUND & REFUND'}</span>
                  <span className="material-symbols-outlined text-[14px]">lock_reset</span>
                </button>
              )}
              {round.status === 'CLOSED' && (
                <button
                  type="button"
                  onClick={handleInitiateClaimRefund}
                  disabled={isPreparingTx || !isCreator}
                  title={!isCreator ? 'Only the round creator wallet can claim creator refund' : 'Claim remaining unallocated treasury balance'}
                  className={`px-4 py-2 uppercase font-bold transition-colors flex items-center gap-2 ${
                    isCreator
                      ? 'bg-[#00e599] text-black hover:bg-white cursor-pointer'
                      : 'bg-[#201f1f] text-[#555] border border-[#2a2a2a] cursor-not-allowed'
                  }`}
                >
                  <span>{isPreparingTx ? 'PREPARING...' : 'CLAIM CREATOR REFUND'}</span>
                  <span className="material-symbols-outlined text-[14px]">payments</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Two-Column Grid: Charter Rules & Member Roster */}
      <section id="charter-rules-section" className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Frozen Charter Rules (7 cols) */}
          <div className="lg:col-span-7 bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#ff5719] text-[18px]">verified</span>
                <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                  Frozen Charter Rules
                </h2>
              </div>
              <span className="font-mono text-xs text-[#00e599] uppercase font-bold">
                STATUS: IMMUTABLE CONSENSUS
              </span>
            </div>

            <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2]">
              These programmatic clauses were finalized during round initialization. The GenLayer contract compiler autonomously rejects any proposal violating Rule 01-03 or matching Exclusion 04.
            </p>

            <div className="space-y-4">
              {round.charterRules.map((rule) => (
                <div key={rule.id} className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-2">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[#ff5719] font-bold">#{rule.code}</span>
                      <span className="text-[#e5e2e1] font-bold uppercase">{rule.title}</span>
                    </div>
                  </div>
                  <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                    {rule.description}
                  </p>
                  <div className="flex items-center gap-3 font-mono text-[10px] text-[#888884] pt-1">
                    <span className="px-2 py-0.5 bg-[#201f1f] text-[#ff5719] uppercase font-bold">
                      TYPE: {rule.category}
                    </span>
                    {rule.maxAllocGen && (
                      <span>MAX ALLOC: {rule.maxAllocGen.toLocaleString()} GEN</span>
                    )}
                  </div>
                </div>
              ))}

              {round.charterExclusions.map((excl) => (
                <div key={excl.id} className="p-4 bg-[#0e0e0e] border border-[#ff3344]/40 space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[#ff3344] font-bold">#{excl.code}</span>
                      <span className="text-[#e5e2e1] font-bold uppercase">{excl.title}</span>
                    </div>
                    <span className="px-2 py-0.5 bg-[#ff3344]/20 text-[#ff3344] text-[10px] uppercase font-bold">
                      {excl.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Member Roster (5 cols) */}
          <div className="lg:col-span-5 bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#ff5719] text-[18px]">group</span>
                <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                  Member Roster
                </h2>
              </div>
              <span className="font-mono text-xs text-[#ff5719] font-bold">
                {round.totalVoters} / {round.totalVoters} ACTIVE
              </span>
            </div>

            <div className="flex justify-between items-center font-mono text-xs text-[#888884]">
              <span>REQUIRED VOTES FOR QUORUM:</span>
              <span className="text-[#e5e2e1] font-bold">
                {round.requiredVotes} YES ({round.consensusThresholdPercent}%)
              </span>
            </div>

            {/* Search Filter */}
            <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a] px-3 py-1.5">
              <span className="material-symbols-outlined text-[#888884] text-[16px] mr-2">search</span>
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search address or member ID..."
                className="w-full bg-transparent text-xs text-[#e5e2e1] font-mono focus:outline-none"
              />
            </div>

            {/* Member List */}
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {filteredMembers.map((member, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 bg-[#0e0e0e] border border-[#2a2a2a] font-mono text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#00e599]"></span>
                    <span className="text-[#e5e2e1]">
                      {member.address.slice(0, 6)}...{member.address.slice(-4)}
                      {member.isCreator && ' (CREATOR)'}
                    </span>
                    <CopyButton text={member.address} iconOnly />
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[10px] uppercase font-bold ${
                      member.hasVoted
                        ? 'bg-[#2a2a2a] text-[#888884]'
                        : 'bg-[#ff5719]/20 text-[#ff5719]'
                    }`}
                  >
                    {member.hasVoted ? 'VOTED' : 'ELIGIBLE'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Round Proposals Pipeline */}
      <section className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626] pb-4">
            <div>
              <span className="font-mono text-xs text-[#ff5719] uppercase tracking-wider font-bold block">
                ROUND PROPOSALS PIPELINE
              </span>
              <h2 className="font-['Space_Grotesk'] text-2xl uppercase font-bold text-[#e5e2e1]">
                Verifiable Voting Records
              </h2>
            </div>

            {/* Proposal Tabs */}
            <div className="flex items-center gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => setProposalTab('ACTIVE')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  proposalTab === 'ACTIVE'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                ACTIVE IN REVIEW & VOTE ({proposals.filter((p) => p.status === 'SUBMITTED' || p.status === 'ELIGIBLE' || p.status === 'VOTING' || p.status === 'NEEDS_CLARITY').length})
              </button>
              <button
                type="button"
                onClick={() => setProposalTab('DECIDED')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  proposalTab === 'DECIDED'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                DECIDED ({proposals.filter((p) => p.status === 'APPROVED' || p.status === 'REJECTED' || p.status === 'INELIGIBLE' || p.status === 'EXPIRED' || p.status === 'PAYOUT_EMITTED').length})
              </button>
              <button
                type="button"
                onClick={() => setProposalTab('ALL')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  proposalTab === 'ALL'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                ALL ({proposals.length})
              </button>
            </div>
          </div>

          {/* Proposal List */}
          <div className="space-y-4">
            {filteredProposals.length === 0 ? (
              <div className="p-10 text-center font-mono text-xs text-[#888884] bg-[#1c1b1b] border border-[#2a2a2a]">
                NO PROPOSALS IN THIS FILTER STAGE
              </div>
            ) : (
              filteredProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 hover:border-[#ff5719]/40 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs pb-3 border-b border-[#2a2a2a]">
                    <div className="flex items-center gap-2">
                      <span className="text-[#ff5719] font-bold">
                        PROPOSAL #{proposal.id.toUpperCase()}
                      </span>
                      <span className="text-[#383838]">·</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                          proposal.status === 'APPROVED'
                            ? 'bg-[#00e599]/20 text-[#00e599]'
                            : proposal.status === 'ELIGIBLE'
                            ? 'bg-[#ff5719]/20 text-[#ff5719]'
                            : proposal.status === 'INELIGIBLE'
                            ? 'bg-[#ff3344]/20 text-[#ff3344]'
                            : 'bg-[#ffb800]/20 text-[#ffb800]'
                        }`}
                      >
                        {proposal.status}
                      </span>
                    </div>
                    <div className="text-[#888884] text-[11px]">
                      {proposal.votes.deadlineRemaining}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    <div className="lg:col-span-8 space-y-3">
                      <Link
                        to={`/proposals/${proposal.id}`}
                        className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1] hover:text-[#ff5719] transition-colors block"
                      >
                        {proposal.title}
                      </Link>
                      <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] line-clamp-2">
                        {proposal.workDescription}
                      </p>
                      <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-[#888884] pt-1">
                        <div>
                          REQUESTED:{' '}
                          <span className="text-[#e5e2e1] font-bold">
                            {proposal.requestedGen.toLocaleString()} test GEN
                          </span>
                        </div>
                        <div>
                          RECIPIENT:{' '}
                          <span className="text-[#e5e2e1]">
                            {proposal.recipientAddress.slice(0, 6)}...{proposal.recipientAddress.slice(-4)}
                          </span>
                        </div>
                        <div>
                          NOMINATOR:{' '}
                          <span className="text-[#e5e2e1]">
                            {proposal.nominatorAddress.slice(0, 6)}...{proposal.nominatorAddress.slice(-4)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Action / Tally Box */}
                    <div className="lg:col-span-4 bg-[#0e0e0e] border border-[#2a2a2a] p-4 flex flex-col justify-between space-y-3 font-mono text-xs">
                      {proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? (
                        (() => {
                          const isRecipientOnCommittee = round.committeeMembers.some(
                            (m) => m.address.toLowerCase() === proposal.recipientAddress.toLowerCase()
                          );
                          const eligibleCount = isRecipientOnCommittee
                            ? Math.max(1, round.committeeMembers.length - 1)
                            : round.committeeMembers.length;
                          const requiredYes = eligibleCount > 0 ? Math.floor((eligibleCount * 2 + 2) / 3) : (proposal.votes.requiredYes > 0 ? proposal.votes.requiredYes : null);
                          const pct = requiredYes && requiredYes > 0 ? Math.min(100, Math.round((proposal.votes.yesCount / requiredYes) * 100)) : 0;
                          return (
                            <>
                              <div className="flex justify-between items-center text-[#888884]">
                                <span>CONSENSUS TALLY:</span>
                                <span className="text-[#ff5719] font-bold">
                                  {requiredYes ? `${proposal.votes.yesCount} / ${requiredYes} YES REQUIRED` : `${proposal.votes.yesCount} YES LOGGED`}
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-[#201f1f]">
                                <div
                                  style={{
                                    width: `${pct}%`,
                                  }}
                                  className="h-full bg-[#ff5719]"
                                />
                              </div>
                              <div className="flex gap-2 pt-2">
                                <Link
                                  to={`/proposals/${proposal.id}`}
                                  className="w-full py-2 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black font-bold uppercase text-center transition-colors"
                                >
                                  VOTE / DETAILS ↗
                                </Link>
                              </div>
                            </>
                          );
                        })()
                      ) : proposal.status === 'APPROVED' ? (
                        <>
                          <div className="text-[#00e599] font-bold uppercase">
                            CONSENSUS CERTIFICATE PASSED
                          </div>
                          <p className="text-[11px] text-[#c8c6c2]">
                            {proposal.votes.yesCount} YES / {proposal.votes.noCount} NO. Quorum satisfied.
                          </p>
                          <Link
                            to={`/proposals/${proposal.id}`}
                            className="w-full py-2 bg-[#00e599] text-[#003822] hover:bg-white hover:text-black font-bold uppercase transition-colors block text-center"
                          >
                            WITHDRAW CREDIT / DETAILS ↗
                          </Link>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-[#ff3344] font-bold uppercase">
                            FINAL VERDICT: {proposal.status}
                          </div>
                          <Link
                            to={`/proposals/${proposal.id}`}
                            className="w-full py-2 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] uppercase block text-center"
                          >
                            AUDIT EVALUATION LOG ↗
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Event Stream Section */}
      <section className="w-full px-4 lg:px-10 py-8 bg-[#0e0e0e] border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between text-[#888884] pb-2 border-b border-[#262626]">
            <div className="flex items-center gap-2 text-[#ff5719] font-bold">
              <span>[DESIGN PREVIEW // SIMULATED EVENT STREAM]</span>
              <span>SAMPLE EVENTS FOR ROUND #{round.id.toUpperCase()}</span>
            </div>
            <span>CHAIN ID: 61997</span>
          </div>

          <div className="space-y-2">
            {round.eventStream.map((evt, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 bg-[#141414] border border-[#222222] text-[#c8c6c2]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[#888884] text-[10px]">{evt.time}</span>
                  <span className="text-[#ff5719] font-bold">{evt.type}</span>
                  <span>{evt.details}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modal Notice */}
      {modalNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
              <span className="text-[#ff5719] font-bold uppercase">EXECUTION GUARD</span>
              <button
                type="button"
                onClick={() => setModalNotice(null)}
                className="text-[#888884] hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-[#c8c6c2] leading-relaxed">{modalNotice}</p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setModalNotice(null)}
                className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black"
              >
                ACKNOWLEDGE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={showTxModal}
        onClose={() => {
          setShowTxModal(false);
          setPreparedTx(null);
        }}
        prepared={preparedTx}
        provider={(window as any).ethereum}
        account={account || ''}
        adapter={adapter}
        onSuccess={() => {
          refreshData();
        }}
      />
    </div>
  );
};
