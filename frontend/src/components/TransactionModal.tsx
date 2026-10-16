import React, { useEffect, useRef, useState } from 'react';
import {
  type PreparedTransaction,
  type PersistedTx,
  executeAndTrackTransaction,
  presentPostSuccessException,
  verifyIntendedStateAfterSuccess,
  updatePersistedTransaction,
} from '../services/transactionService';
import { GENLAYER_STUDIO_NEXT } from '../context/WalletContext';
import { weiToGen, type DataAccessAdapter } from '../services/dataAccess';
import {
  clearTxModalSnapshot,
  modalAllowsSubmit,
  quoteResumeToken,
  receiptStateForQuote,
  writeTxModalSnapshot,
  type TxModalSnapshot,
} from '../services/txModalSnapshot';
import {
  localForeignReceipt,
  modalReceiptFlags,
  payoutFeeNotice,
  resolveReceiptIdentity,
  type ReceiptClaim,
} from '../services/txActionIdentity';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  prepared: PreparedTransaction | null;
  provider: any;
  account: string;
  adapter: DataAccessAdapter;
  onSuccess?: (persisted: PersistedTx) => void;
  onSubmitted?: (submitted: { txId: string; roundId?: string; account: string; totalValueWei: string }) => void;
  initialSnapshot?: TxModalSnapshot | null;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  prepared,
  provider,
  account,
  adapter,
  onSuccess,
  onSubmitted,
  initialSnapshot = null,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pathname = window.location.pathname;
  const resumeToken = quoteResumeToken(isOpen, prepared, initialSnapshot);
  const seededReceipt = receiptStateForQuote(isOpen, prepared, initialSnapshot, pathname);
  const [appliedToken, setAppliedToken] = useState(resumeToken);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTx, setCurrentTx] = useState<PersistedTx | null>(seededReceipt.currentTx);
  const [livePhase, setLivePhase] = useState<string>(seededReceipt.livePhase);
  const [errorMsg, setErrorMsg] = useState<string | null>(seededReceipt.errorMsg);
  const [copiedId, setCopiedId] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    message: string;
    correlatedProposalId?: string;
  } | null>(seededReceipt.verificationResult);
  const [receiptClaim, setReceiptClaim] = useState<ReceiptClaim | null>(null);
  if (resumeToken !== appliedToken) {
    setAppliedToken(resumeToken);
    setCurrentTx(seededReceipt.currentTx);
    setLivePhase(seededReceipt.livePhase);
    setErrorMsg(seededReceipt.errorMsg);
    setVerificationResult(seededReceipt.verificationResult);
    setReceiptClaim(null);
  }

  const requestClose = () => {
    if (isSubmitting) return;
    clearTxModalSnapshot();
    onClose();
  };

  useEffect(() => {
    if (!prepared || !currentTx?.txId) {
      setReceiptClaim(null);
      return;
    }
    let cancelled = false;
    setReceiptClaim({
      claim: 'pending-identity',
      hash: currentTx.txId,
      message: `Resolving on-chain identity for ${currentTx.txId}. This hash is not yet a receipt for ${prepared.action}.`,
    });
    resolveReceiptIdentity(prepared, currentTx)
      .then((claim) => {
        if (!cancelled) setReceiptClaim(claim);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReceiptClaim({
          claim: 'uncertain',
          hash: currentTx.txId || '',
          message: `On-chain identity for ${currentTx.txId} is uncertain. ${String((err as { message?: string })?.message || err)}`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [prepared, currentTx]);

  useEffect(() => {
    if (!isOpen || !prepared) return;
    writeTxModalSnapshot({
      open: true,
      path: window.location.pathname,
      prepared,
      currentTx,
      livePhase,
      errorMsg,
      verificationResult,
    });
  }, [isOpen, prepared, currentTx, livePhase, errorMsg, verificationResult]);

  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSubmitting) return;
      event.preventDefault();
      clearTxModalSnapshot();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !prepared) return null;

  const payableGen = weiToGen(prepared.payableValueWei);
  const feeGen = weiToGen(prepared.feeValueWei);
  const totalGen = weiToGen(prepared.totalValueWei);

  const verificationStatus = prepared.quote.verification?.status || 'unavailable';

  const copyTxId = (id: string) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2500);
  };

  const runPostStateVerification = async (_persisted: PersistedTx) => {
    const targetId =
      prepared.action === 'create_round'
        ? prepared.roundId || ''
        : prepared.proposalId || prepared.roundId || '';
    let contractBalanceWei: bigint | null | undefined;
    if (prepared.action === 'create_round' && provider?.request && prepared.quotedContractAddress) {
      try {
        const balanceHex = await provider.request({
          method: 'eth_getBalance',
          params: [prepared.quotedContractAddress, 'latest'],
        });
        contractBalanceWei = BigInt(String(balanceHex));
      } catch {
        contractBalanceWei = null;
      }
    }
    let verify: { verified: boolean; message: string; correlatedProposalId?: string };
    try {
      verify = await verifyIntendedStateAfterSuccess(
        prepared.action,
        targetId,
        adapter,
        account,
        {
          nominateArgs: prepared.nominateArgs,
          preBroadcastProposalIds: prepared.preBroadcastProposalIds,
          roundId: prepared.roundId,
          createRoundExpected: prepared.createRoundExpected,
          ...(prepared.action === 'create_round' ? { contractBalanceWei } : {}),
        }
      );
    } catch (err: unknown) {
      verify = presentPostSuccessException(
        { status: 'finalized-success', txId: _persisted.txId || '0x' },
        err
      ).verification || { verified: false, message: 'Post-success readback failed.' };
    }
    setVerificationResult(verify);
    setErrorMsg(null);
    return verify;
  };

  const handleRetryReadback = async () => {
    if (!currentTx) return;
    setErrorMsg(null);
    const verify = await runPostStateVerification(currentTx);
    if (verify.verified) {
      const finalPersisted = verify.correlatedProposalId
        ? { ...currentTx, proposalId: verify.correlatedProposalId }
        : currentTx;
      if (onSuccess) onSuccess(finalPersisted);
    }
  };

  const handleSignAndSubmit = async () => {
    if (!modalAllowsSubmit({ currentTx, livePhase, errorMsg, verificationResult })) {
      setErrorMsg('This transaction is already recorded. Read-only reconciliation is required. It cannot be submitted again.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    setVerificationResult(null);
    let persisted: PersistedTx | null = null;

    try {
      persisted = await executeAndTrackTransaction(
        prepared,
        provider,
        account,
        {
          adapter,
          onSubmitted: (txId) => {
            onSubmitted?.({
              txId,
              roundId: prepared.roundId,
              account: prepared.quotedAccount,
              totalValueWei: prepared.totalValueWei.toString(),
            });
            setLivePhase('submitted');
            setCurrentTx({
              intentId: `intent_${txId}`,
              txId,
              action: prepared.action,
              roundId: prepared.roundId,
              proposalId: prepared.proposalId,
              account: prepared.quotedAccount,
              chainId: prepared.quotedChainId,
              contractAddress: prepared.quotedContractAddress,
              targetIdentifier: prepared.targetIdentifier,
              compositeTargetKey: prepared.compositeTargetKey,
              userValueWei: prepared.payableValueWei.toString(),
              feeValueWei: prepared.feeValueWei.toString(),
              totalValueWei: prepared.totalValueWei.toString(),
              submittedAt: Date.now(),
              status: 'submitted',
              phase: 'submitted',
            });
          },
          onStatusUpdate: (tracked) => {
            setLivePhase(tracked.phase);
            if (currentTx) {
              setCurrentTx((prev) =>
                prev
                  ? {
                      ...prev,
                      phase: tracked.phase,
                      statusName: tracked.statusName,
                      executionResultName: tracked.executionResultName,
                    }
                  : null
              );
            }
          },
          onPersistenceFailure: (_txId, _err) => {
            setCurrentTx((prev) =>
              prev ? { ...prev, storageFailure: true } : null
            );
          },
        }
      );

      setCurrentTx(persisted);

      if (persisted.status === 'finalized-success') {
        const verify = await runPostStateVerification(persisted);
        if (verify.verified) {
          const finalPersisted = verify.correlatedProposalId
            ? { ...persisted, proposalId: verify.correlatedProposalId }
            : persisted;
          if (verify.correlatedProposalId) {
            updatePersistedTransaction(persisted.txId || persisted.intentId, { proposalId: verify.correlatedProposalId });
            setCurrentTx(finalPersisted);
          }
          if (onSuccess) onSuccess(finalPersisted);
        }
      } else if (persisted.status === 'finalized-error') {
        setErrorMsg(
          persisted.error ||
            `Transaction finalized with error: ${persisted.executionResultName || 'EXECUTION_FAILED'}`
        );
      } else if (persisted.status === 'timeout' || persisted.status === 'unresolved') {
        setErrorMsg(
          persisted.error ||
            'Tracking timeout reached. Transaction may still be executing on-chain. Check the explorer before re-submitting.'
        );
      }
    } catch (err: any) {
      const presented = persisted
        ? presentPostSuccessException(persisted, err)
        : null;
      if (presented?.preserveReceipt && persisted) {
        setCurrentTx(persisted);
        setVerificationResult(presented.verification);
        setErrorMsg(null);
      } else {
        setErrorMsg(presented?.errorMsg || err?.message || 'Transaction submission failed.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const localMismatch = localForeignReceipt(prepared, currentTx);
  const chainReady =
    Boolean(currentTx?.txId) &&
    receiptClaim !== null &&
    receiptClaim.claim !== 'none' &&
    receiptClaim.claim !== 'pending-identity' &&
    receiptClaim.hash === currentTx?.txId;
  const receiptForFlags: ReceiptClaim | null = chainReady
    ? receiptClaim
    : localMismatch
      ? {
          claim: 'identity-mismatch',
          hash: currentTx?.txId || '',
          message: localMismatch,
        }
      : currentTx?.txId
        ? {
            claim: 'pending-identity',
            hash: currentTx.txId,
            message: `Resolving on-chain identity for ${currentTx.txId}. This hash is not yet a receipt for ${prepared.action}.`,
          }
        : null;
  const receiptFlags = modalReceiptFlags({
    preparedAction: prepared.action,
    currentTx,
    verificationVerified: verificationResult?.verified ?? null,
    receipt: receiptForFlags,
    connectedAccount: account,
    quotedAccount: prepared.quotedAccount,
  });
  const signable =
    modalAllowsSubmit({ currentTx, livePhase, errorMsg, verificationResult }) &&
    !receiptFlags.accountBlocked &&
    !receiptFlags.pendingIdentity &&
    !receiptFlags.identityError &&
    !receiptFlags.uncertainMessage &&
    !receiptFlags.deliveryUnverified;
  const isConcluded = !signable;
  const isWorkflowCompleted = receiptFlags.workflowComplete;
  const isUnverifiedSuccess =
    currentTx?.status === 'finalized-success' &&
    verificationResult?.verified === false &&
    !receiptFlags.identityError &&
    !receiptFlags.pendingIdentity;
  const feeNotice = payoutFeeNotice(prepared.action, prepared.quote.breakdown.messageFees);

  return (
    <div
      className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-black/80 p-3 font-mono text-xs sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-modal-title"
      data-testid="tx-modal-overlay"
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl items-start">
      <div
        className="flex max-h-[calc(100dvh-1.5rem)] w-full flex-col border border-[#2a2a2a] bg-[#1c1b1b] shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
        data-testid="tx-modal"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#2a2a2a] px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#ff5719]"></span>
            <span id="tx-modal-title" className="text-[#ff5719] font-bold uppercase tracking-wider">
              {prepared.action.replace(/_/g, ' ')} // TRANSACTION REVIEW
            </span>
          </div>
          {!isSubmitting && (
            <button
              type="button"
              onClick={requestClose}
              className="text-[#888884] hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6" data-testid="tx-modal-scroll">
        {/* Action Identification */}
        <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3 space-y-2">
          <div className="flex justify-between text-[#888884] text-[11px]">
            <span>TARGET METHOD:</span>
            <span className="text-[#e5e2e1] font-bold">
              {'method' in prepared.submitInput ? prepared.submitInput.method : prepared.action}
            </span>
          </div>
          <div className="flex justify-between text-[#888884] text-[11px]">
            <span>TARGET CONTRACT:</span>
            <span className="text-[#e5e2e1] break-all text-right" data-testid="tx-review-target-contract">
              {'address' in prepared.submitInput ? prepared.submitInput.address : 'DEPLOYMENT'}
            </span>
          </div>
          {prepared.action === 'withdraw_credit' && (
            <>
              <div className="flex justify-between text-[#888884] text-[11px] gap-4">
                <span>PROPOSAL:</span>
                <span className="text-[#e5e2e1] break-all text-right" data-testid="tx-review-proposal">
                  {prepared.proposalId}
                </span>
              </div>
              <div className="flex justify-between text-[#888884] text-[11px] gap-4">
                <span>RECIPIENT:</span>
                <span className="text-[#e5e2e1] break-all text-right" data-testid="tx-review-recipient">
                  {prepared.withdrawRecipient}
                </span>
              </div>
              {prepared.nativeTransfer && (
                <div className="text-[#888884] text-[11px] break-all" data-testid="tx-review-allocations">
                  MESSAGE ALLOCATIONS: {prepared.nativeTransfer.allocations.length}; budget {prepared.nativeTransfer.requiredBudgetWei} wei; recipients{' '}
                  <span data-testid="tx-review-allocation-recipients">
                    {prepared.nativeTransfer.allocations.map((item) => String(item.recipient)).join(', ')}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="flex justify-between text-[#888884] text-[11px]">
            <span>NETWORK:</span>
            <span className="text-[#00e599] font-bold">CHAIN {prepared.quotedChainId} (STUDIO NEXT)</span>
          </div>
          {prepared.action === 'create_round' && (
            <>
              <div className="flex justify-between text-[#888884] text-[11px]">
                <span>ROUND ID:</span>
                <span className="text-[#e5e2e1] font-bold break-all text-right ml-4">{prepared.roundId}</span>
              </div>
              <div className="flex justify-between text-[#888884] text-[11px]">
                <span>GENESIS DEPOSIT:</span>
                <span className="text-[#e5e2e1] font-bold">{payableGen} GEN</span>
              </div>
              {prepared.createRoundExpected && (
                <>
                  <div className="flex justify-between text-[#888884] text-[11px] gap-4">
                    <span>NOMINATION CUTOFF:</span>
                    <span className="text-[#e5e2e1] text-right">
                      {prepared.createRoundExpected.nominationCutoff}
                      <span className="block text-[10px] text-[#888884]">
                        {new Date(prepared.createRoundExpected.nominationCutoff * 1000).toISOString()}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between text-[#888884] text-[11px]">
                    <span>VOTING DURATION:</span>
                    <span className="text-[#e5e2e1]">{prepared.createRoundExpected.votingDuration}s</span>
                  </div>
                  <div className="flex justify-between text-[#888884] text-[11px] gap-4">
                    <span>ROUND END:</span>
                    <span className="text-[#e5e2e1] text-right">
                      {prepared.createRoundExpected.roundEnd}
                      <span className="block text-[10px] text-[#888884]">
                        {new Date(prepared.createRoundExpected.roundEnd * 1000).toISOString()}
                      </span>
                    </span>
                  </div>
                  <div className="text-[#888884] text-[11px]">
                    COMMITTEE ORDER: {prepared.createRoundExpected.committee.join(', ')}
                  </div>
                  {prepared.createRoundExpected.approval && (
                    <div className="text-[#e5e2e1] text-[11px]" data-testid="tx-approval-threshold">
                      {prepared.createRoundExpected.approval.formula} Eligible: {prepared.createRoundExpected.approval.eligibleVoters.join(', ') || 'none'}.
                    </div>
                  )}
                  {prepared.createRoundExpected.charterText && (
                    <pre className="text-[#c8c6c2] text-[10px] whitespace-pre-wrap break-words" data-testid="tx-review-charter">
                      {prepared.createRoundExpected.charterText}
                    </pre>
                  )}
                </>
              )}
            </>
          )}
          <div className="flex justify-between text-[#888884] text-[11px] gap-4">
            <span>SIGNER:</span>
            <span className="text-[#e5e2e1] break-all text-right" data-testid="tx-review-signer">{prepared.quotedAccount}</span>
          </div>
          <p className="text-[11px] text-[#c8c6c2] pt-1 border-t border-[#201f1f]">
            EXPECTED EFFECT: {prepared.expectedEffect}
          </p>
        </div>

        {/* Separate Payable Value vs Protocol-Fee Deposit */}
        <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-4 space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-[#201f1f]">
            <span className="text-[#888884]">SEPARATE PAYABLE VALUE:</span>
            <span className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]" data-testid="tx-review-payable-wei">
              {payableGen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} GEN
              <span className="block text-[10px] text-[#888884]">{prepared.payableValueWei.toString()} wei</span>
            </span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-[#201f1f]">
            <span className="text-[#888884]">ESTIMATED PROTOCOL-FEE DEPOSIT:</span>
            <span className="font-['Space_Grotesk'] text-sm font-bold text-[#ff5719]">
              {feeGen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} GEN
            </span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-[#e5e2e1] font-bold">TOTAL WALLET DEDUCTION:</span>
            <span className="font-['Space_Grotesk'] text-lg font-bold text-[#00e599] text-right" data-testid="tx-review-total-wei">
              {totalGen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} GEN
              <span className="block text-[10px] text-[#888884]">{prepared.totalValueWei.toString()} wei</span>
            </span>
          </div>
        </div>

        {/* Fee Review & Policy Verification Badge */}
        <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-3 space-y-2 text-[11px]">
          <div className="flex justify-between items-center">
            <span className="text-[#888884]">FEE POLICY VERIFICATION:</span>
            <span
              className={`px-2 py-0.5 font-bold uppercase text-[10px] ${
                verificationStatus === 'verified'
                  ? 'bg-[#00e599]/20 text-[#00e599]'
                  : verificationStatus === 'mismatch'
                  ? 'bg-[#ff3344]/20 text-[#ff3344]'
                  : 'bg-[#ffb800]/20 text-[#ffb800]'
              }`}
            >
              STATUS: {verificationStatus}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 text-[10px] text-[#888884]">
            <div>
              TIME UNITS: <span className="text-[#c8c6c2]">{weiToGen(prepared.quote.breakdown.timeUnitFees)} GEN</span>
            </div>
            <div>
              EXEC BUDGET: <span className="text-[#c8c6c2]">{weiToGen(prepared.quote.breakdown.executionBudget)} GEN</span>
            </div>
            <div>
              MSG FEES: <span className="text-[#c8c6c2]" data-testid="tx-review-message-fees-wei">{prepared.quote.breakdown.messageFees.toString()} wei ({weiToGen(prepared.quote.breakdown.messageFees)} GEN)</span>
            </div>
          </div>
          {feeNotice && (
            <p
              className={`text-[10px] pt-1 ${feeNotice.tone === 'measured' ? 'text-[#c8c6c2]' : 'text-[#ffb800]'}`}
              data-testid="tx-message-fee-notice"
              data-tone={feeNotice.tone}
            >
              {feeNotice.text}
            </p>
          )}
        </div>

        {/* Policy Mismatch Block Notice */}
        {prepared.isBlocked && (
          <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[11px] space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">block</span>
              <span>SUBMISSION BLOCKED</span>
            </div>
            <p>{prepared.blockReason}</p>
          </div>
        )}

        {/* Storage Persistence Failure Prominent Warning */}
        {currentTx?.storageFailure && (
          <div className="p-3 bg-[#ffb800]/10 border border-[#ffb800] text-[#ffb800] text-[11px] space-y-2">
            <div className="font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">warning</span>
              <span>LOCAL PERSISTENCE FAILED</span>
            </div>
            <p>
              Transaction was submitted to network, but failed to save in browser local storage.
              This transaction is <strong>NOT safely resumable</strong> across page reload. Please copy your Transaction ID:
            </p>
            <div className="flex items-center gap-2 bg-[#0e0e0e] p-1.5 border border-[#ffb800]/40">
              <code className="flex-1 break-all text-[10px] text-[#e5e2e1]">{currentTx.txId || currentTx.intentId}</code>
              <button
                type="button"
                onClick={() => copyTxId(currentTx.txId || currentTx.intentId)}
                className="px-2 py-0.5 bg-[#ffb800] text-black font-bold uppercase text-[9px]"
              >
                {copiedId ? 'COPIED' : 'COPY'}
              </button>
            </div>
          </div>
        )}

        {/* Active Transaction Status Tracker */}
        {currentTx && (
          <div className="p-4 bg-[#0e0e0e] border border-[#ff5719]/40 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#888884] text-[10px]">
                  {currentTx.txId ? 'TRANSACTION ID:' : 'WRITE INTENT ID:'}
                </span>
                <button
                  type="button"
                  onClick={() => copyTxId(currentTx.txId || currentTx.intentId)}
                  className="text-[10px] text-[#888884] hover:text-white uppercase"
                >
                  [{copiedId ? 'COPIED' : 'COPY'}]
                </button>
              </div>
              {currentTx.txId ? (
                <a
                  href={`${GENLAYER_STUDIO_NEXT.explorerUrl}tx/${currentTx.txId}`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="tx-review-hash"
                  className="block break-all text-left text-[11px] text-[#ff5719] hover:underline"
                >
                  {currentTx.txId}
                </a>
              ) : (
                <span className="block break-all text-[#e5e2e1] text-[10px]">
                  {currentTx.intentId}
                </span>
              )}
            </div>

            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#888884]">LIFECYCLE PHASE:</span>
              <span className="text-[#e5e2e1] uppercase font-bold flex items-center gap-1.5">
                {isSubmitting && (
                  <span className="w-2 h-2 rounded-full bg-[#ff5719] animate-ping"></span>
                )}
                {livePhase}
              </span>
            </div>

            {currentTx.statusName && (
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[#888884]">DECISION STATUS:</span>
                <span
                  className={`font-bold ${
                    currentTx.statusName === 'ACCEPTED' || currentTx.statusName === 'FINALIZED'
                      ? 'text-[#00e599]'
                      : 'text-[#ffb800]'
                  }`}
                >
                  {currentTx.statusName}
                </span>
              </div>
            )}

            {currentTx.executionResultName && (
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[#888884]">EXECUTION RESULT:</span>
                <span
                  className={`font-bold ${
                    currentTx.executionResultName === 'FINISHED_WITH_RETURN'
                      ? 'text-[#00e599]'
                      : 'text-[#ff3344]'
                  }`}
                >
                  {currentTx.executionResultName}
                </span>
              </div>
            )}
          </div>
        )}

        {receiptFlags.pendingIdentity && currentTx?.txId && (
          <div className="p-3 bg-[#ffb800]/10 border border-[#ffb800] text-[#ffb800] text-[11px] space-y-1" data-testid="tx-identity-pending">
            <div className="font-bold">RESOLVING TRANSACTION IDENTITY</div>
            <p className="text-[10px] break-all">{receiptClaim?.claim === 'pending-identity' ? receiptClaim.message : `Resolving ${currentTx.txId}.`}</p>
          </div>
        )}

        {receiptFlags.identityError && (
          <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[11px] space-y-1" data-testid="tx-identity-error">
            <div className="font-bold">TRANSACTION IDENTITY MISMATCH</div>
            <p className="text-[10px]">{receiptFlags.identityError}</p>
            {currentTx?.txId && <p className="text-[10px] break-all text-[#e5e2e1]">Preserved hash: {currentTx.txId}</p>}
          </div>
        )}

        {receiptFlags.deliveryUnverified && (
          <div className="p-3 bg-[#ffb800]/10 border border-[#ffb800] text-[#ffb800] text-[11px] space-y-1" data-testid="tx-delivery-unverified">
            <div className="font-bold">PAYOUT PARENT MATCHED — DELIVERY UNVERIFIED</div>
            <p className="text-[10px]">{receiptFlags.deliveryUnverified}</p>
          </div>
        )}

        {receiptFlags.accountBlocked && (
          <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[11px]" data-testid="tx-account-mismatch">
            Connected account {account} is not the quoted signer {prepared.quotedAccount}. Another submit is blocked.
          </div>
        )}

        {/* Verification Status Banner: Strict Distinction */}
        {verificationResult && !receiptFlags.identityError && !receiptFlags.pendingIdentity && (
          <div
            className={`p-3 border text-[11px] space-y-1 ${
              verificationResult.verified
                ? 'bg-[#00e599]/10 border-[#00e599] text-[#00e599]'
                : 'bg-[#ffb800]/10 border-[#ffb800] text-[#ffb800]'
            }`}
          >
            <div className="font-bold flex items-center gap-1.5">
              <span>{verificationResult.verified ? '✓ ON-CHAIN STATE VERIFIED' : 'FINALIZED, READBACK UNCERTAIN'}</span>
            </div>
            <p className="text-[10px]">
              {verificationResult.verified
                ? verificationResult.message
                : `Receipt succeeded; independent readback did not confirm the round. Transaction hash is preserved. Do not resubmit. ${verificationResult.message}`}
            </p>
            {currentTx?.txId && (
              <p className="text-[10px] break-all text-[#e5e2e1]">TX: {currentTx.txId}</p>
            )}
            {!verificationResult.verified && (
              <button
                type="button"
                data-testid="retry-readback"
                onClick={() => void handleRetryReadback()}
                className="mt-2 px-3 py-1.5 bg-[#ff5719] text-[#521300] font-bold uppercase"
              >
                RETRY READBACK
              </button>
            )}
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[11px]">
            {errorMsg}
          </div>
        )}

        </div>

        {/* Modal Controls stay inside the viewport while the body scrolls */}
        <div
          className="flex shrink-0 flex-col gap-2 border-t border-[#2a2a2a] bg-[#1c1b1b] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6"
          data-testid="tx-modal-actions"
        >
          <button
            ref={cancelRef}
            type="button"
            disabled={isSubmitting}
            onClick={requestClose}
            className="w-full px-4 py-2.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white uppercase transition-colors sm:w-auto"
          >
            {isConcluded ? 'CLOSE' : 'CANCEL'}
          </button>

          {!signable && (
            <p className="w-full break-all text-[10px] text-[#ffb800]" data-testid="tx-reconcile-only">
              {receiptFlags.identityError
                ? `Identity mismatch. Another submit is blocked until this hash is reconciled. ${currentTx?.txId || ''}`
                : receiptFlags.deliveryUnverified
                ? `Recipient delivery is unverified. Another submit is blocked. ${currentTx?.txId || ''}`
                : receiptFlags.pendingIdentity || receiptFlags.uncertainMessage
                ? `Read-only reconciliation is required. This transaction cannot be submitted again. ${currentTx?.txId || ''}`
                : verificationResult?.verified === false ||
                  currentTx?.status === 'broadcast-unknown' ||
                  currentTx?.status === 'unresolved' ||
                  currentTx?.status === 'timeout' ||
                  currentTx?.status === 'intent-prepared'
                ? 'Read-only reconciliation is required. This transaction cannot be submitted again.'
                : 'This transaction is recorded and cannot be submitted again.'}
              {!receiptFlags.identityError && !receiptFlags.deliveryUnverified && !receiptFlags.pendingIdentity && currentTx?.txId
                ? ` ${currentTx.txId}`
                : ''}
            </p>
          )}
          {signable && (
            <button
              type="button"
              data-testid="tx-sign-submit"
              disabled={isSubmitting || prepared.isBlocked}
              onClick={handleSignAndSubmit}
              className={`flex w-full items-center justify-center gap-2 px-6 py-2.5 font-bold uppercase tracking-wider transition-colors sm:w-auto ${
                isSubmitting || prepared.isBlocked
                  ? 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'
                  : 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black cursor-pointer'
              }`}
            >
              <span>{isSubmitting ? 'SIGNING & SUBMITTING...' : 'SIGN & SUBMIT IN WALLET ↗'}</span>
            </button>
          )}

          {isWorkflowCompleted && (
            <div className="px-4 py-2 bg-[#00e599]/20 text-[#00e599] font-bold uppercase text-[10px] tracking-wider" data-testid="tx-workflow-complete">
              WORKFLOW COMPLETE
            </div>
          )}

          {isUnverifiedSuccess && (
            <div className="px-4 py-2 bg-[#ffb800]/20 text-[#ffb800] font-bold uppercase text-[10px] tracking-wider">
              FINALIZED, READBACK UNCERTAIN
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
