import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useData, parseGenToWei } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import {
  prepareActionTransaction,
  type PreparedTransaction,
} from '../services/transactionService';
import { TransactionModal } from '../components/TransactionModal';
import type { Round, ProposalDraft } from '../types';

export const NominateProposalPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { adapter, isDesignPreview, refreshData } = useData();
  const { account, chainId, isConnected, connectWallet } = useWallet();

  const roundId = id || '';
  const [round, setRound] = useState<Round | null>(null);
  const [loading, setLoading] = useState(true);

  // Form Fields - clean default values without fabricated data
  const [recipientAddress, setRecipientAddress] = useState('');
  const [requestedAmount, setRequestedAmount] = useState<number>(0);
  const [selectedDirective, setSelectedDirective] = useState<string>('');
  const [workDescription, setWorkDescription] = useState('');
  const [deliverablesText, setDeliverablesText] = useState('');
  const [attested, setAttested] = useState(false);

  // Draft recovery state
  const [savedDraft, setSavedDraft] = useState<ProposalDraft | null>(null);

  // Step Wizard & Transaction State
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [showTxModal, setShowTxModal] = useState<boolean>(false);
  const [isPreparingTx, setIsPreparingTx] = useState<boolean>(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!roundId) {
      setLoading(false);
      return;
    }

    adapter.getRoundById(roundId).then((r) => {
      if (mounted) {
        setRound(r || null);
        if (r && r.charterRules.length > 0 && !selectedDirective) {
          setSelectedDirective(r.charterRules[0].id);
        }
        setLoading(false);
      }
    });

    // Check saved draft
    const draft = adapter.getProposalDraft(roundId);
    if (draft && mounted) {
      setSavedDraft(draft);
    }

    return () => {
      mounted = false;
    };
  }, [roundId, adapter]);

  const handleRestoreDraft = () => {
    if (!savedDraft) return;
    setRecipientAddress(savedDraft.recipientAddress || '');
    setRequestedAmount(savedDraft.requestedGen || 0);
    setSelectedDirective(savedDraft.primaryDirectiveId || (round?.charterRules[0]?.id ?? ''));
    setWorkDescription(savedDraft.workDescription || '');
    setDeliverablesText(savedDraft.deliverablesText || '');
    setAttested(savedDraft.attested ?? false);
    setFeedbackNotice('LOCAL PROPOSAL DRAFT RESTORED INTO FORM FIELDS.');
    setTimeout(() => setFeedbackNotice(null), 3500);
  };

  const handleClearDraft = () => {
    adapter.clearProposalDraft(roundId);
    setSavedDraft(null);
    setFeedbackNotice('LOCAL PROPOSAL DRAFT DISCARDED.');
    setTimeout(() => setFeedbackNotice(null), 3500);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-20 font-mono text-xs text-[#888884] bg-[#131313]">
        RETRIEVING ROUND TELEMETRY ON CHAIN 61997...
      </div>
    );
  }

  if (!round) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 space-y-4 bg-[#131313] text-center">
        <div className="font-mono text-sm text-[#ff3344] uppercase font-bold">
          [ERROR 404] ROUND NOT FOUND
        </div>
        <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
          No active round matched the identifier &ldquo;{roundId}&rdquo;.
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

  const maxCap = round.capPerProposalGen;
  const availableTreasury = round.availableGen;
  const pendingEscrow = round.reservedGen;

  // Realtime address validation
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  const isRecipientValid = ethAddressRegex.test(recipientAddress.trim());
  const nominatorAddress = account || '';
  const isDistinctFromNominator =
    !account || recipientAddress.trim().toLowerCase() !== nominatorAddress.toLowerCase();

  // Allocation validation: requested amount <= both round cap and available treasury
  const isAmountValid =
    Number.isFinite(requestedAmount) &&
    requestedAmount > 0 &&
    requestedAmount <= maxCap &&
    requestedAmount <= availableTreasury;

  // Selected rule validation: must belong to this round
  const isDirectiveValid = Boolean(
    selectedDirective && round.charterRules.some((r) => r.id === selectedDirective)
  );

  // Member role validation
  const isMember = Boolean(
    account &&
      round.committeeMembers.some(
        (m) => m.address.toLowerCase() === account.toLowerCase()
      )
  );

  // Text validation
  const isDescriptionValid = workDescription.trim().length >= 40;
  const isDeliverablesValid = deliverablesText.trim().length >= 20;

  const canSubmit =
    isRecipientValid &&
    isDistinctFromNominator &&
    isAmountValid &&
    isDirectiveValid &&
    isDescriptionValid &&
    isDeliverablesValid &&
    attested &&
    (!isConnected || isMember);

  const handleSaveDraft = () => {
    const draft: ProposalDraft = {
      roundId,
      recipientAddress,
      requestedGen: requestedAmount,
      primaryDirectiveId: selectedDirective,
      workDescription,
      deliverablesText,
      attested,
      savedAt: new Date().toISOString(),
    };
    adapter.saveProposalDraft(draft);
    setSavedDraft(draft);
    setFeedbackNotice('LOCAL PROPOSAL DRAFT STORED SAFELY IN BROWSER STORAGE. NOT SUBMITTED ON-CHAIN.');
    setTimeout(() => setFeedbackNotice(null), 3500);
  };

  const handleInitiateNomination = async () => {
    if (isDesignPreview) {
      setShowConfirmModal(true);
      return;
    }
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    if (!chainId || chainId !== 61997) {
      setTxError('Wallet network unverified. Connect an EIP-1193 wallet on GenLayer Studio Next (Chain ID 61997).');
      return;
    }
    if (!round) {
      setTxError('Round telemetry not available.');
      return;
    }

    setIsPreparingTx(true);
    setTxError(null);
    try {
      const requestedAmountWei = parseGenToWei(String(requestedAmount), {
        context: 'Requested Amount',
      });

      const prepared = await prepareActionTransaction({
        action: 'nominate_proposal',
        provider: (window as any).ethereum,
        account,
        chainId,
        adapter,
        roundId: round.id,
        nominateProposalArgs: {
          round_id: round.id,
          recipient: recipientAddress.trim(),
          title: workDescription.slice(0, 60).trim() || 'Community Grant Proposal',
          requested_amount_wei: requestedAmountWei,
          deliverables_text: deliverablesText.trim(),
        },
      });

      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare nomination transaction');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleLockMax = () => {
    setRequestedAmount(Math.min(maxCap, availableTreasury));
  };

  return (
    <div className="flex flex-col w-full bg-[#131313] min-h-screen">
      {/* Design Preview Ribbon */}
      {isDesignPreview && (
        <section className="w-full bg-[#ff5719]/10 border-b border-[#ff5719]/40 px-4 lg:px-10 py-2 font-mono text-xs text-[#ff5719] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold">[DESIGN PREVIEW // PREVIEW RECORD]</span>
            <span className="text-[#c8c6c2]">
              Viewing preview mode round fixtures. Drafts saved here remain local.
            </span>
          </div>
          <span className="text-[10px] text-[#888884] uppercase">NON-AUTHORITATIVE</span>
        </section>
      )}

      {/* Top Banner Ribbon */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between font-mono text-xs">
          <div className="flex items-center gap-2 text-[#888884]">
            <Link to="/rounds" className="hover:text-[#ff5719]">
              ROUNDS
            </Link>
            <span className="text-[#383838]">/</span>
            <Link to={`/rounds/${round.id}`} className="hover:text-[#ff5719]">
              {round.id.toUpperCase()}
            </Link>
            <span className="text-[#383838]">/</span>
            <span className="text-[#ff5719] font-bold">NOMINATE PROPOSAL</span>
          </div>
          <div className="text-[#888884] hidden sm:block">
            STATUS: <span className="text-[#ff5719] font-bold">LOCAL DRAFT</span> (UNCOMMITTED)
          </div>
        </div>
      </section>

      {/* Draft Recovery Banner */}
      {savedDraft && (
        <section className="w-full bg-[#1c1b1b] border-b border-[#ff5719] px-4 lg:px-10 py-2.5 font-mono text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[#ff5719]">
            <span className="font-bold">[LOCAL DRAFT DETECTED]</span>
            <span className="text-[#c8c6c2]">
              Found saved local proposal draft for Round #{round.id.toUpperCase()} in browser storage.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="px-3 py-1 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
            >
              RESTORE LOCAL DRAFT
            </button>
            <button
              type="button"
              onClick={handleClearDraft}
              className="px-3 py-1 bg-[#201f1f] text-[#888884] hover:text-white uppercase transition-colors"
            >
              DISCARD
            </button>
          </div>
        </section>
      )}

      {/* Main Title Header */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs text-[#888884] pb-1">
              <span className="text-[#ff5719] font-bold">FORM: PRP-NOM-61997</span>
              <span>[SUBMISSION PIPELINE]</span>
            </div>
            <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl uppercase text-[#e5e2e1] font-bold">
              Nominate Proposal for Grant Allocation
            </h1>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] mt-1">
              Submit a proposal for grant consideration under Round #{round.id.toUpperCase()} ({round.title}).
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="px-4 py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] hover:bg-[#2a2a2a] uppercase transition-colors"
            >
              SAVE LOCAL DRAFT
            </button>
          </div>
        </div>
      </section>

      {feedbackNotice && (
        <div className="max-w-7xl mx-auto w-full px-4 lg:px-10 mt-4">
          <div className="p-3 bg-[#201f1f] border border-[#ff5719] text-[#ff5719] font-mono text-xs">
            {feedbackNotice}
          </div>
        </div>
      )}

      {/* Member Warning Banner if connected and not member */}
      {isConnected && !isMember && (
        <div className="max-w-7xl mx-auto w-full px-4 lg:px-10 mt-4">
          <div className="p-3 bg-[#ff3344]/15 border border-[#ff3344] text-[#ff3344] font-mono text-xs space-y-1">
            <span className="font-bold block uppercase">[NOTICE: NOT REGISTERED COMMITTEE MEMBER]</span>
            <p>
              Your connected wallet ({account?.slice(0, 6)}...{account?.slice(-4)}) is not listed in the committee roster for Round #{round.id.toUpperCase()}. You may save local drafts, but on-chain nomination requires committee membership.
            </p>
          </div>
        </div>
      )}

      {/* Main Form Split: 8 cols Form / 4 cols Telemetry */}
      <section className="w-full px-4 lg:px-10 py-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Form Left Column (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Step Indicators */}
            <div className="grid grid-cols-3 gap-px bg-[#262626] border border-[#262626] font-mono text-xs">
              <div
                onClick={() => setWizardStep(1)}
                className={`p-3 cursor-pointer transition-colors ${
                  wizardStep === 1
                    ? 'bg-[#1c1b1b] text-[#ff5719] font-bold border-b-2 border-[#ff5719]'
                    : 'bg-[#141414] text-[#888884] hover:bg-[#1a1a1a]'
                }`}
              >
                01. RECIPIENT & ALLOCATION
              </div>
              <div
                onClick={() => setWizardStep(2)}
                className={`p-3 cursor-pointer transition-colors ${
                  wizardStep === 2
                    ? 'bg-[#1c1b1b] text-[#ff5719] font-bold border-b-2 border-[#ff5719]'
                    : 'bg-[#141414] text-[#888884] hover:bg-[#1a1a1a]'
                }`}
              >
                02. SCOPE & DIRECTIVE
              </div>
              <div
                onClick={() => setWizardStep(3)}
                className={`p-3 cursor-pointer transition-colors ${
                  wizardStep === 3
                    ? 'bg-[#1c1b1b] text-[#ff5719] font-bold border-b-2 border-[#ff5719]'
                    : 'bg-[#141414] text-[#888884] hover:bg-[#1a1a1a]'
                }`}
              >
                03. ATTESTATION & REVIEW
              </div>
            </div>

            {/* STEP 1: Recipient & Allocation */}
            {wizardStep === 1 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                    Beneficiary Wallet & Grant Sizing
                  </h2>
                  <span className="font-mono text-xs text-[#888884]">STAGE 01</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      TARGET RECIPIENT EVM ADDRESS *
                    </label>
                    <input
                      type="text"
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                      placeholder="0x..."
                      className={`w-full bg-[#0e0e0e] border p-3 font-mono text-xs text-[#e5e2e1] focus:outline-none ${
                        recipientAddress && !isRecipientValid
                          ? 'border-[#ff3344]'
                          : 'border-[#2a2a2a] focus:border-[#ff5719]'
                      }`}
                    />
                    <div className="flex justify-between items-center font-mono text-[10px] text-[#888884] mt-1">
                      <span>Address that will withdraw test GEN upon proposal approval and credit authorization.</span>
                      {recipientAddress && !isRecipientValid && (
                        <span className="text-[#ff3344] font-bold">Invalid EVM address format</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      <label>REQUESTED ALLOCATION (TEST GEN) *</label>
                      <button
                        type="button"
                        onClick={handleLockMax}
                        className="text-[#ff5719] hover:underline"
                      >
                        SET MAX ({Math.min(maxCap, availableTreasury).toLocaleString()} GEN)
                      </button>
                    </div>
                    <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a]">
                      <input
                        type="number"
                        value={requestedAmount || ''}
                        onChange={(e) => setRequestedAmount(Number(e.target.value))}
                        min="1"
                        max={Math.min(maxCap, availableTreasury)}
                        placeholder="0"
                        className="w-full bg-transparent p-3 text-lg font-mono font-bold text-[#e5e2e1] focus:outline-none"
                      />
                      <span className="px-3 font-mono text-xs text-[#ff5719] font-bold">TEST GEN</span>
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-[#888884] mt-1">
                      <span>Per-Proposal Cap: {maxCap.toLocaleString()} GEN</span>
                      <span>Available Treasury: {availableTreasury.toLocaleString()} GEN</span>
                    </div>
                    {requestedAmount > 0 && !isAmountValid && (
                      <div className="mt-1 font-mono text-xs text-[#ff3344]">
                        {requestedAmount > maxCap
                          ? `Exceeds per-proposal round cap of ${maxCap.toLocaleString()} GEN`
                          : `Exceeds available round treasury of ${availableTreasury.toLocaleString()} GEN`}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    CONTINUE TO SCOPE & DIRECTIVE ↗
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Scope & Directive */}
            {wizardStep === 2 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                    Scope of Work & Charter Directive
                  </h2>
                  <span className="font-mono text-xs text-[#888884]">STAGE 02</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      ROUND CHARTER DIRECTIVE CLAUSE *
                    </label>
                    <select
                      value={selectedDirective}
                      onChange={(e) => setSelectedDirective(e.target.value)}
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 font-mono text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    >
                      {round.charterRules.map((r) => (
                        <option key={r.id} value={r.id}>
                          [{r.code || r.id.toUpperCase()}] {r.title}
                        </option>
                      ))}
                    </select>
                    {!isDirectiveValid && (
                      <span className="font-mono text-xs text-[#ff3344] mt-1 block">
                        Selected directive must belong to this round&apos;s charter rules.
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      TECHNICAL WORK SPECIFICATION *
                    </label>
                    <textarea
                      rows={5}
                      value={workDescription}
                      onChange={(e) => setWorkDescription(e.target.value)}
                      placeholder="Describe the architectural objectives, execution methodology, and components to be built..."
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 font-mono text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                    <div className="flex justify-between font-mono text-[10px] text-[#888884] mt-1">
                      <span>Evaluated by AI consensus against frozen charter clauses.</span>
                      <span>{workDescription.length} chars (min 40)</span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      VERIFIABLE DELIVERABLE CRITERIA *
                    </label>
                    <textarea
                      rows={4}
                      value={deliverablesText}
                      onChange={(e) => setDeliverablesText(e.target.value)}
                      placeholder="- Deliverable 01: Public repository link...\n- Deliverable 02: Test suite coverage...\n- Deliverable 03: Documentation..."
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 font-mono text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                    <div className="flex justify-between font-mono text-[10px] text-[#888884] mt-1">
                      <span>Specific objective artifacts proposed for this grant allocation.</span>
                      <span>{deliverablesText.length} chars (min 20)</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase hover:text-white"
                  >
                    ← BACK
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    CONTINUE TO ATTESTATION ↗
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Attestation & Review */}
            {wizardStep === 3 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                    Nominator Attestation & Summary
                  </h2>
                  <span className="font-mono text-xs text-[#888884]">STAGE 03</span>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-2">
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={attested}
                        onChange={(e) => setAttested(e.target.checked)}
                        className="mt-1 accent-[#ff5719]"
                      />
                      <div className="font-mono text-xs text-[#c8c6c2]">
                        <span className="text-[#e5e2e1] font-bold uppercase block mb-1">
                          CHARTER NON-VIOLATION ATTESTATION *
                        </span>
                        I attest that this proposal strictly satisfies the specified charter directive and contains zero activities prohibited by the round exclusion audit clauses.
                      </div>
                    </label>
                  </div>

                  <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1 font-mono text-xs">
                    <div className="flex justify-between text-[#888884]">
                      <span>DATA STATUS:</span>
                      <span className="text-[#ff5719] font-bold">LOCAL DRAFT (UNCOMMITTED)</span>
                    </div>
                    <div className="flex justify-between text-[#888884]">
                      <span>RECIPIENT:</span>
                      <span className="text-[#e5e2e1]">{recipientAddress || 'NOT SET'}</span>
                    </div>
                    <div className="flex justify-between text-[#888884]">
                      <span>REQUESTED:</span>
                      <span className="text-[#e5e2e1]">{requestedAmount.toLocaleString()} TEST GEN</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase hover:text-white"
                  >
                    ← BACK
                  </button>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      className="px-4 py-2.5 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] hover:bg-[#2a2a2a] font-mono text-xs uppercase"
                    >
                      SAVE LOCAL DRAFT
                    </button>
                    <button
                      type="button"
                      disabled={!canSubmit || isPreparingTx}
                      onClick={handleInitiateNomination}
                      className={`px-6 py-2.5 font-mono text-xs uppercase font-bold transition-colors ${
                        canSubmit && !isPreparingTx
                          ? 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black cursor-pointer'
                          : 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'
                      }`}
                    >
                      {isPreparingTx
                        ? 'PREPARING...'
                        : isDesignPreview
                        ? 'REVIEW LOCAL DRAFT ↗'
                        : 'SUBMIT NOMINATION ON-CHAIN ↗'}
                    </button>
                  </div>
                  {txError && (
                    <div className="p-2 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[10px] text-center">
                      {txError}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Telemetry & Treasury Impact (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-4 font-mono text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
                <span className="text-[#ff5719] font-bold uppercase">TREASURY STATE PROJECTION</span>
                <span className="text-[#888884]">CHAIN 61997</span>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                  <div className="flex justify-between text-[#888884] text-[10px]">
                    <span>CURRENT AVAILABLE TREASURY</span>
                    <span>100%</span>
                  </div>
                  <div className="font-['Space_Grotesk'] text-lg font-bold text-[#e5e2e1] mt-1">
                    {availableTreasury.toLocaleString()} GEN
                  </div>
                </div>

                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                  <div className="flex justify-between text-[#888884] text-[10px]">
                    <span>PROPOSED ALLOCATION</span>
                    <span className="text-[#ff5719]">
                      {availableTreasury > 0
                        ? Math.round((requestedAmount / availableTreasury) * 100)
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="font-['Space_Grotesk'] text-lg font-bold text-[#ff5719] mt-1">
                    {requestedAmount.toLocaleString()} GEN
                  </div>
                  <div className="text-[10px] text-[#888884]">
                    Per-Proposal Cap: {maxCap.toLocaleString()} GEN
                  </div>
                </div>

                <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                  <div className="flex justify-between text-[#888884] text-[10px]">
                    <span>RESERVED GRANT POOL</span>
                    <span>CURRENT</span>
                  </div>
                  <div className="font-['Space_Grotesk'] text-lg font-bold text-[#e5e2e1] mt-1">
                    {pendingEscrow.toLocaleString()} GEN
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
              <span className="text-[#ff5719] font-bold uppercase">
                CONFIRM LOCAL PROPOSAL DRAFT
              </span>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-[#888884] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-[#0e0e0e] border border-[#ff5719]/40 text-[#c8c6c2] space-y-1 text-[11px]">
              <span className="text-[#ff5719] font-bold uppercase block">
                LOCAL DRAFT NOTICE:
              </span>
              <p>
                This action stores a local proposal draft in browser storage. Because contracts are not yet deployed on Chain 61997, no on-chain transaction is broadcast and no funds are deducted.
              </p>
            </div>

            <div className="space-y-2 bg-[#0e0e0e] p-3 border border-[#2a2a2a]">
              <div className="flex justify-between text-[#888884]">
                <span>TARGET RECIPIENT:</span>
                <span className="text-[#e5e2e1]">
                  {recipientAddress.slice(0, 8)}...{recipientAddress.slice(-6)}
                </span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>REQUESTED ALLOCATION:</span>
                <span className="text-[#ff5719] font-bold">
                  {requestedAmount.toLocaleString()} test GEN
                </span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>STATUS TRANSITION:</span>
                <span className="text-[#00e599] font-bold">LOCAL DRAFT (UNCOMMITTED)</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-[#2a2a2a]">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-[#201f1f] text-[#c8c6c2] hover:text-white uppercase"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveDraft();
                  setShowConfirmModal(false);
                  navigate(`/rounds/${round.id}`);
                }}
                className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
              >
                CONFIRM & STORE LOCAL DRAFT ↗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Review & Tracking Modal */}
      <TransactionModal
        isOpen={showTxModal}
        onClose={() => setShowTxModal(false)}
        prepared={preparedTx}
        provider={(window as any).ethereum}
        account={account || ''}
        adapter={adapter}
        onSuccess={() => {
          refreshData();
          navigate(`/rounds/${round.id}`);
        }}
      />
    </div>
  );
};
