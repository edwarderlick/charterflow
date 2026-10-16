import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useData } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import { prepareActionTransaction, recordedActionBlocksResubmit } from '../services/transactionService';
import { TransactionModal } from '../components/TransactionModal';
import { useTxModalResume } from '../services/txModalSnapshot';
import type { Proposal, Round } from '../types';
import { CopyButton } from '../components/CopyButton';
import { Barcode } from '../components/Barcode';
import {
  canEvaluateCharterFit,
  canSettleExpiredProposal,
  canVote,
  canWithdrawCredit,
} from '../services/permissions';

export const ProposalDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { adapter, isDesignPreview, refreshData, refreshKey } = useData();
  const { account, chainId, isConnected, connectWallet, provider, isCorrectNetwork } = useWallet();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalFeedback, setModalFeedback] = useState<string | null>(null);
  const [showVoteModal, setShowVoteModal] = useState<'YES' | 'NO' | null>(null);
  const { preparedTx, setPreparedTx, showTxModal, setShowTxModal, closeTxModal, initialSnapshot } = useTxModalResume();
  const [isPreparingTx, setIsPreparingTx] = useState<boolean>(false);
  const [txError, setTxError] = useState<string | null>(null);
  const hasProposal = useRef(false);

  useEffect(() => {
    hasProposal.current = false;
    setProposal(null);
    setRound(null);
    setLoading(true);
    setError(null);
  }, [id]);

  useEffect(() => {
    let mounted = true;
    const proposalId = id || '';
    if (!hasProposal.current) setLoading(true);
    setError(null);
    adapter
      .getProposalById(proposalId)
      .then(async (p) => {
        if (!mounted) return;
        if (p) {
          hasProposal.current = true;
          setProposal(p);
          try {
            const r = await adapter.getRoundById(p.roundId);
            if (mounted) setRound(r || null);
          } catch {
            // Secondary round detail error
          }
        } else {
          setProposal(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (mounted) {
          setError(err?.message || 'Failed to query proposal from contract');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [id, adapter, refreshKey]);

  if (loading && !proposal) {
    return (
      <div className="flex-1 flex items-center justify-center p-20 font-mono text-xs text-[#888884] bg-[#131313]">
        RETRIEVING PROPOSAL SPECIFICATION ON CHAIN 61997...
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 space-y-4 bg-[#131313] text-center font-mono">
        <div className="p-4 bg-[#201f1f] border border-[#ff3344]/30">
          <span className="material-symbols-outlined text-4xl text-[#ff3344]">warning</span>
        </div>
        <div className="text-sm text-[#ff3344] uppercase font-bold">
          [READ ERROR] FAILED TO QUERY PROPOSAL FROM ON-CHAIN RUNTIME
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
            RETURN TO ROUNDS ↗
          </Link>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 space-y-4 bg-[#131313] text-center">
        <div className="font-mono text-sm text-[#ff3344] uppercase font-bold">
          [ERROR 404] PROPOSAL IDENTIFIER NOT FOUND
        </div>
        <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
          No proposal matched the requested identifier &ldquo;{id}&rdquo;.
        </p>
        <Link
          to="/rounds"
          className="px-5 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black"
        >
          RETURN TO ROUNDS ↗
        </Link>
      </div>
    );
  }

  const isMember = Boolean(
    account &&
      round?.committeeMembers.some(
        (m) => m.address.toLowerCase() === account.toLowerCase()
      )
  );
  const isRecipient = Boolean(
    account &&
      proposal.recipientAddress.toLowerCase() === account.toLowerCase()
  );
  const isVotingWindowOpen = proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING';
  const hasAlreadyVoted = Boolean(
    account && proposal.eventLog?.some((e) => e.voterNode?.toLowerCase() === account.toLowerCase())
  );

  const isRecipientOnCommittee = Boolean(
    round?.committeeMembers.some(
      (m) => m.address.toLowerCase() === proposal.recipientAddress.toLowerCase()
    )
  );

  const rawCommitteeSize = round
    ? round.committeeMembers.length || round.totalVoters || 0
    : isDesignPreview
    ? 12
    : 0;
  const eligibleVotersCount =
    rawCommitteeSize > 0
      ? isRecipientOnCommittee
        ? Math.max(1, rawCommitteeSize - 1)
        : rawCommitteeSize
      : 0;

  const totalVoters = eligibleVotersCount;
  const currentYes = proposal.votes.yesCount;
  const currentNo = proposal.votes.noCount;
  const requiredYes = eligibleVotersCount > 0 ? Math.floor((eligibleVotersCount * 2 + 2) / 3) : null;
  const pendingVoters = totalVoters > 0 ? Math.max(0, totalVoters - currentYes - currentNo) : 0;
  const participationPercent =
    totalVoters > 0 ? Math.round(((currentYes + currentNo) / totalVoters) * 100) : 0;

  // Check if proposal meets settlement eligibility
  const nowTs = Math.floor(Date.now() / 1000);
  const submissionTs = Math.floor(new Date(proposal.createdAt).getTime() / 1000);
  const isSubmissionExpired = proposal.status === 'SUBMITTED' && nowTs >= submissionTs + 86400;
  const isVotingExpired =
    (proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING') &&
    proposal.votes.deadlineRemaining === '0H REMAINING';
  const isExpirable = isSubmissionExpired || isVotingExpired;
  const voteDecision = canVote({
    connected: isConnected,
    correctChain: isCorrectNetwork,
    account,
    round,
    proposal,
    hasAlreadyVoted,
  });
  const blockingEvaluate = recordedActionBlocksResubmit('evaluate_charter_fit', proposal.id);
  const blockingVote = recordedActionBlocksResubmit('cast_vote', proposal.id);
  const blockingWithdraw = recordedActionBlocksResubmit('withdraw_credit', proposal.id);
  const evaluateDecision = canEvaluateCharterFit({
    proposal,
    connected: isConnected,
    correctChain: isCorrectNetwork,
  });
  const legacyWriteBlocked =
    evaluateDecision.reason.startsWith('WRITE BLOCKED') || voteDecision.reason.startsWith('WRITE BLOCKED');
  const withdrawDecision = canWithdrawCredit({
    connected: isConnected,
    correctChain: isCorrectNetwork,
    account,
    proposal,
  });
  const settleDecision = canSettleExpiredProposal({ proposal, isExpirable });

  const handleInitiateVote = async (voteType: 'YES' | 'NO') => {
    if (isDesignPreview) {
      setShowVoteModal(voteType);
      return;
    }
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (!provider) {
      setTxError('No injected EIP-1193 provider selected.');
      return;
    }
    if (!chainId || chainId !== 61997 || !isCorrectNetwork) {
      setTxError('Wallet network unverified. Switch to GenLayer Studio Next (Chain ID 61997) with an explicit click.');
      return;
    }
    if (!voteDecision.allowed) {
      setTxError(voteDecision.reason);
      return;
    }
    if (!proposal) {
      setTxError('Proposal data not loaded.');
      return;
    }
    const blockingVote = recordedActionBlocksResubmit('cast_vote', proposal.id);
    if (blockingVote) {
      setTxError(
        `Vote already recorded${blockingVote.txId ? `: ${blockingVote.txId}` : ''}. Read-only reconciliation is required. It cannot be submitted again.`
      );
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    try {
      const prepared = await prepareActionTransaction({
        action: 'cast_vote',
        provider,
        account,
        chainId,
        adapter,
        proposalId: proposal.id,
        castVoteArgs: {
          proposal_id: proposal.id,
          vote_type: voteType,
          recipientAddress: proposal.recipientAddress,
        },
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare voting transaction');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleInitiateEvaluate = async () => {
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (!provider) {
      setTxError('No injected EIP-1193 provider selected.');
      return;
    }
    if (!chainId || chainId !== 61997 || !isCorrectNetwork) {
      setTxError('Wallet network unverified. Switch to GenLayer Studio Next (Chain ID 61997) with an explicit click.');
      return;
    }
    if (!evaluateDecision.allowed) {
      setTxError(evaluateDecision.reason);
      return;
    }
    if (!proposal) {
      setTxError('Proposal data not loaded.');
      return;
    }
    const blockingEvaluate = recordedActionBlocksResubmit('evaluate_charter_fit', proposal.id);
    if (blockingEvaluate) {
      setTxError(
        `Evaluation already recorded${blockingEvaluate.txId ? `: ${blockingEvaluate.txId}` : ''}. Read-only reconciliation is required. It cannot be submitted again.`
      );
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    try {
      const prepared = await prepareActionTransaction({
        action: 'evaluate_charter_fit',
        provider,
        account,
        chainId,
        adapter,
        proposalId: proposal.id,
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare evaluation transaction');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleInitiateWithdraw = async () => {
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (!provider) {
      setTxError('No injected EIP-1193 provider selected.');
      return;
    }
    if (!chainId || chainId !== 61997 || !isCorrectNetwork) {
      setTxError('Wallet network unverified. Switch to GenLayer Studio Next (Chain ID 61997) with an explicit click.');
      return;
    }
    if (!withdrawDecision.allowed) {
      setTxError(withdrawDecision.reason);
      return;
    }
    if (!proposal) {
      setTxError('Proposal data not loaded.');
      return;
    }
    const blockingWithdraw = recordedActionBlocksResubmit('withdraw_credit', proposal.id);
    if (blockingWithdraw) {
      setTxError(
        `Withdrawal already recorded${blockingWithdraw.txId ? `: ${blockingWithdraw.txId}` : ''}. Read-only reconciliation is required. It cannot be submitted again.`
      );
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    try {
      const prepared = await prepareActionTransaction({
        action: 'withdraw_credit',
        provider,
        account,
        chainId,
        adapter,
        proposalId: proposal.id,
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare withdrawal transaction');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleInitiateSettleExpired = async () => {
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (!provider) {
      setTxError('No injected EIP-1193 provider selected.');
      return;
    }
    if (!chainId || chainId !== 61997 || !isCorrectNetwork) {
      setTxError('Wallet network unverified. Switch to GenLayer Studio Next (Chain ID 61997) with an explicit click.');
      return;
    }
    if (!settleDecision.allowed) {
      setTxError(settleDecision.reason);
      return;
    }
    if (!proposal) {
      setTxError('Proposal data not loaded.');
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    try {
      const prepared = await prepareActionTransaction({
        action: 'settle_expired_proposal',
        provider,
        account,
        chainId,
        adapter,
        roundId: proposal.roundId,
        proposalId: proposal.id,
        settleExpiredArgs: {
          round_id: proposal.roundId,
          proposal_id: proposal.id,
        },
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare settlement transaction');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleModalDemoSubmit = () => {
    setShowVoteModal(null);
    setModalFeedback(
      'PREVIEW MODAL DEMONSTRATION ONLY: This fixture is not on-chain state. No ballot was broadcast or recorded, and vote tallies remain unaltered.'
    );
    setTimeout(() => setModalFeedback(null), 6000);
  };

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* Design Preview Warning Banner */}
      {isDesignPreview && (
        <section className="w-full bg-[#ff5719]/10 border-b border-[#ff5719]/40 px-4 lg:px-10 py-2 font-mono text-xs text-[#ff5719] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold">[DESIGN PREVIEW // PREVIEW RECORD]</span>
            <span className="text-[#c8c6c2]">Displaying sample fixture data for UI validation. A live contract is configured, but this preview record is non-authoritative.</span>
          </div>
          <span className="text-[10px] text-[#888884] uppercase">NON-AUTHORITATIVE</span>
        </section>
      )}

      {/* Sub-header Navigation Ribbon */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-[#888884]">
          <div className="flex items-center gap-2">
            <Link to="/rounds" className="hover:text-[#ff5719]">
              ROUNDS
            </Link>
            <span className="text-[#383838]">/</span>
            <Link to={`/rounds/${proposal.roundId}`} className="hover:text-[#ff5719]">
              {proposal.roundId.toUpperCase()}
            </Link>
            <span className="text-[#383838]">/</span>
            <span className="text-[#ff5719] font-bold">
              PROPOSAL #{proposal.id.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                proposal.status === 'ELIGIBLE' ? 'bg-[#ffb800]' : 'bg-[#ffb800]'
              }`}
            ></span>
            <span className="font-bold uppercase text-[#ffb800]" data-testid="proposal-state">
              STATE: {proposal.status} // {proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? 'VOTING IN PROGRESS' : proposal.status === 'APPROVED' ? 'CONSENSUS RATIFIED' : proposal.status === 'SUBMITTED' ? 'EVALUATION PENDING' : proposal.status === 'PAYOUT_EMITTED' ? 'PAYOUT EMITTED (CREDIT WITHDRAWN)' : proposal.status === 'NEEDS_CLARITY' ? 'NEEDS CLARITY (EVALUATION INCONCLUSIVE)' : proposal.status === 'EXPIRED' ? 'SUBMISSION EXPIRED' : 'VOTING CLOSED'}
            </span>
          </div>
        </div>
      </section>

      {/* Proposal Main Title Header */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            <div className="space-y-3 max-w-4xl">
              <div className="flex items-center gap-3 font-mono text-xs text-[#888884]">
                <span className="text-[#ff5719] font-bold">[{proposal.id.toUpperCase()}]</span>
                <span>TYPE: INFRASTRUCTURE</span>
                <span>|</span>
                <span>DATA STATUS: {isDesignPreview ? 'PREVIEW RECORD' : 'ON-CHAIN STATE'}</span>
              </div>
              <h1 className="font-['Space_Grotesk'] text-2xl sm:text-4xl uppercase font-bold text-[#e5e2e1] leading-tight">
                {proposal.title}
              </h1>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-2 font-mono text-xs text-[#888884]">
              <Barcode width={140} height={20} color="#c8c6c2" />
              <span>SPEC_ID: {proposal.id.toUpperCase()}</span>
            </div>
          </div>

          {modalFeedback && (
            <div className="p-3 bg-[#201f1f] border border-[#ff5719] text-[#ff5719] font-mono text-xs">
              {modalFeedback}
            </div>
          )}

          {/* Immutable Proposal Fact Sheet (5 Columns) */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-[#262626] border border-[#262626] font-mono text-xs">
            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <span className="text-[#888884] text-[10px] uppercase">REQUESTED ALLOCATION</span>
              <div className="font-['Space_Grotesk'] text-xl font-bold text-[#ff5719]">
                {proposal.requestedGen.toLocaleString()}
              </div>
              <span className="text-[10px] text-[#888884] uppercase font-bold">
                TEST GEN [PROPOSED]
              </span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <span className="text-[#888884] text-[10px] uppercase">TARGET RECIPIENT</span>
              <div className="flex items-center gap-2 text-sm font-bold text-[#e5e2e1]">
                <span>
                  {proposal.recipientAddress.slice(0, 6)}...{proposal.recipientAddress.slice(-4)}
                </span>
                <CopyButton text={proposal.recipientAddress} iconOnly />
              </div>
              <span className="text-[10px] text-[#888884]">
                {isRecipient ? 'DESIGNATED (YOU)' : 'DESIGNATED BENEFICIARY'}
              </span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <span className="text-[#888884] text-[10px] uppercase">NOMINATING NODE</span>
              <div className="text-sm font-bold text-[#e5e2e1]">
                {proposal.nominatorAddress.slice(0, 6)}...{proposal.nominatorAddress.slice(-4)}
              </div>
              <span className="text-[10px] text-[#888884] uppercase">
                {account && account.toLowerCase() === proposal.nominatorAddress.toLowerCase()
                  ? 'CONNECTED WALLET'
                  : 'ROUND MEMBER'}
              </span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <span className="text-[#888884] text-[10px] uppercase">ROUND CHARTER</span>
              <div className="text-sm font-bold text-[#e5e2e1]">
                {round ? round.title.slice(0, 16) + '...' : proposal.roundId.toUpperCase()}
              </div>
              <span className="text-[10px] text-[#888884] uppercase">
                ROUND #{proposal.roundId.toUpperCase()}
              </span>
            </div>

            <div className="bg-[#1c1b1b] p-4 flex flex-col justify-between space-y-1">
              <span className="text-[#888884] text-[10px] uppercase">CONSENSUS CHAIN</span>
              <div className="font-['Space_Grotesk'] text-xl font-bold text-[#e5e2e1]">
                61997
              </div>
              <span className="text-[10px] text-[#888884] uppercase">GENLAYER STUDIO NEXT</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5-Stage Consensus Pipeline Tracker */}
      <section className="w-full px-4 lg:px-10 py-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto bg-[#1c1b1b] border border-[#2a2a2a] p-5 space-y-4">
          <div className="flex justify-between items-center font-mono text-xs pb-2 border-b border-[#2a2a2a]">
            <div className="flex items-center gap-2 text-[#e5e2e1] font-bold uppercase">
              <span className="material-symbols-outlined text-[#ff5719] text-[16px]">alt_route</span>
              <span>PROPOSAL GOVERNANCE LIFECYCLE</span>
            </div>
            <span className="text-[#ff5719] font-bold">CURRENT STAGE: {proposal.status}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
            <div className={`p-3 bg-[#0e0e0e] border space-y-1 ${proposal.status !== 'SUBMITTED' ? 'border-[#00e599]/40' : 'border-[#ff5719]'}`}>
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>STAGE 01</span>
                <span className={proposal.status !== 'SUBMITTED' ? 'text-[#00e599]' : 'text-[#ff5719]'}>
                  {proposal.status !== 'SUBMITTED' ? 'COMPLETED' : 'ACTIVE'}
                </span>
              </div>
              <div className="text-[#e5e2e1] font-bold uppercase">SUBMITTED</div>
              <p className="text-[#888884] text-[10px]">
                {proposal.requestedGen.toLocaleString()} test GEN specified under proposal scope.
              </p>
            </div>

            <div className={`p-3 bg-[#0e0e0e] border space-y-1 ${proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' || proposal.status === 'APPROVED' ? 'border-[#00e599]/40' : 'border-[#2a2a2a]'}`}>
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>STAGE 02</span>
                <span className={proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' || proposal.status === 'APPROVED' ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' || proposal.status === 'APPROVED' ? 'EVALUATED' : 'PENDING'}
                </span>
              </div>
              <div className="text-[#e5e2e1] font-bold uppercase">CHARTER REVIEW</div>
              <p className="text-[#888884] text-[10px]">
                AI validator consensus checks rules and exclusions compliance.
              </p>
            </div>

            <div className={`p-3 bg-[#0e0e0e] border space-y-1 ${proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? 'border-[#ff5719]' : proposal.status === 'APPROVED' ? 'border-[#00e599]/40' : 'border-[#2a2a2a]'}`}>
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span className={proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? 'text-[#ff5719] font-bold' : ''}>STAGE 03</span>
                <span className={proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? 'text-[#ff5719] font-bold' : proposal.status === 'APPROVED' ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? 'ACTIVE' : proposal.status === 'APPROVED' ? 'RESOLVED' : 'AWAITING'}
                </span>
              </div>
              <div className={proposal.status === 'ELIGIBLE' || proposal.status === 'VOTING' ? 'text-[#ff5719] font-bold uppercase' : 'text-[#e5e2e1] font-bold uppercase'}>
                MEMBER VOTING
              </div>
              <p className="text-[#888884] text-[10px]">
                {currentYes} of {requiredYes} required affirmative votes logged.
              </p>
            </div>

            <div className={`p-3 bg-[#0e0e0e] border space-y-1 ${proposal.status === 'APPROVED' ? 'border-[#00e599]/40' : 'border-[#2a2a2a] opacity-70'}`}>
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>STAGE 04</span>
                <span className={proposal.status === 'APPROVED' ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {proposal.status === 'APPROVED' ? 'AUTHORIZED' : 'PENDING'}
                </span>
              </div>
              <div className="text-[#888884] font-bold uppercase">GRANT RATIFICATION</div>
              <p className="text-[#888884] text-[10px]">
                Affirmative quorum ratifies proposal into approved credit allocation.
              </p>
            </div>

            <div className={`p-3 bg-[#0e0e0e] border space-y-1 ${proposal.status === 'PAYOUT_EMITTED' ? 'border-[#00e599]' : 'border-[#2a2a2a] opacity-50'}`}>
              <div className="flex justify-between text-[#888884] text-[10px]">
                <span>STAGE 05</span>
                <span>{proposal.status === 'PAYOUT_EMITTED' ? 'PAYOUT EMITTED' : 'LOCKED'}</span>
              </div>
              <div className="text-[#888884] font-bold uppercase">WITHDRAWAL</div>
              <p className="text-[#888884] text-[10px]">
                Beneficiary claim execution upon proposal approval and credit authorization.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main Workspace Split (7 cols left / 5 cols right) */}
      <section className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Specification & Scope */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a] font-mono text-xs">
                <span className="text-[#ff5719] font-bold uppercase">
                  PROPOSAL SPECIFICATION & TECHNICAL SCOPE
                </span>
                <span className="text-[#888884]">SPEC_ID: #{proposal.id.toUpperCase()}</span>
              </div>
              <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] leading-relaxed whitespace-pre-line">
                {proposal.workDescription}
              </p>

              {/* Deliverable Items */}
              <div className="space-y-3 pt-3 border-t border-[#2a2a2a]">
                <span className="font-mono text-xs uppercase font-bold text-[#e5e2e1] block">
                  PROPOSED DELIVERABLE SPECIFICATIONS:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                  {proposal.deliverables.map((del) => (
                    <div key={del.id} className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1">
                      <span className="text-[#ff5719] text-[10px] font-bold block uppercase">
                        {del.title}
                      </span>
                      <p className="text-[#c8c6c2] text-[11px] leading-snug">
                        {del.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* GenLayer Validator Intelligence Consensus */}
            {proposal.aiEvaluation && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
                <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2 text-[#e5e2e1] font-bold uppercase">
                    <span className="material-symbols-outlined text-[#ff5719] text-[16px]">psychology</span>
                    <span>GENLAYER VALIDATOR INTELLIGENCE EVALUATION</span>
                  </div>
                  <span className="px-2 py-0.5 bg-[#00e599]/20 text-[#00e599] font-bold uppercase" data-testid="proposal-verdict">
                    EVALUATION: {proposal.aiEvaluation.status} {proposal.aiEvaluation.score != null ? `(${proposal.aiEvaluation.score}%)` : '(SCORE UNAVAILABLE - ON-CHAIN VERDICT ONLY)'}
                  </span>
                </div>

                <div className="space-y-3">
                  {proposal.aiEvaluation.ruleMatches.map((match, idx) => (
                    <div key={idx} className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1">
                      <div className="text-[#00e599] font-bold text-[10px] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00e599]"></span>
                        {match.title}
                      </div>
                      <p className="text-[#c8c6c2] text-[11px]">{match.note}</p>
                    </div>
                  ))}

                  <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1">
                    <div className="text-[#ff5719] font-bold text-[10px]">
                      EXCLUSION AUDIT
                    </div>
                    <p className="text-[#c8c6c2] text-[11px]">
                      {proposal.aiEvaluation.exclusionAudit}
                    </p>
                  </div>

                  <div className="p-4 bg-[#201f1f] border border-[#ff5719]/40 space-y-2">
                    <span className="text-[#ff5719] font-bold text-[10px] uppercase block">
                      SYNTHESIZED EVALUATION SUMMARY
                    </span>
                    <blockquote className="font-['Hanken_Grotesk'] italic text-sm text-[#e5e2e1] leading-relaxed">
                      &ldquo;{proposal.aiEvaluation.oracleSynthesis}&rdquo;
                    </blockquote>
                    <div className="text-[10px] text-[#888884] pt-1">
                      {proposal.aiEvaluation.oracleTx ? (
                        <span>ORACLE TX: {proposal.aiEvaluation.oracleTx.slice(0, 10)}...</span>
                      ) : (
                        <span>ON-CHAIN VERDICT // EXECUTED VIA GENVM VALIDATOR CONSENSUS</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Consensus Quorum Monitor */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                <span className="text-[#ff5719] font-bold uppercase">CONSENSUS QUORUM MONITOR</span>
                <span className="text-[#888884]">CHAIN 61997</span>
              </div>

              {isRecipientOnCommittee && (
                <div className="p-2 bg-[#ff5719]/10 border border-[#ff5719]/40 text-[#ff5719] text-[10px]">
                  RECUSAL ACTIVE: Recipient is a registered committee member. Voting pool reduced from {rawCommitteeSize} to {eligibleVotersCount} eligible voters.
                </div>
              )}

              <div className="flex justify-between items-baseline">
                <div>
                  <span className="text-[#888884] block text-[10px]">CURRENT YES TALLY</span>
                  <span className="font-['Space_Grotesk'] text-3xl font-bold text-[#e5e2e1]">
                    {currentYes} <span className="text-base text-[#888884]">/ {requiredYes} REQUIRED</span>
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[#888884] block text-[10px]">THRESHOLD</span>
                  <span className="font-['Space_Grotesk'] text-2xl font-bold text-[#ff5719]">
                    EXACT 2/3
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="w-full h-2 bg-[#0e0e0e] flex overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, totalVoters > 0 ? (currentYes / totalVoters) * 100 : 0)}%` }}
                    className="bg-[#ff5719]"
                  />
                  <div
                    style={{ width: `${totalVoters > 0 ? (currentNo / totalVoters) * 100 : 0}%` }}
                    className="bg-[#ff3344]"
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[#888884]">
                  <span>YES: {currentYes}</span>
                  <span>NO: {currentNo}</span>
                  <span>PENDING: {pendingVoters}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#2a2a2a] text-[11px]">
                <div>
                  <span className="text-[#888884] block text-[10px]">REGISTERED VOTERS</span>
                  <span className="text-[#e5e2e1] font-bold">{totalVoters} WALLETS</span>
                </div>
                <div>
                  <span className="text-[#888884] block text-[10px]">TOTAL PARTICIPATION</span>
                  <span className="text-[#e5e2e1] font-bold">
                    {currentYes + currentNo} / {totalVoters} ({participationPercent}%)
                  </span>
                </div>
              </div>

              <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] flex items-center justify-between text-[11px] text-[#888884]">
                <div className="flex items-center gap-1.5 text-[#ffb800]">
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  <span>{proposal.votes.deadlineRemaining}</span>
                </div>
                <span>{proposal.votes.targetBlock ? `TARGET BLOCK: #${proposal.votes.targetBlock}` : 'TARGET BLOCK: UNRECORDED'}</span>
              </div>
            </div>

            {/* Member Voting Console */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                <span className="text-[#ff5719] font-bold uppercase">MEMBER VOTING CONSOLE</span>
                <span className="text-[#888884]">
                  {isMember ? 'COMMITTEE MEMBER' : 'READ ONLY'}
                </span>
              </div>

              {!isConnected ? (
                legacyWriteBlocked ? (
                <div data-testid="legacy-write-block" className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ffb596] text-[11px] space-y-1">
                  <div className="font-bold uppercase">WRITE BLOCKED</div>
                  <p>{evaluateDecision.reason}</p>
                </div>
                ) : (
                <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-3">
                  <div className="text-[#888884] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
                    <span>NO WALLET CONNECTED</span>
                  </div>
                  <p className="text-[11px] text-[#c8c6c2]">
                    Anyone may read this proposal without a wallet. Connect a listed committee member to vote. One arbitrary wallet cannot vote for someone else.
                  </p>
                  <button
                    type="button"
                    onClick={() => void connectWallet()}
                    className="w-full py-2.5 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
                  >
                    CONNECT WALLET
                  </button>
                </div>
                )
              ) : !isMember ? (
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] text-[11px] text-[#888884] space-y-1">
                  <div className="text-[#ffb800] font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">info</span>
                    <span>WALLET NOT IN COMMITTEE ROSTER</span>
                  </div>
                  <p>
                    Connected account <span className="text-[#e5e2e1]">{account?.slice(0, 6)}...{account?.slice(-4)}</span> is not on the registered voter list for Round #{proposal.roundId.toUpperCase()}.
                  </p>
                </div>
              ) : legacyWriteBlocked ? (
                <div data-testid="legacy-write-block" className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ffb596] text-[11px] space-y-1">
                  <div className="font-bold">WRITE BLOCKED</div>
                  <p>{voteDecision.reason}</p>
                </div>
              ) : !isVotingWindowOpen ? (
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] text-[11px] text-[#888884] space-y-1">
                  <div className="text-[#ffb800] font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">lock</span>
                    <span>VOTING WINDOW CLOSED</span>
                  </div>
                  <p>
                    This proposal is in state <span className="text-[#e5e2e1] font-bold">{proposal.status}</span>. New votes cannot be submitted.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-[#0e0e0e] border border-[#00e599]/30 text-[11px] text-[#c8c6c2] space-y-1">
                    <div className="text-[#00e599] font-bold flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">verified</span>
                      <span>WALLET VERIFIED COMMITTEE MEMBER</span>
                    </div>
                    <p>
                      Address <span className="text-[#e5e2e1] font-mono">{account?.slice(0, 6)}...{account?.slice(-4)}</span> holds active governance voting standing.
                    </p>
                  </div>

                  {isRecipient ? (
                    <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[11px] space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">gavel</span>
                        <span>RECIPIENT RECUSED FROM VOTING</span>
                      </div>
                      <p>
                        In accordance with contract safety invariants, the proposal recipient is strictly recused from casting a vote on their own grant nomination.
                      </p>
                    </div>
                  ) : hasAlreadyVoted ? (
                    <div className="p-3 bg-[#00e599]/10 border border-[#00e599] text-[#00e599] text-[11px] space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        <span>BALLOT ALREADY RECORDED ON-CHAIN</span>
                      </div>
                      <p>
                        Your wallet participation has been securely logged into contract storage. Duplicate ballots are prevented by protocol logic.
                      </p>
                    </div>
                  ) : blockingVote ? (
                    <div className="p-3 bg-[#ffb800]/10 border border-[#ffb800] text-[#ffb800] text-[11px] space-y-1" data-testid="tx-reconcile-only">
                      <div className="font-bold">VOTE ALREADY RECORDED</div>
                      <p className="break-all">Read-only reconciliation is required. This vote cannot be submitted again. {blockingVote.txId}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button
                        type="button"
                        disabled={isPreparingTx}
                        onClick={() => handleInitiateVote('YES')}
                        className="py-3 bg-[#201f1f] border border-[#ff5719] text-[#ff5719] font-bold uppercase hover:bg-[#ff5719] hover:text-[#521300] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>{isPreparingTx ? 'PREPARING...' : 'VOTE YES ↗'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isPreparingTx}
                        onClick={() => handleInitiateVote('NO')}
                        className="py-3 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] hover:bg-[#ff3344] hover:text-white font-bold uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>{isPreparingTx ? 'PREPARING...' : 'VOTE NO ✕'}</span>
                      </button>
                    </div>
                  )}

                  {txError && (
                    <div className="p-2 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[10px] text-center">
                      {txError}
                    </div>
                  )}
                </div>
              )}

              {/* Permissionless Expiration Settlement Trigger */}
              {settleDecision.allowed && (
                <div className="p-3 bg-[#0e0e0e] border border-[#ffb800] space-y-2 mt-3">
                  <div className="flex justify-between items-center text-[10px] text-[#ffb800] font-bold uppercase">
                    <span>DEADLINE PASSED</span>
                    <span>SETTLEMENT ELIGIBLE</span>
                  </div>
                  <p className="text-[#c8c6c2] text-[11px]">{settleDecision.reason}</p>
                  <button
                    type="button"
                    disabled={isPreparingTx}
                    onClick={handleInitiateSettleExpired}
                    className="w-full py-2 bg-[#ffb800] text-black font-bold uppercase hover:bg-white transition-colors cursor-pointer"
                  >
                    {isPreparingTx ? 'PREPARING...' : 'SETTLE EXPIRED PROPOSAL ON-CHAIN ↗'}
                  </button>
                </div>
              )}

              {/* Permissionless AI Charter Review Trigger */}
              {legacyWriteBlocked && (
                <div data-testid="legacy-write-block" className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ffb596] text-[11px] space-y-1 mt-3">
                  <div className="font-bold uppercase">WRITE BLOCKED</div>
                  <p>{evaluateDecision.reason}</p>
                </div>
              )}
              {proposal.status === 'SUBMITTED' && !legacyWriteBlocked && !blockingEvaluate && (
                <div className="p-3 bg-[#0e0e0e] border border-[#ff5719] space-y-2 mt-3">
                  <div className="flex justify-between items-center text-[10px] text-[#ff5719] font-bold uppercase">
                    <span>STAGE 02 // ACTIONABLE</span>
                    <span>PERMISSIONLESS TRIGGER</span>
                  </div>
                  <p className="text-[#c8c6c2] text-[11px]">{evaluateDecision.reason}</p>
                  <button
                    type="button"
                    data-testid="trigger-ai-evaluation"
                    disabled={isPreparingTx || !evaluateDecision.allowed}
                    title={evaluateDecision.reason}
                    onClick={handleInitiateEvaluate}
                    className="w-full py-2.5 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black font-bold uppercase text-center transition-colors cursor-pointer disabled:bg-[#201f1f] disabled:text-[#888884]"
                  >
                    {isPreparingTx ? 'PREPARING REVIEW...' : 'TRIGGER AI CHARTER EVALUATION ↗'}
                  </button>
                </div>
              )}
              {blockingEvaluate && (
                <div className="p-3 bg-[#ffb800]/10 border border-[#ffb800] text-[#ffb800] text-[11px] space-y-1 mt-3" data-testid="tx-reconcile-only">
                  <div className="font-bold uppercase">EVALUATION ALREADY RECORDED</div>
                  <p className="break-all">Read-only reconciliation is required. This evaluation cannot be submitted again. {blockingEvaluate.txId}</p>
                </div>
              )}

              <p className="text-[10px] text-[#888884] text-center pt-1">
                RULE: 1 member = 1 vote. Unweighted cryptographic ballot. Recipient strictly recused.
              </p>
            </div>

            {/* Grant Claim & Withdrawal Controls */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                <span className="text-[#ff5719] font-bold uppercase">GRANT WITHDRAWAL CONTROLS</span>
                <span className="text-[#888884]">BENEFICIARY PIPELINE</span>
              </div>

              {proposal.status === 'PAYOUT_EMITTED' ? (
                <div className="p-3 bg-[#00e599]/10 border border-[#00e599]/40 text-[#00e599] text-[11px] space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">verified</span>
                    <span>PAYOUT_EMITTED</span>
                  </div>
                  <p>Native test GEN transfer was emitted by contract to recipient wallet.</p>
                </div>
              ) : proposal.status !== 'APPROVED' ? (
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1 text-[11px] text-[#888884]">
                  <div className="text-[#888884] font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">lock</span>
                    <span>WITHDRAWAL LOCKED</span>
                  </div>
                  <p>
                    Proposal must reach approved quorum ({requiredYes ? `${requiredYes} YES votes` : '2/3 supermajority'}) before recipient withdrawal executes.
                  </p>
                </div>
              ) : !isConnected ? (
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1 text-[11px] text-[#888884]">
                  <span>Connect recipient wallet to access claim controls.</span>
                </div>
              ) : !isRecipient ? (
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1 text-[11px] text-[#888884]">
                  <span className="text-[#ffb800] block font-bold">NON-RECIPIENT ACCOUNT</span>
                  <p>
                    Only designated recipient {proposal.recipientAddress.slice(0, 6)}...{proposal.recipientAddress.slice(-4)} can withdraw this allocation.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-[#0e0e0e] border border-[#00e599]/40 space-y-2 text-[11px]">
                  <div className="text-[#00e599] font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>RECIPIENT VERIFIED (APPROVED CREDIT)</span>
                  </div>
                  <p className="text-[#c8c6c2]">
                    {proposal.requestedGen.toLocaleString()} test GEN allocated. Execute pull-payout:
                  </p>
                  {blockingWithdraw ? (
                    <div className="p-2 bg-[#ffb800]/10 border border-[#ffb800] text-[#ffb800] space-y-1" data-testid="withdraw-reconcile-only">
                      <div className="font-bold uppercase">WITHDRAWAL ALREADY RECORDED</div>
                      <p className="break-all">Read-only reconciliation is required. This withdrawal cannot be submitted again. {blockingWithdraw.txId}</p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="trigger-withdraw-credit"
                      disabled={isPreparingTx || !withdrawDecision.allowed}
                      title={withdrawDecision.reason}
                      onClick={handleInitiateWithdraw}
                      className="w-full py-2.5 bg-[#00e599] text-black font-bold uppercase hover:bg-white transition-colors cursor-pointer disabled:bg-[#201f1f] disabled:text-[#888884]"
                    >
                      {isPreparingTx ? 'PREPARING WITHDRAWAL...' : 'WITHDRAW GRANT ALLOCATION ↗'}
                    </button>
                  )}
                  <p className="text-[10px] text-[#888884]">{withdrawDecision.reason}</p>
                </div>
              )}
            </div>

            {/* Treasury Accounting Impact */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                <span className="text-[#ff5719] font-bold uppercase">TREASURY IMPACT AT RESOLUTION</span>
                <span className="text-[#888884]">SPECIFICATION</span>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-[#0e0e0e] border border-[#00e599]/30 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#00e599] font-bold">IF RATIFIED (&gt;= {requiredYes} YES)</span>
                    <span className="text-[#888884]">AUTHORIZED</span>
                  </div>
                  <p className="text-[#c8c6c2] text-[11px]">
                    {proposal.requestedGen.toLocaleString()} test GEN converts from Reserved allocation into active recipient claim authorization.
                  </p>
                </div>

                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#888884] font-bold">IF REJECTED / EXPIRED</span>
                    <span className="text-[#888884]">RELEASE</span>
                  </div>
                  <p className="text-[#c8c6c2] text-[11px]">
                    {proposal.requestedGen.toLocaleString()} test GEN allocation releases back to available treasury pool.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Proposal Event Stream // Audit Log */}
      <section className="w-full px-4 lg:px-10 py-10 bg-[#0e0e0e] border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between text-[#888884] pb-2 border-b border-[#262626]">
            <div className="flex items-center gap-2 text-[#ff5719] font-bold">
              <span>{isDesignPreview ? '[DESIGN PREVIEW // SIMULATED EVENT LOG]' : '[ON-CHAIN PARTICIPATION RECORD]'}</span>
              <span>{isDesignPreview ? `SAMPLE EVENTS FOR PROPOSAL #${proposal.id.toUpperCase()}` : `VOTER PARTICIPATION FOR PROPOSAL #${proposal.id.toUpperCase()}`}</span>
            </div>
            <span>CHAIN ID: 61997</span>
          </div>

          <div className="overflow-x-auto border border-[#262626]">
            <table className="w-full text-left font-mono text-xs divide-y divide-[#262626]">
              <thead className="bg-[#1c1b1b] text-[#888884] uppercase text-[10px]">
                <tr>
                  <th className="p-3">BLOCK #</th>
                  <th className="p-3">NODE ADDRESS</th>
                  <th className="p-3">RECORD</th>
                  <th className="p-3">TIMESTAMP</th>
                  <th className="p-3">WEIGHT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222] bg-[#141414]">
                {proposal.eventLog.map((log, idx) => (
                  <tr key={idx}>
                    <td className="p-3 font-bold text-[#ff5719]">
                      {log.block && log.block > 0 ? `#${log.block}` : <span className="text-[#888884] font-normal">UNRECORDED</span>}
                    </td>
                    <td className="p-3 text-[#e5e2e1]">{log.voterNode || 'SYSTEM'}</td>
                    <td className="p-3">
                      {log.stance ? (
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold ${
                            log.stance === 'YES'
                              ? 'bg-[#00e599]/20 text-[#00e599]'
                              : 'bg-[#ff3344]/20 text-[#ff3344]'
                          }`}
                        >
                          BALLOT: {log.stance}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-mono text-[#ffb800] bg-[#201f1f] border border-[#ffb800]/30">
                          BALLOT CAST (CHOICE UNRECORDED ON-CHAIN)
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-[#888884]">{log.timestamp || 'UNRECORDED'}</td>
                    <td className="p-3 text-[#e5e2e1]">1 VOTE</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Interactive Vote Confirmation Modal (DEMO ONLY) */}
      {showVoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
              <span className="text-[#ff5719] font-bold uppercase">
                DEMONSTRATION MODAL: [{showVoteModal}]
              </span>
              <button
                type="button"
                onClick={() => setShowVoteModal(null)}
                className="text-[#888884] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-[#0e0e0e] border border-[#ff5719]/40 text-[#c8c6c2] text-[11px] space-y-1">
              <span className="text-[#ff5719] font-bold uppercase block">
                MODAL DEMONSTRATION NOTICE:
              </span>
              <p>
                This modal demonstrates the voting interaction flow against fixture data. It will not request a signature, submit a transaction, or modify on-chain vote tallies.
              </p>
            </div>

            <div className="space-y-1.5 bg-[#0e0e0e] p-3 border border-[#2a2a2a]">
              <div className="flex justify-between text-[#888884]">
                <span>PROPOSAL:</span>
                <span className="text-[#e5e2e1] font-bold">#{proposal.id.toUpperCase()}</span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>BALLOT CHOICE:</span>
                <span className={showVoteModal === 'YES' ? 'text-[#00e599] font-bold' : 'text-[#ff3344] font-bold'}>
                  {showVoteModal}
                </span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>CONNECTED WALLET:</span>
                <span className="text-[#e5e2e1]">
                  {account ? `${account.slice(0, 10)}...` : 'NONE'}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-[#2a2a2a]">
              <button
                type="button"
                onClick={() => setShowVoteModal(null)}
                className="px-4 py-2 bg-[#201f1f] text-[#c8c6c2] hover:text-white uppercase"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleModalDemoSubmit}
                className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
              >
                DEMO CLOSE (NO ON-CHAIN WRITE) ↗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Review & Tracking Modal */}
      <TransactionModal
        isOpen={showTxModal}
        onClose={closeTxModal}
        initialSnapshot={initialSnapshot}
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
