import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Barcode } from '../components/Barcode';
import { useData, parseGenToWei } from '../services/dataAccess';
import { useWallet } from '../context/WalletContext';
import {
  prepareActionTransaction,
  type PreparedTransaction,
} from '../services/transactionService';
import { TransactionModal } from '../components/TransactionModal';
import { canCreateRound } from '../services/permissions';
import type { RoundDraft } from '../types';


export const CreateRoundPage: React.FC = () => {
  const navigate = useNavigate();
  const { adapter, isDesignPreview } = useData();

  // Wizard Step (1 - 4)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form Fields
  const [title, setTitle] = useState('GenLayer Zero-Knowledge Prover Sprint');
  const [summary, setSummary] = useState(
    'Dedicated community capital round incentivizing optimized ZK-Prover nodes, validator performance tooling, and deterministic verification runtimes on GenLayer Studio Next.'
  );
  const [capPerProposal, setCapPerProposal] = useState<number>(5000);
  const [durationDays, setDurationDays] = useState<number>(14);

  // Step 2: Charter & Scope
  const [permittedDirectives, setPermittedDirectives] = useState<string[]>([
    'Compiler debuggers & memory profilers',
    'Python testing frameworks & mocking harnesses',
    'CLI tooling & developer documentation generators',
  ]);
  const [newDirective, setNewDirective] = useState('');

  const [exclusions, setExclusions] = useState<string[]>([
    'No speculative token marketing, liquidity bot promotions, or centralized influencers',
    'No closed-source or custodial proprietary software',
  ]);
  const [newExclusion, setNewExclusion] = useState('');

  // Step 3: Roster & Quorum
  const [rosterInput, setRosterInput] = useState(
    `0x71C5928A3F81C9B20E176D63A5D3B0F6E9C04F9B,
0x3a04c18f9e0a81e2894172409bb10e30129a81e2,
0x88f01b2a904d09bc29817764831f0a88094d09bc,
0x491c6e11891912c8192a83f1245089e14a1912c8,
0xfe21094419aa441909a81e2894172409bb104419,
0x21ba681920aa990f1245089e14a199920199990f,
0xa41e5507976807c295be14f47d966988d10796c2,
0xb05fd68093641032870101e4f4b232d48041ea57,
0xc98086180555009f022739e802533036e56801f4,
0xd140f09a81e2894172409bb10e30129a81e20011,
0xe507a1fe239f1b70b746b3010880a6c70a039161c,
0xf92b4419aa441909a81e2894172409bb10441902a`
  );
  const [votingDays, setVotingDays] = useState<number>(5);

  // Step 4: Escrow & Deposit
  const [initialDeposit, setInitialDeposit] = useState<number>(50000);
  const [ratified, setRatified] = useState<boolean>(false);

  // Preview Modal & Wallet Transaction State
  const { account, chainId, isConnected, connectWallet, provider, isCorrectNetwork, balanceGen } = useWallet();
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [showTxModal, setShowTxModal] = useState<boolean>(false);
  const [isPreparingTx, setIsPreparingTx] = useState<boolean>(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Address Parsing & Validation
  const parsedAddresses = rosterInput
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  const validAddresses = parsedAddresses.filter((addr) => ethAddressRegex.test(addr));
  const invalidAddresses = parsedAddresses.filter((addr) => !ethAddressRegex.test(addr));

  // Case-insensitive address deduplication check
  const normalizedAddresses = validAddresses.map((a) => a.toLowerCase());
  const hasDuplicateAddresses = new Set(normalizedAddresses).size !== normalizedAddresses.length;
  const hasZeroAddress = normalizedAddresses.includes('0x0000000000000000000000000000000000000000');

  // Committee count and required votes (Fixed 2/3 Supermajority: exact integer ceiling formula)
  const totalCommittee = validAddresses.length;
  const requiredVotes = totalCommittee > 0 ? Math.floor((totalCommittee * 2 + 2) / 3) : 0;

  // Validation rules
  const isTitleValid = title.trim().length >= 3;
  const isSummaryValid = summary.trim().length >= 10;
  const isCapValid = Number.isFinite(capPerProposal) && capPerProposal > 0;
  const isDepositValid = Number.isFinite(initialDeposit) && initialDeposit > 0 && initialDeposit >= capPerProposal;
  const isDurationValid = Number.isFinite(durationDays) && durationDays >= 1 && durationDays <= 365;
  const isVotingDaysValid = Number.isFinite(votingDays) && votingDays >= 1 && votingDays <= durationDays;
  const isDirectivesValid = permittedDirectives.length >= 1;
  const isRosterValid = totalCommittee >= 2 && invalidAddresses.length === 0 && !hasDuplicateAddresses && !hasZeroAddress;

  const canPreview =
    isTitleValid &&
    isSummaryValid &&
    isCapValid &&
    isDepositValid &&
    isDurationValid &&
    isVotingDaysValid &&
    isDirectivesValid &&
    isRosterValid &&
    ratified;

  // Draft recovery banner state
  const [savedDraft, setSavedDraft] = useState<RoundDraft | null>(() => adapter.getRoundDraft());

  const handleRestoreDraft = () => {
    if (!savedDraft) return;
    setTitle(savedDraft.title || title);
    setSummary(savedDraft.summary || summary);
    setCapPerProposal(savedDraft.capPerProposalGen || capPerProposal);
    setDurationDays(savedDraft.durationDays || durationDays);
    setVotingDays(savedDraft.votingWindowDays || votingDays);
    setInitialDeposit(savedDraft.initialDepositGen || initialDeposit);
    if (savedDraft.charterRules?.length) {
      setPermittedDirectives(savedDraft.charterRules.map((r) => r.title));
    }
    if (savedDraft.charterExclusions?.length) {
      setExclusions(savedDraft.charterExclusions.map((e) => e.title));
    }
    if (savedDraft.committeeAddresses?.length) {
      setRosterInput(savedDraft.committeeAddresses.join(',\n'));
    }
    setFeedbackNotice('LOCAL DRAFT RESTORED INTO FORM FIELDS.');
    setTimeout(() => setFeedbackNotice(null), 3500);
  };

  const handleClearDraft = () => {
    adapter.clearRoundDraft();
    setSavedDraft(null);
    setFeedbackNotice('LOCAL DRAFT REMOVED FROM BROWSER STORAGE.');
    setTimeout(() => setFeedbackNotice(null), 3500);
  };

  const handleSaveDraft = () => {
    const draft: RoundDraft = {
      title,
      summary,
      capPerProposalGen: capPerProposal,
      durationDays,
      charterRules: permittedDirectives.map((d) => ({ title: d, description: d })),
      charterExclusions: exclusions.map((e) => ({ title: e, severity: 'EXCLUSION' })),
      committeeAddresses: validAddresses,
      consensusThresholdPercent: 66.67,
      votingWindowDays: votingDays,
      initialDepositGen: initialDeposit,
      savedAt: new Date().toISOString(),
    };
    adapter.saveRoundDraft(draft);
    setSavedDraft(draft);
    setFeedbackNotice('LOCAL DRAFT STORED IN BROWSER STORAGE. NOT SUBMITTED ON-CHAIN.');
    setTimeout(() => setFeedbackNotice(null), 3500);
  };

  const handleInitiateDeploy = async () => {
    if (isDesignPreview) {
      setShowPreviewModal(true);
      return;
    }
    if (!isConnected || !account) {
      await connectWallet();
      return;
    }
    setIsPreparingTx(true);
    setTxError(null);
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

    try {
      const grantCapWei = parseGenToWei(String(capPerProposal), {
        context: 'Grant Cap',
      });
      const initialDepositWei = parseGenToWei(String(initialDeposit), {
        minWei: 1000000000000000000n,
        context: 'Initial Deposit',
      });

      const cleanSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 16);
      const roundSlug = `round-${cleanSlug || 'genesis'}-${Date.now().toString(36)}`;
      const fullCharter = [
        `CHARTER DIRECTIVES FOR: ${title}`,
        `SUMMARY: ${summary}`,
        `PERMITTED SCOPE:`,
        ...permittedDirectives.map((d, i) => `${i + 1}. ${d}`),
        `STRICT EXCLUSIONS:`,
        ...exclusions.map((e, i) => `EXCL-${i + 1}: ${e}`),
      ].join('\n\n');

      const now = Math.floor(Date.now() / 1000);
      const nominationCutoff = now + Math.max(86400, Math.floor((durationDays * 86400) / 2));
      const votingDuration = Math.max(3600, Math.min(1209600, votingDays * 86400));
      const roundEnd = nominationCutoff + 86400 + votingDuration + 7200;

      const prepared = await prepareActionTransaction({
        action: 'create_round',
        provider,
        account,
        chainId,
        adapter,
        createRoundArgs: {
          round_id: roundSlug,
          title: title.trim(),
          description: summary.trim(),
          charter_text: fullCharter,
          committee_roster: validAddresses,
          grant_cap_wei: grantCapWei,
          nomination_cutoff: nominationCutoff,
          voting_duration: votingDuration,
          round_end: roundEnd,
          initial_deposit_wei: initialDepositWei,
        },
      });

      setPreparedTx(prepared);
      setShowTxModal(true);
    } catch (err: any) {
      setTxError(err?.message || 'Failed to prepare round deployment');
    } finally {
      setIsPreparingTx(false);
    }
  };

  const handleAddDirective = (e: React.FormEvent) => {
    e.preventDefault();
    if (newDirective.trim()) {
      setPermittedDirectives([...permittedDirectives, newDirective.trim()]);
      setNewDirective('');
    }
  };

  const handleRemoveDirective = (index: number) => {
    setPermittedDirectives(permittedDirectives.filter((_, i) => i !== index));
  };

  const handleAddExclusion = (e: React.FormEvent) => {
    e.preventDefault();
    if (newExclusion.trim()) {
      setExclusions([...exclusions, newExclusion.trim()]);
      setNewExclusion('');
    }
  };

  const handleRemoveExclusion = (index: number) => {
    setExclusions(exclusions.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col w-full bg-[#131313] min-h-screen">
      {/* Top Banner */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between font-mono text-xs">
          <div className="flex items-center gap-2">
            <Link to="/rounds" className="text-[#888884] hover:text-[#ff5719]">
              ROUNDS
            </Link>
            <span className="text-[#383838]">/</span>
            <span className="text-[#ff5719] font-bold">GENESIS WIZARD</span>
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
              Found saved local draft &ldquo;{savedDraft.title || 'Untitled Round'}&rdquo; in browser storage.
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

      {/* Title Header */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs text-[#888884] pb-1">
              <span className="text-[#ff5719] font-bold">FORM: CF-CRT-61997</span>
              <span>[NON-REVERSIBLE COMPILE STATE]</span>
            </div>
            <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl uppercase text-[#e5e2e1] font-bold">
              Create & Fund Grant Round
            </h1>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] mt-1">
              Deploy an immutable GenLayer intelligent treasury governed by a frozen charter. Rules cannot be modified post-deployment.
            </p>
          </div>
          {feedbackNotice && (
            <div className="p-2.5 bg-[#201f1f] border border-[#ff5719] text-[#ff5719] font-mono text-xs animate-pulse">
              {feedbackNotice}
            </div>
          )}
        </div>
      </section>

      {/* 4-Step Interactive Navigation Deck */}
      <section className="w-full px-4 lg:px-10 py-4 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className={`p-3 text-left border transition-colors ${
              currentStep === 1
                ? 'bg-[#2a2a2a] border-[#ff5719] text-[#ff5719]'
                : 'bg-[#1c1b1b] border-[#262626] text-[#888884] hover:text-[#e5e2e1]'
            }`}
          >
            <div className="flex justify-between items-center text-[10px]">
              <span className="font-bold">STEP 01</span>
              <span>{isTitleValid && isSummaryValid && isCapValid ? '✓' : '[1/4]'}</span>
            </div>
            <div className="font-['Space_Grotesk'] text-sm font-bold uppercase text-[#e5e2e1] mt-1">
              Parameters
            </div>
            <div className="text-[10px] text-[#888884]">Caps & Round Scope</div>
          </button>

          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            className={`p-3 text-left border transition-colors ${
              currentStep === 2
                ? 'bg-[#2a2a2a] border-[#ff5719] text-[#ff5719]'
                : 'bg-[#1c1b1b] border-[#262626] text-[#888884] hover:text-[#e5e2e1]'
            }`}
          >
            <div className="flex justify-between items-center text-[10px]">
              <span className="font-bold">STEP 02</span>
              <span>{isDirectivesValid ? '✓' : '[2/4]'}</span>
            </div>
            <div className="font-['Space_Grotesk'] text-sm font-bold uppercase text-[#e5e2e1] mt-1">
              Charter & Scope
            </div>
            <div className="text-[10px] text-[#888884]">Permitted Clauses & Bans</div>
          </button>

          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            className={`p-3 text-left border transition-colors ${
              currentStep === 3
                ? 'bg-[#2a2a2a] border-[#ff5719] text-[#ff5719]'
                : 'bg-[#1c1b1b] border-[#262626] text-[#888884] hover:text-[#e5e2e1]'
            }`}
          >
            <div className="flex justify-between items-center text-[10px]">
              <span className="font-bold">STEP 03</span>
              <span>{isRosterValid ? '✓' : '[3/4]'}</span>
            </div>
            <div className="font-['Space_Grotesk'] text-sm font-bold uppercase text-[#e5e2e1] mt-1">
              Roster & Quorum
            </div>
            <div className="text-[10px] text-[#888884]">Whitelists & Thresholds</div>
          </button>

          <button
            type="button"
            onClick={() => setCurrentStep(4)}
            className={`p-3 text-left border transition-colors ${
              currentStep === 4
                ? 'bg-[#2a2a2a] border-[#ff5719] text-[#ff5719]'
                : 'bg-[#1c1b1b] border-[#262626] text-[#888884] hover:text-[#e5e2e1]'
            }`}
          >
            <div className="flex justify-between items-center text-[10px]">
              <span className="font-bold">STEP 04</span>
              <span>{isDepositValid && ratified ? '✓' : '[4/4]'}</span>
            </div>
            <div className="font-['Space_Grotesk'] text-sm font-bold uppercase text-[#e5e2e1] mt-1">
              Treasury Escrow
            </div>
            <div className="text-[10px] text-[#888884]">Deposit & Seal</div>
          </button>
        </div>
      </section>

      {/* Main Form + Sidebar */}
      <section className="w-full px-4 lg:px-10 py-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Form Area */}
          <div className="lg:col-span-8 space-y-6">
            {/* STEP 1: PARAMETERS */}
            {currentStep === 1 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-[#ff5719] text-[#521300] font-mono text-xs font-bold">
                      SEC 01
                    </span>
                    <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      Basic Parameters
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-[#888884]">CF-PARAM-REG</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      ROUND TITLE / IDENTIFIER *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. GenLayer Zero-Knowledge Prover Sprint"
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                    <p className="font-mono text-[10px] text-[#888884] mt-1">
                      Must be globally descriptive; serialized directly to the contract bytecode.
                    </p>
                  </div>

                  <div>
                    <div className="flex justify-between items-center font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      <label>EXECUTIVE PURPOSE SUMMARY *</label>
                      <span className="text-[#888884] text-[10px]">
                        {summary.length} CHARS
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Concise summary of round objectives..."
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 text-sm text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                        MAX RECIPIENT CAP (TEST GEN) *
                      </label>
                      <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a]">
                        <input
                          type="number"
                          value={capPerProposal}
                          onChange={(e) => setCapPerProposal(Number(e.target.value))}
                          min={1}
                          className="w-full bg-transparent p-3 text-sm font-mono text-[#e5e2e1] focus:outline-none"
                        />
                        <span className="px-3 font-mono text-xs text-[#ff5719] font-bold">GEN</span>
                      </div>
                      <p className="font-mono text-[10px] text-[#888884] mt-1">
                        Max single disbursement limit per proposal.
                      </p>
                    </div>

                    <div>
                      <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                        SUBMISSION WINDOW (DAYS) *
                      </label>
                      <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a]">
                        <input
                          type="number"
                          value={durationDays}
                          onChange={(e) => setDurationDays(Number(e.target.value))}
                          min={1}
                          max={90}
                          className="w-full bg-transparent p-3 text-sm font-mono text-[#e5e2e1] focus:outline-none"
                        />
                        <span className="px-3 font-mono text-xs text-[#888884]">DAYS</span>
                      </div>
                      <p className="font-mono text-[10px] text-[#888884] mt-1">
                        Window automatically triggers evaluation block.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    CONTINUE TO CHARTER & SCOPE ↗
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: CHARTER & SCOPE */}
            {currentStep === 2 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-[#ff5719] text-[#521300] font-mono text-xs font-bold">
                      SEC 02
                    </span>
                    <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      Frozen Charter Clauses
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-[#888884]">CLAUSE_TREE_V1</span>
                </div>

                <div className="p-3 bg-[#201f1f] border border-[#ff5719]/30 text-xs font-mono text-[#c8c6c2] space-y-1">
                  <div className="text-[#ff5719] font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">verified</span>
                    NATURAL-LANGUAGE CONSENSUS WARNING
                  </div>
                  <p>
                    GenLayer validators evaluate each nominated proposal verbatim against these numbered clauses. Be precise; ambiguous phrases reduce execution certainty.
                  </p>
                </div>

                {/* Permitted Directives List */}
                <div className="space-y-3">
                  <label className="font-mono text-xs uppercase font-bold text-[#e5e2e1] block">
                    PERMITTED PURPOSE DIRECTIVES (ALLOW-LIST) *
                  </label>
                  <div className="space-y-2">
                    {permittedDirectives.map((directive, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-[#0e0e0e] border border-[#2a2a2a]"
                      >
                        <div className="flex items-center gap-3 font-mono text-xs">
                          <span className="text-[#ff5719] font-bold">
                            #{String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-[#e5e2e1]">{directive}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveDirective(index)}
                          className="text-[#888884] hover:text-[#ff3344] p-1"
                          title="Remove Directive"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleAddDirective} className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={newDirective}
                      onChange={(e) => setNewDirective(e.target.value)}
                      placeholder="Add permitted purpose directive..."
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-2.5 text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-4 bg-[#2a2a2a] text-[#e5e2e1] hover:bg-[#353534] font-mono text-xs uppercase font-bold whitespace-nowrap"
                    >
                      + ADD DIRECTIVE
                    </button>
                  </form>
                </div>

                {/* Mandatory Exclusions */}
                <div className="space-y-3 pt-4 border-t border-[#2a2a2a]">
                  <label className="font-mono text-xs uppercase font-bold text-[#ff3344] block">
                    MANDATORY EXCLUSIONS (ZERO-TOLERANCE RED FLAGS)
                  </label>
                  <div className="space-y-2">
                    {exclusions.map((exclusion, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-[#0e0e0e] border border-[#2a2a2a]"
                      >
                        <div className="flex items-center gap-3 font-mono text-xs">
                          <span className="text-[#ff3344] font-bold">
                            X-{String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-[#c8c6c2]">{exclusion}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveExclusion(index)}
                          className="text-[#888884] hover:text-[#ff3344] p-1"
                          title="Remove Exclusion"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleAddExclusion} className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={newExclusion}
                      onChange={(e) => setNewExclusion(e.target.value)}
                      placeholder="Add mandatory exclusion clause..."
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-2.5 text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-4 bg-[#2a2a2a] text-[#e5e2e1] hover:bg-[#353534] font-mono text-xs uppercase font-bold whitespace-nowrap"
                    >
                      + ADD EXCLUSION
                    </button>
                  </form>
                </div>

                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase hover:text-white"
                  >
                    ← BACK
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    CONTINUE TO ROSTER & QUORUM ↗
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ROSTER & QUORUM */}
            {currentStep === 3 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-[#ff5719] text-[#521300] font-mono text-xs font-bold">
                      SEC 03
                    </span>
                    <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      Governance & Member Roster
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-[#888884]">MULTISIG_VECTOR</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      <label>WHITELISTED COMMITTEE MEMBER WALLETS *</label>
                      <span className={invalidAddresses.length > 0 ? 'text-[#ff3344]' : 'text-[#00e599]'}>
                        {totalCommittee} PARSED ({invalidAddresses.length} INVALID)
                      </span>
                    </div>
                    <textarea
                      rows={6}
                      value={rosterInput}
                      onChange={(e) => setRosterInput(e.target.value)}
                      placeholder="Paste comma or newline separated 0x... EVM wallet addresses"
                      className="w-full bg-[#0e0e0e] border border-[#2a2a2a] p-3 font-mono text-xs text-[#e5e2e1] focus:border-[#ff5719] focus:outline-none"
                    />
                    <div className="flex justify-between items-center font-mono text-[10px] text-[#888884] mt-1">
                      <span>Comma or newline delimited format (EIP-55 compatible).</span>
                      {invalidAddresses.length > 0 && (
                        <span className="text-[#ff3344] font-bold">
                          Invalid address syntax detected in roster!
                        </span>
                      )}
                      {hasDuplicateAddresses && (
                        <span className="text-[#ff3344] font-bold">
                          Duplicate address detected (case-insensitive)!
                        </span>
                      )}
                    </div>
                    {hasDuplicateAddresses && (
                      <div className="mt-2 p-2.5 bg-[#ff3344]/15 border border-[#ff3344] text-[#ff3344] font-mono text-xs">
                        VALIDATION ERROR: Duplicate committee addresses detected after case-insensitive normalization. Each member address must be unique.
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-[#2a2a2a]">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center font-mono text-xs">
                        <span className="text-[#e5e2e1] uppercase font-bold">CONSENSUS THRESHOLD:</span>
                        <span className="text-[#ff5719] font-bold">
                          EXACT 2/3 ({requiredVotes} of {totalCommittee} VOTES)
                        </span>
                      </div>
                      <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] text-xs font-mono space-y-1">
                        <div className="flex justify-between text-[#e5e2e1]">
                          <span>FORMULA:</span>
                          <span className="text-[#ff5719]">ceil(N * 2 / 3) = (N * 2 + 2) // 3</span>
                        </div>
                        <div className="flex justify-between text-[#888884] text-[10px]">
                          <span>V1 PROTOCOL STANDARD:</span>
                          <span>FIXED CANONICAL 2/3</span>
                        </div>
                      </div>
                      <div className="flex justify-between font-mono text-[10px] text-[#888884]">
                        <span>RECIPIENT RECUSED IF ON ROSTER</span>
                        <span>MIN 2 MEMBERS REQUIRED</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="font-mono text-xs text-[#e5e2e1] uppercase font-bold block">
                        MEMBER VOTING WINDOW
                      </span>
                      <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                        {[3, 5, 7].map((days) => (
                          <button
                            key={days}
                            type="button"
                            onClick={() => setVotingDays(days)}
                            className={`p-2 uppercase font-bold transition-colors ${
                              votingDays === days
                                ? 'bg-[#ff5719] text-[#521300]'
                                : 'bg-[#201f1f] text-[#c8c6c2] hover:bg-[#2a2a2a]'
                            }`}
                          >
                            {days} DAYS
                          </button>
                        ))}
                      </div>
                      <p className="font-mono text-[10px] text-[#888884]">
                        Auto-tally occurs at target block height.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="px-5 py-2.5 bg-[#201f1f] text-[#c8c6c2] font-mono text-xs uppercase hover:text-white"
                  >
                    ← BACK
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(4)}
                    className="px-6 py-2.5 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
                  >
                    CONTINUE TO TREASURY ESCROW ↗
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: TREASURY ESCROW */}
            {currentStep === 4 && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-[#ff5719] text-[#521300] font-mono text-xs font-bold">
                      SEC 04
                    </span>
                    <h2 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      Treasury Deposit & Preview
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-[#888884]">GENESIS_CAPITAL</span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase font-bold text-[#e5e2e1] mb-1">
                      INITIAL ROUND CAPITAL ALLOCATION (TEST GEN) *
                    </label>
                    <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a]">
                      <input
                        type="number"
                        value={initialDeposit}
                        onChange={(e) => setInitialDeposit(Number(e.target.value))}
                        min={capPerProposal}
                        className="w-full bg-transparent p-3 text-lg font-mono font-bold text-[#e5e2e1] focus:outline-none"
                      />
                      <span className="px-3 font-mono text-xs text-[#ff5719] font-bold">TEST GEN</span>
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-[#888884] mt-1">
                      <span>Must be greater than or equal to per-proposal cap ({capPerProposal.toLocaleString()} GEN).</span>
                      <span>MAX GRANTS: ~{Math.floor(initialDeposit / (capPerProposal || 1))}</span>
                    </div>
                  </div>

                  {/* Ratification checkbox */}
                  <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-2">
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={ratified}
                        onChange={(e) => setRatified(e.target.checked)}
                        className="mt-1 accent-[#ff5719]"
                      />
                      <div className="font-mono text-xs text-[#c8c6c2]">
                        <span className="text-[#e5e2e1] font-bold uppercase block mb-1">
                          IMMUTABLE CONTRACT BINDING RATIFICATION *
                        </span>
                        I acknowledge that once deployed to GenLayer Studio Next (Chain ID 61997), the charter clauses, member roster, voting thresholds, and grant caps are permanently frozen into the contract state. No admin keys, proxy upgradability, or multisig overrides exist to alter the evaluation criteria.
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
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
                      disabled={!canPreview}
                      onClick={() => setShowPreviewModal(true)}
                      className={`px-6 py-2.5 font-mono text-xs uppercase font-bold transition-colors ${
                        canPreview
                          ? 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black cursor-pointer'
                          : 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'
                      }`}
                    >
                      SIMULATE GENESIS PREVIEW ↗
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Telemetry Preview */}
          <div className="lg:col-span-4 bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
            <div>
              <div className="flex items-center justify-between font-mono text-xs text-[#888884] pb-2 border-b border-[#2a2a2a]">
                <div className="flex items-center gap-1.5 text-[#ff5719] font-bold">
                  <span className="w-2 h-2 bg-[#ff5719]"></span>
                  <span>GENESIS TELEMETRY</span>
                </div>
                <span>LIVE PREVIEW</span>
              </div>
              <div className="pt-3">
                <Barcode width={140} height={20} color="#c8c6c2" />
              </div>
            </div>

            <div className="space-y-2 font-mono text-xs divide-y divide-[#222222]">
              <div className="flex justify-between py-1.5 text-[#888884]">
                <span>TARGET CHAIN:</span>
                <span className="text-[#e5e2e1] font-bold">GENLAYER #61997</span>
              </div>
              <div className="flex justify-between py-1.5 text-[#888884]">
                <span>TOTAL CLAUSES:</span>
                <span className="text-[#e5e2e1]">
                  {permittedDirectives.length} PERMITTED / {exclusions.length} BANNED
                </span>
              </div>
              <div className="flex justify-between py-1.5 text-[#888884]">
                <span>COMMITTEE SIZE:</span>
                <span className="text-[#e5e2e1]">{totalCommittee} MEMBERS</span>
              </div>
              <div className="flex justify-between py-1.5 text-[#888884]">
                <span>APPROVAL QUORUM:</span>
                <span className="text-[#ff5719] font-bold">
                  EXACT 2/3 ({requiredVotes}/{totalCommittee})
                </span>
              </div>
              <div className="text-[10px] text-[#888884] italic pb-1">
                * Preview baseline assumes no recusal. Recipient recusal reduces pool to N - 1.
              </div>
              <div className="flex justify-between py-1.5 text-[#888884]">
                <span>PROPOSAL CEILING:</span>
                <span className="text-[#e5e2e1] font-bold">{capPerProposal.toLocaleString()} GEN</span>
              </div>
              <div className="flex justify-between py-1.5 text-[#888884]">
                <span>TOTAL ESCROW DEPOSIT:</span>
                <span className="text-[#e5e2e1] font-bold">{initialDeposit.toLocaleString()} GEN</span>
              </div>
            </div>

            {/* Validation Checklist */}
            <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] font-mono text-xs space-y-1.5">
              <span className="text-[#ff5719] font-bold uppercase block text-[10px]">
                PRE-FLIGHT VALIDATION CHECKLIST:
              </span>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={isTitleValid && isSummaryValid ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {isTitleValid && isSummaryValid ? '✓' : '○'}
                </span>
                <span className={isTitleValid && isSummaryValid ? 'text-[#e5e2e1]' : 'text-[#888884]'}>
                  Round Title & Purpose Summary
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={isDirectivesValid ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {isDirectivesValid ? '✓' : '○'}
                </span>
                <span className={isDirectivesValid ? 'text-[#e5e2e1]' : 'text-[#888884]'}>
                  Charter Directives Specified ({permittedDirectives.length})
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={isRosterValid ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {isRosterValid ? '✓' : '○'}
                </span>
                <span className={isRosterValid ? 'text-[#e5e2e1]' : 'text-[#888884]'}>
                  Valid EIP-55 Roster Addresses ({validAddresses.length})
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={isDepositValid && ratified ? 'text-[#00e599]' : 'text-[#888884]'}>
                  {isDepositValid && ratified ? '✓' : '○'}
                </span>
                <span className={isDepositValid && ratified ? 'text-[#e5e2e1]' : 'text-[#888884]'}>
                  Escrow Deposit & Ratification Signed
                </span>
              </div>
            </div>

            {/* Save Draft / Preview Triggers */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleSaveDraft}
                className="w-full py-2.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] font-mono text-xs uppercase"
              >
                SAVE LOCAL DRAFT
              </button>
              <button
                type="button"
                disabled={!canPreview || isPreparingTx || (!isDesignPreview && !canCreateRound({ connected: isConnected, correctChain: isCorrectNetwork, balanceGen }).allowed)}
                onClick={handleInitiateDeploy}
                title={canCreateRound({ connected: isConnected, correctChain: isCorrectNetwork, balanceGen }).reason}
                className={`w-full py-3 font-mono text-xs uppercase font-bold tracking-wider flex items-center justify-center gap-2 transition-colors ${
                  canPreview && !isPreparingTx && (isDesignPreview || canCreateRound({ connected: isConnected, correctChain: isCorrectNetwork, balanceGen }).allowed)
                    ? 'bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black cursor-pointer'
                    : 'bg-[#2a2a2a] text-[#888884] cursor-not-allowed'
                }`}
              >
                <span>{isPreparingTx ? 'ESTIMATING & PREPARING...' : isDesignPreview ? 'SIMULATE GENESIS' : 'DEPLOY & FREEZE'}</span>
                <span>↗</span>
              </button>
              <p className="font-mono text-[10px] text-[#888884]">
                {canCreateRound({ connected: isConnected, correctChain: isCorrectNetwork, balanceGen }).reason}
              </p>
              {txError && (
                <div className="p-2 bg-[#ff3344]/10 border border-[#ff3344] text-[#ff3344] text-[10px] text-center">
                  {txError}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Genesis Simulation Modal Dialog */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-2xl w-full p-6 space-y-6 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
              <div className="flex items-center gap-2 text-[#ff5719] font-bold">
                <span className="material-symbols-outlined text-[18px]">lock</span>
                <span className="uppercase">GENESIS PREVIEW & RATIFICATION CONFIRMATION</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="text-[#888884] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-[#0e0e0e] border border-[#ff5719]/40 text-[#c8c6c2] space-y-1">
              <span className="text-[#ff5719] font-bold block uppercase">
                DESIGN PREVIEW NOTICE:
              </span>
              <p>
                A CharterFlowCore contract is deployed on GenLayer Studio Next, but this design-preview record is local fixture data and is not that contract&apos;s state. This action simulates genesis and stores a local draft only. No transaction will be broadcast on-chain.
              </p>
            </div>

            <div className="space-y-2 bg-[#0e0e0e] p-4 border border-[#2a2a2a] text-xs">
              <div className="flex justify-between text-[#888884]">
                <span>ROUND TITLE:</span>
                <span className="text-[#e5e2e1] font-bold">{title}</span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>CAP PER PROPOSAL:</span>
                <span className="text-[#e5e2e1]">{capPerProposal.toLocaleString()} GEN</span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>TOTAL ESCROW DEPOSIT:</span>
                <span className="text-[#e5e2e1] font-bold">{initialDeposit.toLocaleString()} GEN</span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>COMMITTEE QUORUM:</span>
                <span className="text-[#ff5719] font-bold">
                  EXACT 2/3 ({requiredVotes} of {totalCommittee})*
                </span>
              </div>
              <div className="text-[10px] text-[#888884] italic">
                * Baseline count assuming no recipient recusal.
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>PERMITTED CLAUSES:</span>
                <span className="text-[#e5e2e1]">{permittedDirectives.length} Directives</span>
              </div>
              <div className="flex justify-between text-[#888884]">
                <span>EXCLUSIONS:</span>
                <span className="text-[#ff3344]">{exclusions.length} Red Flags</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-[#2a2a2a]">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-2 bg-[#201f1f] text-[#c8c6c2] hover:text-white uppercase"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveDraft();
                  setShowPreviewModal(false);
                  navigate('/rounds');
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
        provider={provider}
        account={account || ''}
        adapter={adapter}
        onSuccess={(tx) => {
          if (tx.roundId) {
            navigate(`/rounds/${tx.roundId}`);
          } else {
            navigate('/rounds');
          }
        }}
      />
    </div>
  );
};
