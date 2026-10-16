import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useData } from '../services/dataAccess';
import { weiToGen } from '../services/dataAccess';
import { LEGACY_FUNDED_ROUND, NEXT_RUNNER_COMPAT_SOURCE, VERIFIED_DEPLOYMENT } from '../config/network';
import {
  CORRECTED_SOURCE_SHA256,
  deployResubmitBlockReason,
  loadCorrectedContractSource,
  prepareCorrectedDeploy,
  readDeployIntent,
  readHistoricalDeployResult,
  readStoredDeployResult,
  respectDeployIntentAfterReload,
  submitCorrectedDeploy,
  type CorrectedDeployQuote,
  type CorrectedDeployResult,
  type DeployBroadcastIntent,
} from '../services/deployCorrectedCore';

export const DeployCorrectedPage: React.FC = () => {
  const { adapter, isDesignPreview } = useData();
  const {
    account,
    isConnected,
    isCorrectNetwork,
    provider,
    connectWallet,
    switchToStudioNext,
    chainId,
    balanceLabel,
  } = useWallet();

  const [sourceSha, setSourceSha] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<CorrectedDeployQuote | null>(null);
  const [result, setResult] = useState<CorrectedDeployResult | null>(readStoredDeployResult());
  const [historical] = useState<CorrectedDeployResult | null>(readHistoricalDeployResult());
  const [intent, setIntent] = useState<DeployBroadcastIntent | null>(() => respectDeployIntentAfterReload());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIntent(respectDeployIntentAfterReload());
    setResult(readStoredDeployResult());
  }, []);

  useEffect(() => {
    let mounted = true;
    loadCorrectedContractSource()
      .then((src) => {
        if (!mounted) return;
        setSourceSha(src.sha256);
      })
      .catch((err: { message?: string }) => {
        if (!mounted) return;
        setSourceError(err?.message || 'Failed to load contract source');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleQuote = async () => {
    setError(null);
    if (isDesignPreview) {
      setError('Turn PREVIEW DATA off. This deploy is a live Studio Next write.');
      return;
    }
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (!provider) {
      setError('No injected EIP-1193 provider selected.');
      return;
    }
    if (!isCorrectNetwork) {
      await switchToStudioNext();
      return;
    }
    setBusy(true);
    try {
      const quote = await prepareCorrectedDeploy({ provider, account });
      setPrepared(quote);
    } catch (err: any) {
      setError(err?.message || 'Failed to estimate deploy fees');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!prepared || !provider || !account) return;
    setBusy(true);
    setError(null);
    try {
      const submitted = await submitCorrectedDeploy({ provider, account, prepared });
      setResult(submitted);
      setIntent(readDeployIntent());
    } catch (err: any) {
      setIntent(readDeployIntent());
      setResult(readStoredDeployResult());
      setError(err?.message || 'Wallet rejected or deploy submit failed');
    } finally {
      setBusy(false);
    }
  };

  const blockReason = deployResubmitBlockReason();
  const outcomeUncertain = intent?.status === 'OUTCOME_UNCERTAIN';
  const broadcasting = intent?.status === 'BROADCASTING' || (busy && Boolean(prepared) && !result);

  void adapter;

  return (
    <div className="flex-1 bg-[#131313] px-4 lg:px-10 py-10">
      <div className="max-w-3xl mx-auto space-y-6 font-mono">
        <p className="text-[11px] text-[#ff5719] font-bold uppercase">Runner-compat CharterFlowCore deploy · fee only · one attempt</p>
        <h1 className="font-['Space_Grotesk'] text-3xl uppercase font-bold text-[#e5e2e1]">
          Deploy runner-compat source
        </h1>
        <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
          Source {CORRECTED_SOURCE_SHA256} is already deployed. Another deploy is blocked. Payable value on that deployment was 0 GEN.
          This page does not create a round, does not call evaluate_charter_fit, and does not resend nomination {LEGACY_FUNDED_ROUND.failedNominationTransaction}.
          Verified contract <span className="break-all text-[#e5e2e1]" data-testid="verified-contract-address">{VERIFIED_DEPLOYMENT.contractAddress}</span> runs that source.
          Deploy tx <span className="break-all text-[#e5e2e1]">{VERIFIED_DEPLOYMENT.deployTransaction}</span>.
          Legacy contract {NEXT_RUNNER_COMPAT_SOURCE.unpatchableLiveSourceSha256} remains on the previous address and cannot be patched.
          Recovery contract {LEGACY_FUNDED_ROUND.contractAddress} stays separate.
        </p>

        <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-4 text-xs space-y-2">
          <div className="flex justify-between gap-4"><span className="text-[#888884]">PREVIEW DATA</span><span>{isDesignPreview ? 'ON (blocked)' : 'OFF'}</span></div>
          <div className="flex justify-between gap-4"><span className="text-[#888884]">CHAIN</span><span>{chainId ?? 'n/a'} / 61997</span></div>
          <div className="flex justify-between gap-4"><span className="text-[#888884]">WALLET</span><span className="break-all">{account || 'disconnected'}</span></div>
          <div className="flex justify-between gap-4"><span className="text-[#888884]">BALANCE</span><span>{balanceLabel}</span></div>
          <div className="flex justify-between gap-4"><span className="text-[#888884]">SOURCE FILE</span><span>{sourceError || sourceSha || 'loading…'}</span></div>
          <div className="flex justify-between gap-4"><span className="text-[#888884]">HASH MATCH</span><span>{sourceSha === CORRECTED_SOURCE_SHA256 ? 'YES' : 'NO'}</span></div>
        </div>

        {blockReason && (
          <div data-testid="deploy-write-block" className="bg-[#ff3344]/10 border border-[#ff3344] p-4 text-xs text-[#ffb596] break-all">
            {blockReason}
          </div>
        )}

        {historical && historical.sourceSha256 !== CORRECTED_SOURCE_SHA256 && (
          <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-4 text-xs space-y-2">
            <div className="text-[#888884] font-bold uppercase">Previous deploy recorded — different source</div>
            <div className="break-all">genlayerTxId: {historical.genlayerTxId}</div>
            <div className="break-all">source: {historical.sourceSha256 || NEXT_RUNNER_COMPAT_SOURCE.unpatchableLiveSourceSha256}</div>
            <p className="text-[#888884]">That record stays in local storage. It does not deploy this candidate and it does not move the two funded rounds.</p>
          </div>
        )}

        {outcomeUncertain && (
          <div className="bg-[#0e0e0e] border border-[#ff3344]/50 p-4 text-xs space-y-2">
            <div className="text-[#ffb596] font-bold uppercase">OUTCOME UNCERTAIN — do not deploy again</div>
            <p>
              The wallet may already have submitted this candidate. Resubmission stays blocked until a read-only reconciliation resolves intent {intent?.intentId}.
            </p>
            {intent?.genlayerTxId && <div className="break-all">genlayerTxId: {intent.genlayerTxId}</div>}
            {intent?.error && <div className="break-all text-[#888884]">{intent.error}</div>}
          </div>
        )}

        {broadcasting && !result && !outcomeUncertain && (
          <div className="bg-[#0e0e0e] border border-[#ff5719]/50 p-4 text-xs space-y-2">
            <div className="text-[#ff5719] font-bold uppercase">BROADCASTING</div>
            <p>A source, account, and chain bound intent is stored before the wallet prompt. A second click, reload, or other tab must not send another deploy.</p>
            {intent?.intentId && <div className="break-all">intent: {intent.intentId}</div>}
          </div>
        )}

        {result ? (
          <div className="bg-[#0e0e0e] border border-[#00e599]/40 p-4 text-xs space-y-2">
            <div className="text-[#00e599] font-bold uppercase">Deploy submitted — do not send another</div>
            <div className="break-all">genlayerTxId: {result.genlayerTxId}</div>
            {result.evmTxHash && <div className="break-all">evmTxHash: {result.evmTxHash}</div>}
            <div>submittedAt: {result.submittedAt}</div>
            <p className="text-[#888884]">This record is not a second deploy. The verified contract is {VERIFIED_DEPLOYMENT.contractAddress}.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {prepared && (
              <div className="bg-[#0e0e0e] border border-[#2a2a2a] p-4 text-xs space-y-2">
                <div className="flex justify-between"><span className="text-[#888884]">USER VALUE</span><span>{weiToGen(prepared.userValueWei)} GEN</span></div>
                <div className="flex justify-between"><span className="text-[#888884]">NETWORK FEE</span><span>{weiToGen(prepared.feeValueWei)} GEN</span></div>
                <div className="text-[#888884]">Approve this in the wallet. No 1 GEN deposit is included.</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || Boolean(sourceError) || sourceSha !== CORRECTED_SOURCE_SHA256 || Boolean(blockReason)}
                onClick={handleQuote}
                className="px-4 py-2.5 bg-[#201f1f] border border-[#2a2a2a] text-xs uppercase font-bold hover:text-white disabled:opacity-40"
              >
                {busy && !prepared ? 'Estimating…' : 'Review deploy fee'}
              </button>
              <button
                type="button"
                disabled={busy || !prepared || Boolean(blockReason)}
                onClick={handleSubmit}
                className="px-4 py-2.5 bg-[#ff5719] text-[#521300] text-xs uppercase font-bold hover:bg-white hover:text-black disabled:opacity-40"
              >
                {busy && prepared ? 'Waiting for wallet…' : blockReason ? 'Deploy blocked' : 'Approve deploy in wallet'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-[#201f1f] border border-[#ff3344]/40 text-xs text-[#ffb596] break-all">{error}</div>
        )}

        <Link to="/test" className="inline-block text-[11px] text-[#888884] uppercase hover:text-white">
          Back to Test CharterFlow ↗
        </Link>
      </div>
    </div>
  );
};
