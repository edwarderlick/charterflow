import React, { useState } from 'react';
import {
  type PreparedTransaction,
  type PersistedTx,
  executeAndTrackTransaction,
  verifyIntendedStateAfterSuccess,
  updatePersistedTransaction,
} from '../services/transactionService';
import { GENLAYER_STUDIO_NEXT } from '../context/WalletContext';
import { weiToGen, type DataAccessAdapter } from '../services/dataAccess';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  prepared: PreparedTransaction | null;
  provider: any;
  account: string;
  adapter: DataAccessAdapter;
  onSuccess?: (persisted: PersistedTx) => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  prepared,
  provider,
  account,
  adapter,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTx, setCurrentTx] = useState<PersistedTx | null>(null);
  const [livePhase, setLivePhase] = useState<string>('standby');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    message: string;
    correlatedProposalId?: string;
  } | null>(null);

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

  const handleSignAndSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    setVerificationResult(null);

    try {
      const persisted = await executeAndTrackTransaction(
        prepared,
        provider,
        account,
        {
          onSubmitted: (txId) => {
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
        const targetId =
          prepared.action === 'create_round'
            ? prepared.roundId || ''
            : prepared.proposalId || prepared.roundId || '';

        const verify = await verifyIntendedStateAfterSuccess(
          prepared.action,
          targetId,
          adapter,
          account,
          {
            nominateArgs: prepared.nominateArgs,
            preBroadcastProposalIds: prepared.preBroadcastProposalIds,
            roundId: prepared.roundId,
          }
        );
        setVerificationResult(verify);

        // Strict Separation: Call onSuccess ONLY when on-chain post-state is conclusively verified
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
      setErrorMsg(err?.message || 'Transaction submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isConcluded =
    currentTx?.status === 'finalized-success' ||
    currentTx?.status === 'finalized-error' ||
    currentTx?.status === 'timeout' ||
    currentTx?.status === 'unresolved';

  const isWorkflowCompleted =
    currentTx?.status === 'finalized-success' && verificationResult?.verified === true;

  const isUnverifiedSuccess =
    currentTx?.status === 'finalized-success' && verificationResult?.verified === false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
      <div className="bg-[#1c1b1b] border border-[#2a2a2a] max-w-xl w-full p-6 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center pb-3 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#ff5719]"></span>
            <span className="text-[#ff5719] font-bold uppercase tracking-wider">
              {prepared.action.replace(/_/g, ' ')} // TRANSACTION REVIEW
            </span>
          </div>
          {!isSubmitting && (
            <button
              type="button"
              onClick={onClose}
              className="text-[#888884] hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

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
            <span className="text-[#e5e2e1]">
              {'address' in prepared.submitInput ? prepared.submitInput.address : 'DEPLOYMENT'}
            </span>
          </div>
          <div className="flex justify-between text-[#888884] text-[11px]">
            <span>NETWORK:</span>
            <span className="text-[#00e599] font-bold">CHAIN 61997 (STUDIO DEVNET)</span>
          </div>
        </div>

        {/* Separate Payable Value vs Protocol-Fee Deposit */}
        <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-4 space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-[#201f1f]">
            <span className="text-[#888884]">SEPARATE PAYABLE VALUE:</span>
            <span className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]">
              {payableGen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} GEN
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
            <span className="font-['Space_Grotesk'] text-lg font-bold text-[#00e599]">
              {totalGen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} GEN
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
              MSG FEES: <span className="text-[#c8c6c2]">{weiToGen(prepared.quote.breakdown.messageFees)} GEN</span>
            </div>
          </div>
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
              <code className="text-[#e5e2e1] truncate flex-1 text-[10px]">{currentTx.txId || currentTx.intentId}</code>
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
            <div className="flex justify-between items-center">
              <span className="text-[#888884] text-[10px]">
                {currentTx.txId ? 'TRANSACTION ID:' : 'WRITE INTENT ID:'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyTxId(currentTx.txId || currentTx.intentId)}
                  className="text-[10px] text-[#888884] hover:text-white uppercase"
                >
                  [{copiedId ? 'COPIED' : 'COPY'}]
                </button>
                {currentTx.txId ? (
                  <a
                    href={`${GENLAYER_STUDIO_NEXT.explorerUrl}tx/${currentTx.txId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#ff5719] hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>
                      {currentTx.txId.slice(0, 10)}...{currentTx.txId.slice(-8)}
                    </span>
                    <span className="material-symbols-outlined text-[13px]">north_east</span>
                  </a>
                ) : (
                  <span className="text-[#e5e2e1] text-[10px]">
                    {currentTx.intentId}
                  </span>
                )}
              </div>
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

        {/* Verification Status Banner: Strict Distinction */}
        {verificationResult && (
          <div
            className={`p-3 border text-[11px] space-y-1 ${
              verificationResult.verified
                ? 'bg-[#00e599]/10 border-[#00e599] text-[#00e599]'
                : 'bg-[#ffb800]/10 border-[#ffb800] text-[#ffb800]'
            }`}
          >
            <div className="font-bold flex items-center gap-1.5">
              <span>{verificationResult.verified ? '✓ ON-CHAIN STATE VERIFIED' : '⚠ APPLICATION READBACK UNVERIFIED'}</span>
            </div>
            <p className="text-[10px]">
              {verificationResult.verified
                ? verificationResult.message
                : `Transaction succeeded; application readback unverified. ${verificationResult.message}`}
            </p>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[11px]">
            {errorMsg}
          </div>
        )}

        {/* Modal Controls */}
        <div className="flex justify-between items-center pt-3 border-t border-[#2a2a2a]">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="px-4 py-2.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white uppercase transition-colors"
          >
            {isConcluded ? 'CLOSE' : 'CANCEL'}
          </button>

          {!isConcluded && (
            <button
              type="button"
              disabled={isSubmitting || prepared.isBlocked}
              onClick={handleSignAndSubmit}
              className={`px-6 py-2.5 font-bold uppercase tracking-wider flex items-center gap-2 transition-colors ${
                isSubmitting || prepared.isBlocked
                  ? 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'
                  : 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black cursor-pointer'
              }`}
            >
              <span>{isSubmitting ? 'SIGNING & SUBMITTING...' : 'SIGN & SUBMIT IN WALLET ↗'}</span>
            </button>
          )}

          {isWorkflowCompleted && (
            <div className="px-4 py-2 bg-[#00e599]/20 text-[#00e599] font-bold uppercase text-[10px] tracking-wider">
              WORKFLOW COMPLETE
            </div>
          )}

          {isUnverifiedSuccess && (
            <div className="px-4 py-2 bg-[#ffb800]/20 text-[#ffb800] font-bold uppercase text-[10px] tracking-wider">
              AWAITING READBACK CONFIRMATION
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
