import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import {
  prepareActionTransaction,
  type PreparedTransaction,
} from '../services/transactionService';
import { TransactionModal } from '../components/TransactionModal';
import type { UserActivity } from '../types';

export const MyActivityPage: React.FC = () => {
  const { adapter, isDesignPreview, refreshData, refreshKey } = useData();
  const { account, chainId, isConnected, connectWallet, provider, isCorrectNetwork } = useWallet();

  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'CLAIMS' | 'NOMINATIONS' | 'ROUNDS' | 'VOTES'>('CLAIMS');

  const [showZeroCreditView, setShowZeroCreditView] = useState(false);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [showTxModal, setShowTxModal] = useState<boolean>(false);
  const [isPreparingTx, setIsPreparingTx] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    adapter
      .getUserActivity(account || undefined)
      .then((res) => {
        if (mounted) {
          setActivity(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err?.message || 'Failed to query user activity');
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [adapter, account, refreshKey]);

  const handleExportJson = () => {
    if (!activity) return;
    const blob = new Blob([JSON.stringify(activity, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `charterflow_activity_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleWithdrawCredit = async (proposalId: string, recipientAddress: string) => {
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (account.toLowerCase() !== recipientAddress.toLowerCase()) {
      setModalNotice(
        `RECIPIENT MISMATCH: Connected wallet (${account.slice(0, 8)}...) is not the designated recipient (${recipientAddress.slice(0, 8)}...). Only the designated recipient can withdraw funds.`
      );
      return;
    }
    if (!provider) {
      setModalNotice('No injected EIP-1193 provider selected.');
      return;
    }
    if (!chainId || chainId !== 61997 || !isCorrectNetwork) {
      setModalNotice('Wallet network unverified. Switch to GenLayer Studio Next (Chain ID 61997) with an explicit click.');
      return;
    }
    setIsPreparingTx(true);
    try {
      const prepared = await prepareActionTransaction({
        action: 'withdraw_credit',
        provider,
        account,
        chainId,
        adapter,
        proposalId,
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setModalNotice(err?.message || 'Failed to prepare credit withdrawal');
    } finally {
      setIsPreparingTx(false);
    }
  };

  // Dynamic statistics derived strictly from activity dataset
  const totalClaimableGen = activity?.claimableCredits.reduce((s, c) => s + c.amountGen, 0) || 0;
  const totalDeployedRounds = activity?.roundsDeployed.length || 0;
  const totalCapacityAllocatedGen = activity?.roundsDeployed.reduce((s, r) => s + r.poolGen, 0) || 0;
  const totalNominations = activity?.nominatedProposals.length || 0;
  const approvedNominations =
    activity?.nominatedProposals.filter((p) => p.status === 'APPROVED' || p.status === 'PAYOUT_EMITTED').length || 0;
  const totalVotesLogged = activity?.votesCast.length || 0;

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* Sub-header telemetry ribbon */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-[#888884]">
          <div className="flex items-center gap-3">
            <span className="text-[#ff5719] font-bold">NODE TELEMETRY:</span>
            <span>
              {account ? (
                `CONNECTED: ${account.slice(0, 6)}...${account.slice(-4)}`
              ) : isDesignPreview ? (
                'PREVIEW MODE (SAMPLE DATA // NO WALLET CONNECTED)'
              ) : (
                'NO WALLET CONNECTED'
              )}
            </span>
            <span>|</span>
            <span>CHAIN ID: 61997</span>
          </div>
          <div className="flex items-center gap-3">
            <span>ESCROW STATE: STRICT VAULT</span>
            <span>|</span>
            <span className={account ? 'text-[#00e599] font-bold' : 'text-[#888884]'}>
              {account ? 'SESSION: ACTIVE' : 'SESSION: DISCONNECTED'}
            </span>
          </div>
        </div>
      </section>

      {/* Disconnected Notice Banner if not in preview */}
      {!account && (
        <section className="w-full bg-[#1c1b1b] border-b border-[#2a2a2a] px-4 lg:px-10 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#ff5719] text-[16px]">info</span>
              <span className="text-[#c8c6c2]">
                {isDesignPreview
                  ? 'DESIGN PREVIEW: Showing sample portfolio records. These sample addresses are not your identity.'
                  : 'No wallet connected. Connect your EIP-1193 wallet to synchronize your personal grant activity on Chain 61997.'}
              </span>
            </div>
            {isDesignPreview && (
              <span className="px-2 py-0.5 bg-[#ff5719]/20 text-[#ff5719] text-[10px] font-bold uppercase">
                SAMPLE PREVIEW DATA
              </span>
            )}
          </div>
        </section>
      )}

      {/* On-Chain Query Error Banner with Retry Action */}
      {error && (
        <section className="w-full bg-[#1c1b1b] border-b border-[#ff3344]/50 px-4 lg:px-10 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#ff3344] text-[18px]">warning</span>
              <div className="space-y-0.5">
                <span className="text-[#ff3344] font-bold">[READ ERROR] FAILED TO QUERY RUNTIME ACTIVITY</span>
                <p className="text-[#c8c6c2] text-[11px]">
                  DIAGNOSTIC: {error}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={refreshData}
              className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors flex items-center gap-1.5"
            >
              <span>RETRY QUERY</span>
              <span>↻</span>
            </button>
          </div>
        </section>
      )}

      {/* Main Header */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono text-xs text-[#888884]">
              <span className="text-[#ff5719] font-bold uppercase">CONCURRENCY CONSOLE</span>
              <span>// RIG-ID: #ACT-61997-TX</span>
            </div>
            <h1 className="font-['Space_Grotesk'] text-2xl sm:text-4xl uppercase font-bold text-[#e5e2e1]">
              My Activity & Treasury Portfolio
            </h1>
            <p className="font-['Hanken_Grotesk'] text-sm sm:text-base text-[#c8c6c2] max-w-3xl">
              Unified dashboard of your created rounds, nominated proposals, cast votes, and claimable recipient credits governed by GenLayer Intelligent Contracts.
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <button
              type="button"
              onClick={handleExportJson}
              className="px-4 py-2.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] flex items-center gap-1.5 uppercase transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">download</span>
              <span>Export TX Log</span>
            </button>
            <button
              type="button"
              onClick={refreshData}
              className="px-4 py-2.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] flex items-center gap-1.5 uppercase transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">sync</span>
              <span>Sync Runtime</span>
            </button>
          </div>
        </div>
      </section>

      {/* 4 Metric Cards */}
      <section className="w-full px-4 lg:px-10 py-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
          {/* Metric 1 */}
          <div className="bg-[#1c1b1b] border border-[#ff5719]/50 p-5 flex flex-col justify-between space-y-3 relative overflow-hidden">
            <div className="flex justify-between items-center text-[#888884]">
              <span className="text-[#ff5719] font-bold">[CREDIT-POOL]</span>
              <span className="px-1.5 py-0.5 bg-[#00e599]/20 text-[#00e599] text-[10px] font-bold">
                {totalClaimableGen > 0 ? 'CLAIMABLE' : 'ZERO'}
              </span>
            </div>
            <div>
              <div className="font-['Space_Grotesk'] text-3xl font-bold text-[#ff5719]">
                {totalClaimableGen.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#888884] uppercase mt-1">TEST GEN CLAIMABLE</div>
            </div>
            <div className="flex justify-between text-[10px] text-[#888884] pt-2 border-t border-[#2a2a2a]">
              <span>RECIPIENT GRANTS</span>
              <span className="text-[#e5e2e1] font-bold">{activity?.claimableCredits.length || 0} CREDITED</span>
            </div>
            <div className="absolute bottom-0 left-0 w-full h-1 bg-[#ff5719]"></div>
          </div>

          {/* Metric 2 */}
          <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-3">
            <div className="flex justify-between items-center text-[#888884]">
              <span>[ROUNDS-DEPLOYED]</span>
              <span>SYS-02</span>
            </div>
            <div>
              <div className="font-['Space_Grotesk'] text-3xl font-bold text-[#e5e2e1]">
                {String(totalDeployedRounds).padStart(2, '0')}{' '}
                <span className="text-sm text-[#888884] font-normal">TOTAL</span>
              </div>
              <div className="text-[10px] text-[#888884] uppercase mt-1">
                {activity?.roundsDeployed.filter((r) => r.status === 'ACTIVE_VOTING').length || 0} Active /{' '}
                {activity?.roundsDeployed.filter((r) => r.status === 'FINALIZED').length || 0} Settled
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-[#888884] pt-2 border-t border-[#2a2a2a]">
              <span>CAPACITY ALLOCATED</span>
              <span className="text-[#e5e2e1] font-bold">{totalCapacityAllocatedGen.toLocaleString()} GEN</span>
            </div>
          </div>

          {/* Metric 3 */}
          <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-3">
            <div className="flex justify-between items-center text-[#888884]">
              <span>[NOMINATIONS]</span>
              <span className="text-[#ff5719] font-bold">PIPELINE</span>
            </div>
            <div>
              <div className="font-['Space_Grotesk'] text-3xl font-bold text-[#e5e2e1]">
                {String(totalNominations).padStart(2, '0')}{' '}
                <span className="text-sm text-[#888884] font-normal">REGISTERED</span>
              </div>
              <div className="text-[10px] text-[#888884] uppercase mt-1">
                {approvedNominations} Approved · {totalNominations - approvedNominations} Other
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-[#888884] pt-2 border-t border-[#2a2a2a]">
              <span>APPROVAL RATE</span>
              <span className="text-[#ff5719] font-bold">
                {totalNominations > 0 ? `${Math.round((approvedNominations / totalNominations) * 100)}%` : '0%'}
              </span>
            </div>
          </div>

          {/* Metric 4 */}
          <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-3">
            <div className="flex justify-between items-center text-[#888884]">
              <span>[VOTING-LEDGER]</span>
              <span>1 MEMBER 1 VOTE</span>
            </div>
            <div>
              <div className="font-['Space_Grotesk'] text-3xl font-bold text-[#e5e2e1]">
                {totalVotesLogged}{' '}
                <span className="text-sm text-[#888884] font-normal">BALLOTS</span>
              </div>
              <div className="text-[10px] text-[#888884] uppercase mt-1">
                {totalVotesLogged > 0 ? `${totalVotesLogged} Ballots Logged` : 'No votes recorded'}
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-[#888884] pt-2 border-t border-[#2a2a2a]">
              <span>LEDGER SYNC</span>
              <span className="text-[#00e599] font-bold">CHAIN 61997</span>
            </div>
          </div>
        </div>
      </section>

      {/* Tabbed Industrial Control Console */}
      <section className="w-full px-4 lg:px-10 py-8 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Tab Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-[#1c1b1b] border border-[#2a2a2a] p-2 font-mono text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('CLAIMS')}
                className={`px-4 py-2 font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'CLAIMS'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">payments</span>
                <span>Claimable Credits ({activity?.claimableCredits.length || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('NOMINATIONS')}
                className={`px-4 py-2 font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'NOMINATIONS'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">description</span>
                <span>My Nominated Proposals ({activity?.nominatedProposals.length || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('ROUNDS')}
                className={`px-4 py-2 font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'ROUNDS'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">account_balance</span>
                <span>Rounds Created ({activity?.roundsDeployed.length || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('VOTES')}
                className={`px-4 py-2 font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  activeTab === 'VOTES'
                    ? 'bg-[#ff5719] text-[#521300]'
                    : 'bg-[#201f1f] text-[#c8c6c2] hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">how_to_vote</span>
                <span>Voting Ledger ({totalVotesLogged})</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowZeroCreditView(!showZeroCreditView)}
                className="px-3 py-1 bg-[#201f1f] text-[#888884] hover:text-[#e5e2e1] text-[10px] uppercase border border-[#2a2a2a]"
              >
                {showZeroCreditView ? 'SHOW CLAIM VIEW' : 'TEST ZERO-CREDIT STATE'}
              </button>
            </div>
          </div>

          {loading && (
            <div className="p-8 text-center font-mono text-xs text-[#888884] bg-[#1c1b1b] border border-[#2a2a2a] mb-6">
              SYNCHRONIZING PERSONAL ON-CHAIN ACTIVITY RECORD ON RUNTIME #61997...
            </div>
          )}

          {/* TAB 1: CLAIMABLE CREDITS */}
          {activeTab === 'CLAIMS' && (
            <div>
              {showZeroCreditView || (!activity?.claimableCredits.length && !isDesignPreview) ? (
                /* Zero Credit State */
                <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-12 text-center space-y-4">
                  <div className="inline-block p-4 bg-[#201f1f] border border-[#2a2a2a]">
                    <span className="material-symbols-outlined text-4xl text-[#888884]">
                      savings
                    </span>
                  </div>
                  <h3 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">
                    No Claimable Credits Available
                  </h3>
                  <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] max-w-md mx-auto">
                    Your connected wallet has 0 active grants pending withdrawal. To earn recipient rewards, submit a technical proposal to an active round.
                  </p>
                  <div className="pt-2">
                    <Link
                      to="/rounds"
                      className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black inline-flex items-center gap-2"
                    >
                      <span>BROWSE OPEN ROUNDS</span>
                      <span>↗</span>
                    </Link>
                  </div>
                </div>
              ) : (
                /* Claimable Item Card */
                <div className="space-y-4">
                  {activity?.claimableCredits.map((item) => {
                    const isCallerBeneficiary =
                      !!account && account.toLowerCase() === item.recipientAddress.toLowerCase();

                    return (
                      <div key={item.id} className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 lg:p-8 space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                          <div className="lg:col-span-7 space-y-4 font-mono text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 bg-[#00e599]/20 text-[#00e599] font-bold uppercase text-[10px]">
                                APPROVED GRANT
                              </span>
                              <span className="text-[#888884]">ROUND #{item.roundId.toUpperCase()}</span>
                              <span className="text-[#383838]">/</span>
                              <span className="text-[#ff5719]">PROPOSAL ID: #{item.proposalId.toUpperCase()}</span>
                              {isDesignPreview && (
                                <span className="px-1.5 py-0.5 bg-[#ff5719]/20 text-[#ff5719] text-[9px] font-bold uppercase">
                                  PREVIEW RECORD
                                </span>
                              )}
                            </div>

                            <h2 className="font-['Space_Grotesk'] text-2xl uppercase font-bold text-[#e5e2e1]">
                              {item.proposalTitle}
                            </h2>
                            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                              Proposal evaluated against frozen charter rules and passed quorum vote. Recipient credit is authorized for native pull withdrawal.
                            </p>

                            <div className="space-y-1.5 pt-2 text-[#888884] text-[11px] border-t border-[#2a2a2a]">
                              <div className="flex justify-between">
                                <span>DESIGNATED RECIPIENT:</span>
                                <span className="text-[#e5e2e1]">
                                  {item.recipientAddress.slice(0, 10)}...{item.recipientAddress.slice(-4)}{' '}
                                  {isCallerBeneficiary ? '(YOUR CONNECTED WALLET)' : '(PREVIEW BENEFICIARY)'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>STATUS:</span>
                                <span className="text-[#00e599] font-bold">CREDITED_PENDING_WITHDRAWAL</span>
                              </div>
                            </div>

                            <div className="p-3 bg-[#0e0e0e] border border-[#00e599]/30 text-[11px] text-[#c8c6c2]">
                              <span className="text-[#00e599] font-bold">PULL PAYMENT ARCHITECTURE:</span>{' '}
                              CharterFlow employs pull payments to prevent reentrancy and denial-of-service vectors. Recipients execute the withdrawal directly.
                            </div>
                          </div>

                          {/* Right Withdrawal Box */}
                          <div className="lg:col-span-5 bg-[#0e0e0e] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-6 font-mono text-xs">
                            <div>
                              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                                <span className="text-[#888884] text-[10px] uppercase">CLAIMABLE GRANT AMOUNT</span>
                                <span className="text-[#00e599] text-[10px] font-bold">APPROVED</span>
                              </div>
                              <div className="pt-4 text-center">
                                <div className="font-['Space_Grotesk'] text-4xl sm:text-5xl font-bold text-[#ff5719]">
                                  {item.amountGen.toLocaleString()}
                                </div>
                                <span className="text-[11px] text-[#888884] uppercase block mt-1">
                                  test GEN (Native Network Coin)
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleWithdrawCredit(item.proposalId, item.recipientAddress)}
                              disabled={isPreparingTx}
                              className="w-full py-4 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black font-['Space_Grotesk'] text-base uppercase font-bold tracking-wider transition-colors flex items-center justify-center gap-2"
                            >
                              <span>{isPreparingTx ? 'PREPARING TX...' : 'WITHDRAW TEST GEN'}</span>
                              <span>↗</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MY NOMINATED PROPOSALS */}
          {activeTab === 'NOMINATIONS' && (
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a] text-[#888884]">
                <span>NOMINATED PROPOSALS RECORD</span>
                <span>TOTAL: {activity?.nominatedProposals.length || 0}</span>
              </div>
              {activity?.nominatedProposals.length === 0 ? (
                <div className="py-8 text-center text-[#888884]">No nominated proposals found.</div>
              ) : (
                <div className="divide-y divide-[#222222]">
                  {activity?.nominatedProposals.map((item) => (
                    <div key={item.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-[#ff5719] font-bold">#{item.id.toUpperCase()}</span>
                          <span className="text-[#888884]">ROUND #{item.roundId.toUpperCase()}</span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                              item.status === 'APPROVED' || item.status === 'PAYOUT_EMITTED'
                                ? 'bg-[#00e599]/20 text-[#00e599]'
                                : item.status === 'ELIGIBLE'
                                ? 'bg-[#ff5719]/20 text-[#ff5719]'
                                : 'bg-[#ff3344]/20 text-[#ff3344]'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <Link
                          to={`/proposals/${item.id}`}
                          className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1] hover:text-[#ff5719] transition-colors mt-1 block"
                        >
                          {item.title}
                        </Link>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-[#e5e2e1] font-bold block">
                            {item.requestedGen.toLocaleString()} test GEN
                          </span>
                          <span className="text-[10px] text-[#888884]">{item.submittedAt}</span>
                        </div>
                        <Link
                          to={`/proposals/${item.id}`}
                          className="px-3 py-1.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] uppercase"
                        >
                          VIEW ↗
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ROUNDS CREATED */}
          {activeTab === 'ROUNDS' && (
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a] text-[#888884]">
                <span>ROUNDS CREATED</span>
                <span>TOTAL: {activity?.roundsDeployed.length || 0}</span>
              </div>
              {activity?.roundsDeployed.length === 0 ? (
                <div className="py-8 text-center text-[#888884]">No rounds deployed under this account.</div>
              ) : (
                <div className="divide-y divide-[#222222]">
                  {activity?.roundsDeployed.map((roundItem) => (
                    <div key={roundItem.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-[#ff5719] font-bold">#{roundItem.id.toUpperCase()}</span>
                          <span className="px-2 py-0.5 bg-[#ff5719]/20 text-[#ff5719] text-[10px] font-bold">
                            {roundItem.status}
                          </span>
                        </div>
                        <Link
                          to={`/rounds/${roundItem.id}`}
                          className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1] hover:text-[#ff5719] transition-colors mt-1 block"
                        >
                          {roundItem.title}
                        </Link>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-[#e5e2e1] font-bold block">
                            {roundItem.poolGen.toLocaleString()} test GEN
                          </span>
                          <span className="text-[10px] text-[#888884]">DEPLOYED: {roundItem.deployedAt}</span>
                        </div>
                        <Link
                          to={`/rounds/${roundItem.id}`}
                          className="px-3 py-1.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] uppercase"
                        >
                          MANAGE ↗
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: VOTING LEDGER */}
          {activeTab === 'VOTES' && (
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a] text-[#888884]">
                <span>BALLOT HISTORY LOGGED ON GENLAYER STUDIO NEXT</span>
                <span>{totalVotesLogged} RECORDED TRANSACTIONS</span>
              </div>
              {activity?.votesCast.length === 0 ? (
                <div className="py-8 text-center text-[#888884]">No votes cast under this account.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left divide-y divide-[#262626]">
                    <thead className="bg-[#0e0e0e] text-[#888884] uppercase text-[10px]">
                      <tr>
                        <th className="p-3">BLOCK</th>
                        <th className="p-3">PROPOSAL</th>
                        <th className="p-3">ROUND</th>
                        <th className="p-3">STANCE</th>
                        <th className="p-3">TIMESTAMP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222222] bg-[#141414]">
                      {activity?.votesCast.map((vote) => (
                        <tr key={vote.id}>
                          <td className="p-3 text-[#ff5719] font-bold">
                            {vote.block && vote.block > 0 ? `#${vote.block}` : <span className="text-[#888884] font-normal">UNRECORDED</span>}
                          </td>
                          <td className="p-3 text-[#e5e2e1]">{vote.proposalTitle}</td>
                          <td className="p-3 text-[#888884]">ROUND #{vote.roundId.toUpperCase()}</td>
                          <td className="p-3">
                            {vote.stance === 'YES' || vote.stance === 'NO' ? (
                              <span className={vote.stance === 'YES' ? 'text-[#00e599] font-bold' : 'text-[#ff3344] font-bold'}>
                                {vote.stance}
                              </span>
                            ) : (
                              <span className="text-[#ffb800] font-mono text-[11px]">
                                PARTICIPATION RECORDED (CHOICE UNRECORDED)
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-[#888884]">{vote.timestamp || 'UNRECORDED'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Modal Dialog */}
      {modalNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
              <span className="text-[#ff5719] font-bold uppercase">TREASURY PULL GUARD</span>
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
        provider={provider}
        account={account || ''}
        adapter={adapter}
        onSuccess={() => {
          refreshData();
        }}
      />
    </div>
  );
};
