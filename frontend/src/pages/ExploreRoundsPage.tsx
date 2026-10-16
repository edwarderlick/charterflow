import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import type { Round } from '../types';
import { NETWORK_CONFIG, isContractConfigured, isLockedRecoveryRound } from '../config/network';
import { VerifiedDeploymentLinks } from '../components/VerifiedDeploymentLinks';
import { canNominate } from '../services/permissions';
import { createRoundTxHash } from '../services/reconciledCreateRounds';
import { commitDraftsForVerifiedRounds, firstUncommittedRoundDraft, readRoundDraftInventory } from '../services/roundDraft';
import {
  countOpenRounds,
  exploreRoundStatusClass,
  exploreRoundStatusLabel,
  roundMatchesExploreTab,
} from '../services/exploreRoundStatus';


export const ExploreRoundsPage: React.FC = () => {
  const { adapter, isDesignPreview, setDesignPreview, refreshData, refreshKey } = useData();
  const { account, isConnected, isCorrectNetwork } = useWallet();

  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'CLOSED' | 'COMPLIANCE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'RECENT' | 'POOL_HIGH' | 'CAP_HIGH'>('RECENT');
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const draftInventory = useMemo(
    () => (typeof window === 'undefined' ? { preview: null, live: null, working: null } : readRoundDraftInventory(window.localStorage)),
    [draftRevision]
  );
  const visibleDraft = firstUncommittedRoundDraft(draftInventory);

  useEffect(() => {
    if (isDesignPreview || loading || error || typeof window === 'undefined') return;
    const result = commitDraftsForVerifiedRounds(
      window.localStorage,
      rounds.map((round) => ({ id: round.id, title: round.title }))
    );
    if (result.committedStores.length > 0) setDraftRevision((value) => value + 1);
  }, [isDesignPreview, loading, error, rounds]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    adapter
      .getRounds()
      .then((res) => {
        if (mounted) {
          setRounds(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err?.message || 'Failed to query rounds from contract');
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [adapter, refreshKey]);

  // Aggregate stats
  const totalLockedGen = rounds.reduce((sum, r) => sum + r.totalPoolGen, 0);
  const totalInReviewGen = rounds.reduce((sum, r) => sum + r.reservedGen, 0);
  const activeRoundsCount = countOpenRounds(rounds);
  const closedRoundsCount = rounds.filter((r) => roundMatchesExploreTab(r.status, 'CLOSED')).length;
  const complianceRoundsCount = rounds.filter((r) => roundMatchesExploreTab(r.status, 'COMPLIANCE')).length;

  // Filter logic
  const filteredRounds = rounds
    .filter((r) => roundMatchesExploreTab(r.status, activeTab))
    .filter((r) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q)
      );
    })
    .filter((r) => {
      if (!onlyEligible) return true;
      if (!account) return false;
      return r.committeeMembers.some((m) => m.address.toLowerCase() === account.toLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === 'POOL_HIGH') return b.totalPoolGen - a.totalPoolGen;
      if (sortBy === 'CAP_HIGH') return b.capPerProposalGen - a.capPerProposalGen;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* Telemetry Sub-Navigation Ribbon */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-[#ff5719]">
              <span className="inline-block w-2 h-2 rounded-full bg-[#ff5719] animate-pulse"></span>
              <span className="font-bold tracking-widest uppercase">
                ACTIVE ROUNDS: {loading || error ? '--' : String(activeRoundsCount).padStart(2, '0')}
              </span>
            </div>
            <span className="text-[#383838]">/</span>
            <div className="flex items-center gap-1">
              <span className="text-[#888884]">TOTAL LOCKED:</span>
              <span className="text-[#e5e2e1] font-semibold">
                {loading || error ? '--' : `${totalLockedGen.toLocaleString()} TEST GEN`}
              </span>
            </div>
            <span className="text-[#383838]">/</span>
            <div className="flex items-center gap-1">
              <span className="text-[#888884]">IN REVIEW:</span>
              <span className="text-[#ffb596] font-semibold">
                {loading || error ? '--' : `${totalInReviewGen.toLocaleString()} TEST GEN`}
              </span>
            </div>
            <span className="text-[#383838]">/</span>
            <div className="flex items-center gap-1">
              <span className="text-[#888884]">RUNTIME:</span>
              <span className="text-[#e5e2e1]">GENLAYER #61997</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[#888884]">
            <div className="flex items-center gap-1">
              <span className="text-[#ff5719] font-bold">[STATE]</span>
              <span>STUDIO NEXT TESTNET</span>
            </div>
            <span>|</span>
            <div className={`flex items-center gap-1 ${isContractConfigured() ? 'text-[#00e599]' : 'text-[#ffb800]'}`}>
              <span className="material-symbols-outlined text-[13px]">{isContractConfigured() ? 'link' : 'link_off'}</span>
              <span>
                {isContractConfigured()
                  ? `CONTRACT CONFIGURED: ${NETWORK_CONFIG.contractAddress.slice(0, 6)}...${NETWORK_CONFIG.contractAddress.slice(-4)}`
                  : 'CONTRACT ADDRESS NOT CONFIGURED'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Editorial Section Header */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-[#2a2a2a] text-[#ff5719] font-mono text-[10px] tracking-widest uppercase">
                REGISTRY v0.9
              </span>
              <span className="text-[#888884] font-mono text-[10px] uppercase tracking-wider">
                GENLAYER INTELLIGENT PROTOCOL // RUNTIME 61997
              </span>
            </div>
            <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl uppercase text-[#e5e2e1] font-bold tracking-tight">
              Explore Grant Rounds
            </h1>
            <p className="font-['Hanken_Grotesk'] text-sm sm:text-base text-[#c8c6c2] max-w-3xl">
              Verifiable industrial treasuries governed by frozen natural language charters on GenLayer Studio Next. Multi-node AI validator consensus evaluates charter fit, followed by member voting to authorize grant credits and recipient withdrawals. Wallet connection is not required to inspect rounds.
            </p>
            <VerifiedDeploymentLinks compact />
          </div>
          <div>
            <Link
              to="/rounds/new"
              className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black transition-colors font-mono text-xs uppercase font-bold tracking-wider"
            >
              <span className="material-symbols-outlined text-[16px]">add_box</span>
              <span>Create Round</span>
              <span>↗</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Filter & View Modular Control Deck */}
      <section className="w-full px-4 lg:px-10 py-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto bg-[#1c1b1b] border border-[#2a2a2a] p-4">
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
            {/* Status Tabs */}
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('ALL')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  activeTab === 'ALL'
                    ? 'bg-[#353534] text-[#ff5719]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                All Rounds ({loading || error ? '--' : rounds.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ACTIVE')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  activeTab === 'ACTIVE'
                    ? 'bg-[#353534] text-[#ff5719]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                Active / Voting Open ({loading || error ? '--' : activeRoundsCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('CLOSED')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  activeTab === 'CLOSED'
                    ? 'bg-[#353534] text-[#ff5719]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                Finalized / Closed ({loading || error ? '--' : closedRoundsCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('COMPLIANCE')}
                className={`px-3 py-1.5 uppercase font-bold transition-colors ${
                  activeTab === 'COMPLIANCE'
                    ? 'bg-[#353534] text-[#ff5719]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                Compliance Stage ({loading || error ? '--' : complianceRoundsCount})
              </button>
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
              {/* Search */}
              <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a] px-3 py-1.5 w-full sm:w-64">
                <span className="material-symbols-outlined text-[#888884] text-[16px] mr-2">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="FILTER BY ID, TAG, OR CHARTER..."
                  className="w-full bg-transparent text-[#e5e2e1] focus:outline-none placeholder:text-[#5c4037] text-xs"
                />
              </div>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-2 bg-[#201f1f] border border-[#2a2a2a] px-3 py-1.5 text-[#c8c6c2]">
                <span className="text-[#888884]">SORT:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-transparent text-[#e5e2e1] font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="RECENT" className="bg-[#1c1b1b]">RECENTLY DEPLOYED</option>
                  <option value="POOL_HIGH" className="bg-[#1c1b1b]">HIGHEST POOL</option>
                  <option value="CAP_HIGH" className="bg-[#1c1b1b]">HIGHEST PROPOSAL CAP</option>
                </select>
              </div>

              {/* Eligibility Toggle */}
              <label className="flex items-center gap-2 cursor-pointer text-[#c8c6c2] select-none bg-[#201f1f] border border-[#2a2a2a] px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={onlyEligible}
                  onChange={(e) => setOnlyEligible(e.target.checked)}
                  className="accent-[#ff5719]"
                />
                <span className="text-xs uppercase">MY ELIGIBLE ROUNDS</span>
              </label>
            </div>
          </div>
        </div>
      </section>      {/* Rounds Grid / Truthful Empty State */}
      <section className="w-full px-4 lg:px-10 py-10">
        <div className="max-w-7xl mx-auto">
          {/* Findable Local Draft Display — never presented as an on-chain round */}
          {visibleDraft && (
            <div className="mb-8 p-5 bg-[#1c1b1b] border border-[#ff5719] font-mono text-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-[#ff5719] text-[#521300] font-bold uppercase">
                    LOCAL DRAFT · NOT ON-CHAIN
                  </span>
                  <span className="text-[#e5e2e1] font-bold text-sm">
                    {visibleDraft.title || 'Untitled Round Draft'}
                  </span>
                </div>
                <p className="text-[#888884] text-[11px]">
                  Uncommitted genesis specification in browser storage (cf_round_draft_preview / cf_round_draft_live). This is not a created round.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/rounds/new"
                  className="px-5 py-2.5 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
                >
                  RESTORE LOCAL DRAFT ↗
                </Link>
              </div>
            </div>
          )}

          {onlyEligible && !account && (
            <div className="mb-6 p-4 bg-[#201f1f] border border-[#ffb800]/40 font-mono text-xs text-[#ffb800] flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">info</span>
              <span>No wallet connected. Connect your wallet to view rounds where you hold verified committee voting credentials.</span>
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center font-mono text-xs text-[#888884] bg-[#1c1b1b] border border-[#2a2a2a]">
              QUERYING REGISTRY MEMORY CACHE ON RUNTIME #61997...
            </div>
          ) : error ? (
            /* Error / Incomplete State with Retry */
            <div className="bg-[#1c1b1b] border border-[#ff3344]/50 p-12 text-center space-y-6">
              <div className="inline-block p-4 bg-[#201f1f] border border-[#ff3344]/30">
                <span className="material-symbols-outlined text-4xl text-[#ff3344]">
                  warning
                </span>
              </div>
              <div className="space-y-2 max-w-lg mx-auto font-mono">
                <h3 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#ff3344]">
                  [READ ERROR] ON-CHAIN QUERY FAILED
                </h3>
                <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                  The application encountered an RPC or validation failure while querying GenLayer Studio Next. The data could not be verified and was not swallowed as an empty state.
                </p>
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] text-xs text-[#ffb596] text-left break-all font-mono">
                  DIAGNOSTIC: {error}
                </div>
              </div>
              <div className="flex justify-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={refreshData}
                  className="px-6 py-3 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors flex items-center gap-2"
                >
                  <span>RETRY ON-CHAIN QUERY</span>
                  <span>↻</span>
                </button>
              </div>
            </div>
          ) : filteredRounds.length === 0 ? (
            /* Truthful Empty State */
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-12 text-center space-y-6">
              <div className="inline-block p-4 bg-[#201f1f] border border-[#ff5719]/30">
                <span className="material-symbols-outlined text-4xl text-[#ff5719]">
                  layers_clear
                </span>
              </div>
              <div className="space-y-2 max-w-lg mx-auto">
                <h3 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">
                  {isDesignPreview
                    ? 'No Matching Rounds Located'
                    : !isContractConfigured()
                    ? 'Contract Address Not Configured'
                    : 'No Live Rounds Found On-Chain'}
                </h3>
                <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                  {isDesignPreview
                    ? 'No rounds match the selected filter criteria. Try adjusting the search query or status filter.'
                    : !isContractConfigured()
                    ? `No contract address is configured for GenLayer Studio Next (Chain 61997 · RPC: ${NETWORK_CONFIG.rpcUrl}). Add a verified public deployment address before attempting live reads.`
                    : `The contract at ${NETWORK_CONFIG.contractAddress} currently contains 0 registered grant rounds on GenLayer Studio Next.`}
                </p>
              </div>
              <div className="flex justify-center gap-4 pt-2">
                {isDesignPreview ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setActiveTab('ALL');
                      setOnlyEligible(false);
                    }}
                    className="px-5 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    RESET FILTERS
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDesignPreview(true)}
                    className="px-5 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    ENABLE DESIGN PREVIEW MODE ↗
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredRounds.map((round) => {
                const total = round.totalPoolGen;
                const availPct = Math.round((round.availableGen / total) * 100);
                const resPct = Math.round((round.reservedGen / total) * 100);
                const appPct = Math.round((round.approvedGen / total) * 100);

                return (
                  <div
                    key={round.id}
                    className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-6 hover:border-[#ff5719]/50 transition-colors"
                  >
                    <div className="space-y-4">
                      {/* Top Bar */}
                      <div className="flex items-center justify-between font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-[#ff5719] uppercase font-bold">
                            ROUND #{round.id.toUpperCase()} · CHAIN 61997
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-[#262626] text-[#888884] uppercase">
                            {round.legacyRecovery ? 'LEGACY RECOVERY' : isDesignPreview ? 'PREVIEW RECORD' : 'ON-CHAIN STATE'}
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 text-[10px] font-bold uppercase ${exploreRoundStatusClass(round.status)}`}
                        >
                          {exploreRoundStatusLabel(round.status)}
                        </span>
                      </div>

                      {/* Title & Metadata */}
                      <div>
                        <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1] leading-snug">
                          {round.title}
                        </h2>
                        {(() => {
                          const tx = createRoundTxHash(round.id);
                          if (!tx) return null;
                          return (
                            <p className="mt-2 font-mono text-[11px] break-all text-[#e5e2e1]" data-testid="round-tx-hash">
                              TX {tx.hash}
                            </p>
                          );
                        })()}
                        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#888884] mt-2">
                          {round.legacyRecovery && (
                            <span className="text-[#ffb800] break-all">
                              LEGACY CONTRACT {round.contractAddress} · AI REVIEW AND VOTING CLOSED
                            </span>
                          )}
                          <span>CREATOR: {round.creatorAddress.slice(0, 6)}...{round.creatorAddress.slice(-4)}</span>
                          <span>|</span>
                          <span>DEADLINE: {round.deadlineDisplay}</span>
                        </div>
                      </div>

                      {/* Directives Summary */}
                      <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed line-clamp-2">
                        {round.summary}
                      </p>

                      {/* Pool Distribution Bar */}
                      <div className="space-y-2 pt-2 border-t border-[#2a2a2a]">
                        <div className="flex justify-between font-mono text-xs">
                          <span className="text-[#888884] uppercase">TREASURY POOL DISTRIBUTION</span>
                          <span className="text-[#e5e2e1] font-bold">
                            {round.totalPoolGen.toLocaleString()} TEST GEN
                          </span>
                        </div>
                        {/* Segmented bar */}
                        <div className="w-full h-2 bg-[#0e0e0e] flex overflow-hidden">
                          <div style={{ width: `${availPct}%` }} className="bg-[#ff5719]" title={`Available: ${availPct}%`} />
                          <div style={{ width: `${resPct}%` }} className="bg-[#ea6b29]" title={`Reserved: ${resPct}%`} />
                          <div style={{ width: `${appPct}%` }} className="bg-[#ffdbcd]" title={`Approved: ${appPct}%`} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-[#888884] pt-1">
                          <div>
                            AVAILABLE: <span className="text-[#e5e2e1] font-semibold">{round.availableGen.toLocaleString()} ({availPct}%)</span>
                          </div>
                          <div>
                            RESERVED: <span className="text-[#ff5719] font-semibold">{round.reservedGen.toLocaleString()} ({resPct}%)</span>
                          </div>
                          <div>
                            APPROVED: <span className="text-[#ffb596] font-semibold">{round.approvedGen.toLocaleString()} ({appPct}%)</span>
                          </div>
                        </div>
                      </div>

                      {/* Consensus Threshold */}
                      <div className="space-y-1.5 pt-2 border-t border-[#2a2a2a] font-mono text-xs">
                        <div className="flex justify-between text-[#888884]">
                          <span>CONSENSUS THRESHOLD:</span>
                          <span className="text-[#e5e2e1] font-bold">
                            {round.requiredVotes} / {round.totalVoters} YES REQUIRED
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#0e0e0e]">
                          <div
                            style={{ width: `${Math.min(100, (round.currentYesVotes / round.requiredVotes) * 100)}%` }}
                            className="h-full bg-[#ff5719]"
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-[#888884]">
                          <span>
                            CURRENT CONSENSUS: {round.currentYesVotes} of {round.requiredVotes} ({round.consensusThresholdPercent}%)
                          </span>
                          <span className="text-[#ff5719]">QUORUM ADVANCING</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                      <span className="text-[#888884]">
                        PROPOSALS: {round.proposalsCount.inReview} IN REVIEW / {round.proposalsCount.decided} DECIDED
                      </span>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const nominateDecision = canNominate({
                            connected: isConnected,
                            correctChain: isCorrectNetwork,
                            round,
                            account,
                          });
                          const isRecovery = isLockedRecoveryRound(round.id);
                          return (
                            <Link
                              to={`/rounds/${round.id}/nominate`}
                              title={nominateDecision.reason}
                              className={`px-3 py-1.5 font-bold uppercase transition-colors ${
                                isRecovery
                                  ? 'bg-[#201f1f] text-[#888884] border border-[#2a2a2a]'
                                  : 'bg-[#2a2a2a] text-[#e5e2e1] hover:bg-[#353534]'
                              }`}
                            >
                              {isRecovery ? 'NOMINATE BLOCKED' : 'NOMINATE'}
                            </Link>
                          );
                        })()}
                        <Link
                          to={`/rounds/${round.id}`}
                          className="px-3 py-1.5 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black font-bold uppercase transition-colors flex items-center gap-1"
                        >
                          <span>INSPECT ROUND</span>
                          <span>↗</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Consensus Monitor Banner */}
      <section className="w-full bg-[#0e0e0e] border-t border-[#262626] px-4 lg:px-10 py-10">
        <div className="max-w-7xl mx-auto space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-[#262626]">
            <div className="flex items-center gap-2 text-[#ff5719] font-bold">
              <span className="w-2 h-2 bg-[#ff5719]"></span>
              <span>GENLAYER INTELLIGENT CONTRACT CONSENSUS MONITOR</span>
            </div>
            <div className="text-[#888884]">RUNTIME: CHAIN 61997</div>
          </div>
          {isDesignPreview ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#141414] border border-[#222222] p-4 space-y-1">
              <span className="text-[#888884] block text-[10px]">CONSENSUS PARSER STREAM</span>
              <p className="text-[#e5e2e1] text-[11px]">
                ROUND #094: Parser LLM consensus reached (12/12). Approved payout tranche 01 ready.
              </p>
            </div>
            <div className="bg-[#141414] border border-[#222222] p-4 space-y-1">
              <span className="text-[#888884] block text-[10px]">OPTIMISTIC ORACLE RIG</span>
              <p className="text-[#e5e2e1] text-[11px]">
                ROUND #088: WebAssembly memory bounds audit completed. Deterministic proof committed.
              </p>
            </div>
            <div className="bg-[#141414] border border-[#222222] p-4 space-y-1">
              <span className="text-[#888884] block text-[10px]">TREASURY ESCROW STATUS</span>
              <p className="text-[#e5e2e1] text-[11px]">
                ROUND #102: Disbursed 7,800 GEN to approved recipients via pull withdrawal mechanics.
              </p>
            </div>
          </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#141414] border border-[#222222] p-4 space-y-1">
              <span className="text-[#888884] block text-[10px]">DEPLOYMENT</span>
              <p className="text-[#e5e2e1] text-[11px]">CharterFlowCore is configured at {NETWORK_CONFIG.contractAddress.slice(0, 8)}...{NETWORK_CONFIG.contractAddress.slice(-6)} on chain 61997.</p>
            </div>
            <div className="bg-[#141414] border border-[#222222] p-4 space-y-1">
              <span className="text-[#888884] block text-[10px]">RECOVERY ROUNDS</span>
              <p className="text-[#ffb800] text-[11px]">rnd-pilot-354517 and round-studio-next-rpc--mv9pwatt remain on 0x408D… as locked recovery cases.</p>
            </div>
            <div className="bg-[#141414] border border-[#222222] p-4 space-y-1">
              <span className="text-[#888884] block text-[10px]">LIVE REGISTRY</span>
              <p className="text-[#e5e2e1] text-[11px]">The corrected contract starts with zero rounds. New create_round calls target this address only.</p>
            </div>
          </div>
          )}
        </div>
      </section>
    </div>
  );
};
