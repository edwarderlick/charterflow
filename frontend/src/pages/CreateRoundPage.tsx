import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Barcode } from '../components/Barcode';
import { useData } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import { prepareActionTransaction } from '../services/transactionService';
import { TransactionModal } from '../components/TransactionModal';
import { clearTxModalSnapshot, useTxModalResume } from '../services/txModalSnapshot';
import { canCreateRound } from '../services/permissions';
import {
  CHARTERFLOW_CORE_ADDRESS,
  NETWORK_READBACK_UNAVAILABLE_MESSAGE,
  currentBrowserOrigin,
  draftFromFormValues,
  formValuesFromDraft,
  isNetworkReadbackUnavailableError,
  PILOT_CREATOR,
  PILOT_RECIPIENT,
  PILOT_SIGN_EVIDENCE_URL,
  pilotControlMessage,
  pilotControlReady,
  recipientRecusalThreshold,
  twoSignerRpcHealthPilotForm,
  validateCreateRoundForm,
  type CreateRoundFormValues,
} from '../services/createRoundSpec';
import {
  commitDraftsForVerifiedRounds,
  commitMatchingRoundDrafts,
  draftHasUserContent,
  importPreviewDraftToLive,
  isCommittedRoundDraft,
  pickHydrationDraft,
  readRoundDraft,
  readRoundDraftInventory,
  saveRoundDraftToStore,
  withCarriedCommit,
  type RoundDraftInventory,
  type StoredRoundDraft,
} from '../services/roundDraft';
function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const emptyForm = (): CreateRoundFormValues => ({
  title: '',
  summary: '',
  capInput: '',
  durationDaysInput: '',
  votingDaysInput: '',
  depositInput: '',
  permittedDirectives: [],
  exclusions: [],
  rosterInput: '',
  plannedRecipient: '',
  ratified: false,
});

function initialPilotRequest(): boolean {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pilot') === 'rpc-health';
  } catch {
    return false;
  }
}

export const CreateRoundPage: React.FC = () => {
  const navigate = useNavigate();
  const { adapter, isDesignPreview } = useData();
  const { account, chainId, isConnected, connectWallet, provider, isCorrectNetwork, balanceGen } = useWallet();

  const [inventory, setInventory] = useState<RoundDraftInventory>(() => readRoundDraftInventory(getLocalStorage()));
  const pilotRequested = initialPilotRequest();
  const initialDraft = pilotRequested ? null : pickHydrationDraft(readRoundDraftInventory(getLocalStorage()), false);
  const [currentStep, setCurrentStep] = useState<number>(pilotRequested ? 4 : initialDraft?.currentStep && initialDraft.currentStep >= 1 && initialDraft.currentStep <= 4 ? initialDraft.currentStep : 1);
  const [form, setForm] = useState<CreateRoundFormValues>(() =>
    pilotRequested ? twoSignerRpcHealthPilotForm() : initialDraft && draftHasUserContent(initialDraft) ? formValuesFromDraft(initialDraft) : emptyForm()
  );
  const [newDirective, setNewDirective] = useState('');
  const [newExclusion, setNewExclusion] = useState('');
  const [hydrated] = useState(true);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const { preparedTx, setPreparedTx, showTxModal, setShowTxModal, closeTxModal, initialSnapshot } = useTxModalResume();
  const [isPreparingTx, setIsPreparingTx] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [readHealthNotice, setReadHealthNotice] = useState<string | null>(null);
  const [provedSigners, setProvedSigners] = useState<string[]>([]);
  const [signNote, setSignNote] = useState<string | null>(null);
  const [isProvingSigner, setIsProvingSigner] = useState(false);
  const signingReady = !pilotRequested || pilotControlReady(provedSigners);

  const refreshInventory = useCallback(() => {
    setInventory(readRoundDraftInventory(getLocalStorage()));
  }, []);

  const persistWorking = useCallback(
    (nextForm: CreateRoundFormValues, step = currentStep) => {
      const storage = getLocalStorage();
      const existing = readRoundDraft(storage, 'working');
      const next = withCarriedCommit(existing, draftFromFormValues(nextForm, { currentStep: step }));
      saveRoundDraftToStore(storage, 'working', next);
      refreshInventory();
    },
    [currentStep, refreshInventory]
  );

  const applyDraft = useCallback(
    (draft: StoredRoundDraft, notice: string) => {
      const next = formValuesFromDraft(draft);
      setForm(next);
      if (draft.currentStep && draft.currentStep >= 1 && draft.currentStep <= 4) {
        setCurrentStep(draft.currentStep);
      }
      persistWorking(next, draft.currentStep || currentStep);
      setFeedbackNotice(notice);
      setTimeout(() => setFeedbackNotice(null), 4000);
    },
    [currentStep, persistWorking]
  );

  useEffect(() => {
    if (!hydrated) return;
    persistWorking(form, currentStep);
  }, [form, currentStep, hydrated, persistWorking]);

  useEffect(() => {
    refreshInventory();
  }, [isDesignPreview, refreshInventory]);

  useEffect(() => {
    if (isDesignPreview) return;
    let cancelled = false;
    adapter
      .getRounds()
      .then((liveRounds) => {
        if (cancelled) return;
        const result = commitDraftsForVerifiedRounds(
          getLocalStorage(),
          liveRounds.map((round) => ({ id: round.id, title: round.title }))
        );
        if (result.committedStores.length > 0) refreshInventory();
      })
      .catch(() => {
        // A failed read is not verification. Leave the local draft untouched.
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, isDesignPreview, refreshInventory]);

  const validation = useMemo(() => validateCreateRoundForm(form), [form]);
  const { roster } = validation;
  const totalCommittee = roster.valid.length;
  const approval = recipientRecusalThreshold(roster.valid, form.plannedRecipient);
  const canSubmitSpec = validation.ok;

  const patchForm = (partial: Partial<CreateRoundFormValues>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  };

  const handleRestore = (draft: StoredRoundDraft | null) => {
    if (!draft) return;
    applyDraft(draft, `LOCAL DRAFT RESTORED FROM ${String(draft.sourceStore || 'storage').toUpperCase()} STORAGE.`);
  };

  const handleSaveDraft = (store: 'preview' | 'live' = isDesignPreview ? 'preview' : 'live') => {
    const storage = getLocalStorage();
    const draft = draftFromFormValues(form, { currentStep, ratified: form.ratified });
    saveRoundDraftToStore(storage, store, withCarriedCommit(readRoundDraft(storage, store), draft));
    saveRoundDraftToStore(storage, 'working', withCarriedCommit(readRoundDraft(storage, 'working'), draft));
    refreshInventory();
    setFeedbackNotice(
      store === 'preview'
        ? 'PREVIEW DRAFT STORED IN BROWSER STORAGE. THIS IS NOT AN ON-CHAIN ROUND.'
        : 'LIVE DRAFT STORED IN BROWSER STORAGE. THIS IS NOT AN ON-CHAIN ROUND.'
    );
    setTimeout(() => setFeedbackNotice(null), 4000);
  };

  const handleImportPreviewToLive = () => {
    const imported = importPreviewDraftToLive(getLocalStorage());
    if (!imported) {
      setFeedbackNotice('NO PREVIEW DRAFT TO IMPORT.');
      return;
    }
    applyDraft(imported, 'PREVIEW DRAFT IMPORTED INTO LIVE STORAGE. EVERY FIELD, ROSTER ADDRESS, AND RATIFICATION WAS COPIED.');
    setShowImportModal(false);
  };

  const handleSimulatePreview = () => {
    if (!isDesignPreview) return;
    handleSaveDraft('preview');
    setShowPreviewModal(true);
  };

  const handleReviewRealTransaction = async () => {
    if (isDesignPreview) {
      setTxError('Turn PREVIEW DATA off to review a real create_round on the deployed CharterFlowCore. Your form values stay in local draft storage.');
      return;
    }
    if (pilotRequested && !pilotControlReady(provedSigners)) {
      setTxError('Prove signing control for 0xb3F7…0407 and 0x31e1…0a05 before create_round. The check is a personal_sign and spends no GEN.');
      return;
    }
    handleSaveDraft('live');
    if (!canSubmitSpec) {
      setTxError(validation.errors[0] || 'Form does not satisfy contract create_round rules.');
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
    setReadHealthNotice(null);
    try {
      const health = await adapter.probeContractViewHealth();
      if (!health.ok) {
        const message = NETWORK_READBACK_UNAVAILABLE_MESSAGE + ` Diagnostic: ${health.diagnostic}`;
        setReadHealthNotice(message);
        setTxError(message);
        setIsPreparingTx(false);
        return;
      }
    } catch (err: unknown) {
      const message = NETWORK_READBACK_UNAVAILABLE_MESSAGE + ` Diagnostic: ${String((err as { message?: string })?.message || err)}`;
      setReadHealthNotice(message);
      setTxError(message);
      setIsPreparingTx(false);
      return;
    }
    if (!isConnected || !account) {
      setIsPreparingTx(false);
      await connectWallet();
      return;
    }
    if (!provider) {
      setTxError('No injected EIP-1193 provider selected.');
      setIsPreparingTx(false);
      return;
    }
    if (!chainId || chainId !== 61997 || !isCorrectNetwork) {
      setTxError('Wallet network unverified. Switch to GenLayer Studio Next (Chain ID 61997) with an explicit click. The app will not auto-switch.');
      setIsPreparingTx(false);
      return;
    }
    if (balanceGen === '0.00') {
      setTxError('This wallet has 0 GEN. The contract requires a 1 GEN minimum deposit plus network fees.');
      setIsPreparingTx(false);
      return;
    }
    if (approval.recipientOnRoster && approval.eligibleVoters.length === 1) {
      const creator = approval.eligibleVoters[0];
      if (account.toLowerCase() !== creator.toLowerCase()) {
        setTxError(
          `Creator and nominator must be the sole eligible voter ${creator}. Connected wallet is ${account}. The planned recipient is recused and is not the create_round signer.`
        );
        setIsPreparingTx(false);
        return;
      }
    }

    try {
      const grantCapWei = validation.capWei;
      const initialDepositWei = validation.depositWei;
      const schedule = validation.schedule;
      if (!grantCapWei || !initialDepositWei || !schedule) {
        setTxError('Form amounts or deadlines could not be prepared.');
        return;
      }

      const cleanSlug = form.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 16);
      const roundSlug = `round-${cleanSlug || 'genesis'}-${Date.now().toString(36)}`;

      const prepared = await prepareActionTransaction({
        action: 'create_round',
        provider,
        account,
        chainId,
        adapter,
        createRoundArgs: {
          round_id: roundSlug,
          title: form.title.trim(),
          description: form.summary.trim(),
          charter_text: validation.charterText,
          committee_roster: roster.valid,
          grant_cap_wei: grantCapWei,
          nomination_cutoff: schedule.nominationCutoff,
          voting_duration: schedule.votingDuration,
          round_end: schedule.roundEnd,
          initial_deposit_wei: initialDepositWei,
          approval,
        },
      });
      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: unknown) {
      if (isNetworkReadbackUnavailableError(err)) {
        const message = NETWORK_READBACK_UNAVAILABLE_MESSAGE + ` Diagnostic: ${String((err as { message?: string })?.message || err)}`;
        setReadHealthNotice(message);
        setTxError(message);
      } else {
        setTxError((err as { message?: string })?.message || 'Failed to prepare create_round');
      }
    } finally {
      setIsPreparingTx(false);
    }
  };

  const reportPilotEvidence = (body: Record<string, string>) => {
    if (!pilotRequested) return;
    void fetch(PILOT_SIGN_EVIDENCE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  };

  const proveConnectedSigner = async () => {
    if (!pilotRequested) return;
    if (!isConnected || !account || !provider) {
      await connectWallet();
      setSignNote('Wallet connect requested. Select the pilot account in MetaMask, then press SIGN WITH CONNECTED ACCOUNT again.');
      return;
    }
    setIsProvingSigner(true);
    setSignNote(null);
    const message = pilotControlMessage(new Date().toISOString());
    try {
      const signature = await provider.request({ method: 'personal_sign', params: [message, account] });
      const signatureHex = String(signature);
      if (!signatureHex.startsWith('0x')) {
        setSignNote('Wallet returned a signature that is not a 0x hex string.');
        return;
      }
      const { recoverMessageAddress } = await import('viem');
      const recovered = await recoverMessageAddress({
        message,
        signature: signatureHex as `0x${string}`,
      });
      if (recovered.toLowerCase() !== account.toLowerCase()) {
        setSignNote(`Signature recovered ${recovered}, which does not match the connected account ${account}.`);
        return;
      }
      const allowed = recovered.toLowerCase() === PILOT_CREATOR.toLowerCase() || recovered.toLowerCase() === PILOT_RECIPIENT.toLowerCase();
      if (!allowed) {
        setSignNote(`Connected account ${account} is not one of the two pilot accounts.`);
        return;
      }
      setProvedSigners((prev) => Array.from(new Set([...prev, recovered.toLowerCase()])));
      setSignNote(`Signing control proved for ${recovered}. Switch MetaMask to the other pilot account and sign again. No GEN was spent.`);
      reportPilotEvidence({ kind: 'sign', message, signature: String(signature), recovered });
    } catch (err: unknown) {
      setSignNote((err as { message?: string })?.message || 'The wallet did not sign the control check.');
    } finally {
      setIsProvingSigner(false);
    }
  };

  const handleAddDirective = (e: React.FormEvent) => {
    e.preventDefault();
    if (newDirective.trim()) {
      patchForm({ permittedDirectives: [...form.permittedDirectives, newDirective.trim()] });
      setNewDirective('');
    }
  };

  const handleRemoveDirective = (index: number) => {
    patchForm({ permittedDirectives: form.permittedDirectives.filter((_, i) => i !== index) });
  };

  const handleAddExclusion = (e: React.FormEvent) => {
    e.preventDefault();
    if (newExclusion.trim()) {
      patchForm({ exclusions: [...form.exclusions, newExclusion.trim()] });
      setNewExclusion('');
    }
  };

  const handleRemoveExclusion = (index: number) => {
    patchForm({ exclusions: form.exclusions.filter((_, i) => i !== index) });
  };

  const createPermission = canCreateRound({
    connected: isConnected,
    correctChain: isCorrectNetwork,
    balanceGen,
  });
  const otherModeDraft = isDesignPreview ? inventory.live : inventory.preview;
  const currentModeDraft = isDesignPreview ? inventory.preview : inventory.live;
  const restoreCandidate =
    [currentModeDraft, inventory.working, otherModeDraft].find(
      (draft) => draftHasUserContent(draft) && !isCommittedRoundDraft(draft)
    ) || null;

  return (
    <div className="flex flex-col w-full bg-[#131313] min-h-screen">
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between font-mono text-xs">
          <div className="flex items-center gap-2">
            <Link to="/rounds" className="text-[#888884] hover:text-[#ff5719]">
              ROUNDS
            </Link>
            <span className="text-[#383838]">/</span>
            <span className="text-[#ff5719] font-bold">CREATE ROUND</span>
          </div>
          <div className="text-[#888884] hidden sm:block">
            STATUS: <span className="text-[#ff5719] font-bold">LOCAL DRAFT</span> · NOT ON-CHAIN
          </div>
        </div>
      </section>

      {restoreCandidate && (
        <section className="w-full bg-[#1c1b1b] border-b-2 border-[#ff5719] px-4 lg:px-10 py-3 font-mono text-xs">
          <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[#ff5719]">
                <span className="px-2 py-0.5 bg-[#ff5719] text-[#521300] font-bold">RESTORE LOCAL DRAFT</span>
                <span className="text-[#e5e2e1] font-bold">
                  {(restoreCandidate?.title || 'Untitled round').toUpperCase()}
                </span>
              </div>
              <p className="text-[#c8c6c2] text-[11px]">
                Browser origin {currentBrowserOrigin() || 'unavailable'} · preview key {inventory.preview ? 'present' : 'empty'} · live key{' '}
                {inventory.live ? 'present' : 'empty'} · working snapshot {inventory.working ? 'present' : 'empty'}. This is a local
                draft, not a created round.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="restore-local-draft"
                onClick={() => handleRestore(restoreCandidate)}
                className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
              >
                RESTORE LOCAL DRAFT
              </button>
              {!isDesignPreview && inventory.preview && (
                <button
                  type="button"
                  data-testid="import-preview-draft"
                  onClick={() => setShowImportModal(true)}
                  className="px-4 py-2 bg-[#201f1f] border border-[#ff5719] text-[#ff5719] font-bold uppercase hover:bg-[#2a2a2a]"
                >
                  IMPORT PREVIEW → LIVE
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs text-[#888884] pb-1">
              <span className="text-[#ff5719] font-bold">FORM: CF-CRT-61997</span>
              <span>CALLS create_round — DOES NOT DEPLOY A NEW CONTRACT</span>
            </div>
            <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl uppercase text-[#e5e2e1] font-bold">
              Create & Fund Grant Round
            </h1>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] mt-1 max-w-3xl">
              This form calls <span className="text-[#e5e2e1] font-mono">create_round</span> on the existing deployed CharterFlowCore at{' '}
              <span className="text-[#ff5719] font-mono">{CHARTERFLOW_CORE_ADDRESS}</span> (chain 61997). It does not deploy a new
              immutable contract. A saved draft is never an on-chain round.
            </p>
          </div>
          {feedbackNotice && (
            <div className="p-2.5 bg-[#201f1f] border border-[#ff5719] text-[#ff5719] font-mono text-xs">
              {feedbackNotice}
            </div>
          )}
        </div>
      </section>

      <section className="w-full px-4 lg:px-10 py-4 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs">
          {[
            { step: 1, label: 'Parameters', hint: 'Caps & Round Scope', ok: validation.titleOk && validation.summaryOk && validation.capOk },
            { step: 2, label: 'Charter & Scope', hint: 'Permitted Clauses & Bans', ok: validation.charterOk },
            { step: 3, label: 'Roster & Quorum', hint: 'Whitelists & Thresholds', ok: validation.rosterOk },
            { step: 4, label: 'Treasury Escrow', hint: 'Deposit & Review', ok: validation.depositOk && validation.ratifiedOk },
          ].map((item) => (
            <button
              key={item.step}
              type="button"
              onClick={() => setCurrentStep(item.step)}
              className={`p-3 text-left border transition-colors ${
                currentStep === item.step
                  ? 'bg-[#2a2a2a] border-[#ff5719] text-[#ff5719]'
                  : 'bg-[#1c1b1b] border-[#262626] text-[#888884] hover:text-[#e5e2e1]'
              }`}
            >
              <div className="flex justify-between items-center text-[10px]">
                <span className="font-bold">STEP 0{item.step}</span>
                <span>{item.ok ? '✓' : `[${item.step}/4]`}</span>
              </div>
              <div className="font-['Space_Grotesk'] text-sm font-bold uppercase text-[#e5e2e1] mt-1">{item.label}</div>
              <div className="text-[10px] text-[#888884]">{item.hint}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="w-full px-4 lg:px-10 py-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-6">
            {currentStep === 1 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">Basic Parameters</h2>
                  <span className="font-mono text-xs text-[#888884]">5–120 / 10–2000</span>
                </div>
                <div>
                  <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">ROUND TITLE *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => patchForm({ title: e.target.value })}
                    placeholder="Enter a title (5–120 characters). No sample title is pre-filled."
                    className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                  />
                  <p className="font-mono text-[10px] text-[#888884] mt-1">{form.title.trim().length} / 120 characters</p>
                </div>
                <div>
                  <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">DESCRIPTION *</label>
                  <textarea
                    rows={3}
                    value={form.summary}
                    onChange={(e) => patchForm({ summary: e.target.value })}
                    placeholder="Describe the round (10–2000 characters)."
                    className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                  />
                  <p className="font-mono text-[10px] text-[#888884] mt-1">{form.summary.trim().length} / 2000 characters</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">GRANT CAP (GEN) *</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.capInput}
                      onChange={(e) => patchForm({ capInput: e.target.value })}
                      placeholder="Positive amount, no greater than deposit"
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm font-mono text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">NOMINATION WINDOW (DAYS) *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.durationDaysInput}
                      onChange={(e) => patchForm({ durationDaysInput: e.target.value })}
                      placeholder="At least 1 day"
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm font-mono text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-4 border-t border-[#2a2a2a]">
                  <button type="button" onClick={() => setCurrentStep(2)} className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold">
                    CONTINUE TO CHARTER & SCOPE ↗
                  </button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">Frozen Charter Clauses</h2>
                <p className="font-mono text-[11px] text-[#888884]">
                  Assembled charter length {validation.charterLength} (contract requires 100–16384). Directives and exclusions are
                  concatenated with the title and description.
                </p>
                <div className="space-y-2">
                  {form.permittedDirectives.map((directive, index) => (
                    <div key={`${directive}-${index}`} className="flex items-center justify-between p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="font-mono text-xs text-[#e5e2e1]">#{String(index + 1).padStart(2, '0')} {directive}</span>
                      <button type="button" onClick={() => handleRemoveDirective(index)} className="text-[#888884] hover:text-[#ff3344]">✕</button>
                    </div>
                  ))}
                  <form onSubmit={handleAddDirective} className="flex gap-2">
                    <input value={newDirective} onChange={(e) => setNewDirective(e.target.value)} placeholder="Add permitted directive..." className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-2.5 text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none" />
                    <button type="submit" className="px-4 bg-[#2a2a2a] text-[#e5e2e1] font-mono text-xs uppercase font-bold">+ ADD DIRECTIVE</button>
                  </form>
                </div>
                <div className="space-y-2 pt-4 border-t border-[#2a2a2a]">
                  {form.exclusions.map((exclusion, index) => (
                    <div key={`${exclusion}-${index}`} className="flex items-center justify-between p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="font-mono text-xs text-[#c8c6c2]">X-{String(index + 1).padStart(2, '0')} {exclusion}</span>
                      <button type="button" onClick={() => handleRemoveExclusion(index)} className="text-[#888884] hover:text-[#ff3344]">✕</button>
                    </div>
                  ))}
                  <form onSubmit={handleAddExclusion} className="flex gap-2">
                    <input value={newExclusion} onChange={(e) => setNewExclusion(e.target.value)} placeholder="Add exclusion..." className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-2.5 text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none" />
                    <button type="submit" className="px-4 bg-[#2a2a2a] text-[#e5e2e1] font-mono text-xs uppercase font-bold">+ ADD EXCLUSION</button>
                  </form>
                </div>
                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button type="button" onClick={() => setCurrentStep(1)} className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase">← BACK</button>
                  <button type="button" onClick={() => setCurrentStep(3)} className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold">CONTINUE TO ROSTER ↗</button>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">Committee Roster</h2>
                <textarea
                  rows={6}
                  value={form.rosterInput}
                  onChange={(e) => patchForm({ rosterInput: e.target.value })}
                  placeholder="Paste at least two unique 0x addresses. No fabricated committee is pre-filled."
                  className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 font-mono text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                />
                <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1]">PLANNED PROPOSAL RECIPIENT</label>
                <input
                  value={form.plannedRecipient}
                  onChange={(e) => patchForm({ plannedRecipient: e.target.value })}
                  placeholder="0x address that will receive an approved proposal. On-roster recipients are recused."
                  className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 font-mono text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                />
                <p className="font-mono text-[10px] text-[#888884]" data-testid="approval-threshold">
                  {totalCommittee} valid · {roster.invalid.length} invalid · {approval.formula} Eligible voters: {approval.eligibleVoters.join(', ') || 'none'}.
                </p>
                <div>
                  <span className="font-mono text-xs text-[#e5e2e1] uppercase font-bold block mb-2">VOTING WINDOW (DAYS)</span>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                    {['3', '5', '7'].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => patchForm({ votingDaysInput: days })}
                        className={`p-2 uppercase font-bold ${form.votingDaysInput === days ? 'bg-[#ff5719] text-[#521300]' : 'bg-[#201f1f] text-[#c8c6c2]'}`}
                      >
                        {days} DAYS
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.votingDaysInput}
                    onChange={(e) => patchForm({ votingDaysInput: e.target.value })}
                    placeholder="Custom days"
                    className="mt-2 w-full bg-[#0e0e0e] border border-[#2a2a2a] p-2.5 text-xs font-mono text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                  />
                </div>
                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button type="button" onClick={() => setCurrentStep(2)} className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase">← BACK</button>
                  <button type="button" onClick={() => setCurrentStep(4)} className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold">CONTINUE TO TREASURY ↗</button>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">Treasury Deposit & Review</h2>
                <div>
                  <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">INITIAL DEPOSIT (GEN) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.depositInput}
                    onChange={(e) => patchForm({ depositInput: e.target.value })}
                    placeholder="Minimum 1 GEN. 50,000 is not pre-filled."
                    className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm font-mono text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                  />
                </div>
                <label className="flex items-start gap-3 cursor-pointer select-none p-4 bg-[#0e0e0e] border border-[#2a2a2a]">
                  <input type="checkbox" checked={form.ratified} onChange={(e) => patchForm({ ratified: e.target.checked })} className="mt-1 accent-[#ff5719]" />
                  <span className="font-mono text-xs text-[#c8c6c2]">
                    I understand this calls <span className="text-[#e5e2e1]">create_round</span> on CharterFlowCore {CHARTERFLOW_CORE_ADDRESS} and does not deploy a new contract. Round parameters freeze after a successful on-chain create.
                  </span>
                </label>
                {validation.errors.length > 0 && (
                  <div className="p-3 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] font-mono text-[11px] space-y-1">
                    {validation.errors.map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap justify-between gap-3 pt-4 border-t border-[#2a2a2a]">
                  <button type="button" onClick={() => setCurrentStep(3)} className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase">← BACK</button>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" data-testid="save-draft" onClick={() => handleSaveDraft()} className="px-4 py-2.5 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] font-mono text-xs uppercase">
                      SAVE DRAFT
                    </button>
                    {isDesignPreview && (
                      <button
                        type="button"
                        data-testid="simulate-preview"
                        disabled={!canSubmitSpec}
                        onClick={handleSimulatePreview}
                        className={`px-4 py-2.5 font-mono text-xs uppercase font-bold ${canSubmitSpec ? 'bg-[#2a2a2a] text-[#e5e2e1]' : 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'}`}
                      >
                        SIMULATE PREVIEW
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-4 bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
            <div className="flex items-center justify-between font-mono text-xs text-[#888884] pb-2 border-b border-[#2a2a2a]">
              <span className="text-[#ff5719] font-bold">CREATE ROUND ACTIONS</span>
              <Barcode width={120} height={16} color="#c8c6c2" />
            </div>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between gap-3 text-[#888884]"><span>CONTRACT</span><span className="text-[#e5e2e1] break-all text-right" data-testid="create-review-contract">{CHARTERFLOW_CORE_ADDRESS}</span></div>
              <div className="flex justify-between text-[#888884]"><span>CHAIN</span><span className="text-[#e5e2e1]">61997</span></div>
              <div className="flex justify-between text-[#888884]"><span>COMMITTEE</span><span className="text-[#e5e2e1]">{totalCommittee}</span></div>
              <div className="text-[10px] text-[#c8c6c2]" data-testid="create-review-approval">{approval.formula}</div>
              {pilotRequested && (
                <div className="space-y-2 border border-[#2a2a2a] p-2" data-testid="pilot-sign-control">
                  <div className="text-[#ff5719]">SIGNING CONTROL</div>
                  <p className="text-[10px] text-[#c8c6c2]">MetaMask personal_sign only. This does not spend GEN and does not ask for a seed phrase.</p>
                  <div className="text-[10px]">0xb3F7…0407 creator {provedSigners.includes(PILOT_CREATOR.toLowerCase()) ? 'SIGNED' : 'NEEDED'}</div>
                  <div className="text-[10px]">0x31e1…0a05 recipient {provedSigners.includes(PILOT_RECIPIENT.toLowerCase()) ? 'SIGNED' : 'NEEDED'}</div>
                  <button
                    type="button"
                    data-testid="prove-connected-signer"
                    disabled={isProvingSigner}
                    onClick={() => void proveConnectedSigner()}
                    className="w-full py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] uppercase"
                  >
                    {isProvingSigner ? 'WAITING FOR WALLET…' : 'SIGN WITH CONNECTED ACCOUNT'}
                  </button>
                  {signNote && <p className="text-[10px] text-[#c8c6c2]">{signNote}</p>}
                </div>
              )}
              <div className="text-[10px] text-[#888884]">ELIGIBLE VOTERS: <span className="text-[#e5e2e1] break-all">{approval.eligibleVoters.join(', ') || '—'}</span></div>
              {validation.schedule && (
                <div className="text-[10px] text-[#888884] space-y-1" data-testid="create-review-deadlines">
                  <div>NOMINATION CUTOFF {new Date(validation.schedule.nominationCutoff * 1000).toISOString()}</div>
                  <div>VOTING DURATION {validation.schedule.votingDuration}s</div>
                  <div>ROUND END {new Date(validation.schedule.roundEnd * 1000).toISOString()}</div>
                </div>
              )}
              <pre className="text-[10px] text-[#c8c6c2] whitespace-pre-wrap break-words max-h-36 overflow-auto" data-testid="create-review-charter">{validation.charterText}</pre>
              <div className="flex justify-between text-[#888884]"><span>DEPOSIT</span><span className="text-[#e5e2e1]">{form.depositInput || '—'} GEN</span></div>
              <div className="flex justify-between text-[#888884]"><span>CAP</span><span className="text-[#e5e2e1]">{form.capInput || '—'} GEN</span></div>
            </div>
            <button type="button" data-testid="save-draft-sidebar" onClick={() => handleSaveDraft()} className="w-full py-2.5 bg-[#201f1f] text-[#c8c6c2] border border-[#2a2a2a] font-mono text-xs uppercase">
              SAVE DRAFT
            </button>
            {isDesignPreview ? (
              <button
                type="button"
                data-testid="simulate-preview-sidebar"
                disabled={!canSubmitSpec}
                onClick={handleSimulatePreview}
                className="w-full py-3 bg-[#2a2a2a] text-[#e5e2e1] font-mono text-xs uppercase font-bold disabled:text-[#888884]"
              >
                SIMULATE PREVIEW
              </button>
            ) : (
              <button
                type="button"
                data-testid="review-real-transaction"
                disabled={!canSubmitSpec || isPreparingTx || !signingReady}
                onClick={() => void handleReviewRealTransaction()}
                title={createPermission.reason}
                className={`w-full py-3 font-mono text-xs uppercase font-bold ${
                  canSubmitSpec && !isPreparingTx && signingReady
                    ? 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black'
                    : 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'
                }`}
              >
                {isPreparingTx ? 'CHECKING READ HEALTH…' : 'REVIEW REAL TRANSACTION'}
              </button>
            )}
            <p className="font-mono text-[10px] text-[#888884]">{isDesignPreview ? 'Preview actions store a local draft only.' : createPermission.reason}</p>
            {(txError || readHealthNotice) && (
              <div data-testid="read-health-error" className="p-2 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[10px]">
                {readHealthNotice || txError}
              </div>
            )}
          </div>
        </div>
      </section>

      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-xl w-full p-6 space-y-4 font-mono text-xs">
            <div className="text-[#ff5719] font-bold uppercase">LOCAL DRAFT ONLY — NOT AN ON-CHAIN ROUND</div>
            <p className="text-[#c8c6c2]">
              SIMULATE PREVIEW stored a design-preview draft in <span className="text-[#e5e2e1]">cf_round_draft_preview</span>. It did not call create_round, did not open a wallet, and did not add a round to /rounds.
            </p>
            <div className="text-[#e5e2e1]">{form.title || 'Untitled'}</div>
            <button type="button" onClick={() => setShowPreviewModal(false)} className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase">
              KEEP EDITING DRAFT
            </button>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-xl w-full p-6 space-y-4 font-mono text-xs">
            <div className="text-[#ff5719] font-bold uppercase">IMPORT PREVIEW DRAFT INTO LIVE STORAGE</div>
            <p className="text-[#c8c6c2]">
              This copies every field, roster address, and ratification choice from cf_round_draft_preview into cf_round_draft_live. The preview copy is kept.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowImportModal(false)} className="px-4 py-2 bg-[#201f1f] text-[#c8c6c2] uppercase">CANCEL</button>
              <button type="button" data-testid="confirm-import-preview" onClick={handleImportPreviewToLive} className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase">
                CONFIRM IMPORT
              </button>
            </div>
          </div>
        </div>
      )}

      <TransactionModal
        isOpen={showTxModal}
        onClose={closeTxModal}
        prepared={preparedTx}
        initialSnapshot={initialSnapshot}
        provider={provider}
        account={account || ''}
        adapter={adapter}
        onSubmitted={(submitted) => {
          reportPilotEvidence({
            kind: 'tx',
            txId: submitted.txId,
            roundId: submitted.roundId || '',
            account: submitted.account,
            totalValueWei: submitted.totalValueWei,
          });
        }}
        onSuccess={(tx) => {
          clearTxModalSnapshot();
          const title = preparedTx?.createRoundExpected?.title || form.title;
          if (tx.roundId && title.trim()) {
            commitMatchingRoundDrafts(getLocalStorage(), {
              roundId: tx.roundId,
              title,
              txId: tx.txId,
            });
            refreshInventory();
          }
          if (tx.roundId) {
            navigate(`/rounds/${tx.roundId}`);
          }
        }}
      />
    </div>
  );
};
