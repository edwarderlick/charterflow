import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Barcode } from '../components/Barcode';

export const HowItWorksPage: React.FC = () => {
  // Interactive Scenario Traversal State
  const [requestAmount, setRequestAmount] = useState<number>(250);
  const [verdict, setVerdict] = useState<'ELIGIBLE' | 'AMBIGUOUS' | 'INELIGIBLE'>('ELIGIBLE');
  const [votingOutcome, setVotingOutcome] = useState<'PASSED' | 'FAILED'>('PASSED');

  const roundCap = 5000;
  const isCapExceeded = requestAmount > roundCap;

  let calculatedOutcomeState = 'PENDING';
  let treasuryImpact = '0.00 GEN';
  let beneficiaryAction = 'NO ACTION AVAILABLE';
  let settlementStatus = 'IN_PROCESS';

  if (isCapExceeded) {
    calculatedOutcomeState = 'REVERTED_CAP_EXCEEDED';
    treasuryImpact = '0.00 GEN (RESERVATION REJECTED)';
    beneficiaryAction = 'DISQUALIFIED (EXCEEDS CAP)';
    settlementStatus = 'MECHANICAL_REVERT';
  } else if (verdict === 'INELIGIBLE') {
    calculatedOutcomeState = 'INELIGIBLE';
    treasuryImpact = '+0.00 GEN (RELEASED TO POOL)';
    beneficiaryAction = 'REJECTED BY COMPILER';
    settlementStatus = 'RESERVATION_REVERTED';
  } else if (verdict === 'AMBIGUOUS') {
    calculatedOutcomeState = 'NEEDS_CLARITY';
    treasuryImpact = '+0.00 GEN (RESERVATION REVERTED)';
    beneficiaryAction = 'RE-NOMINATION REQUIRED';
    settlementStatus = 'INSUFFICIENT_EVIDENCE';
  } else if (votingOutcome === 'FAILED') {
    calculatedOutcomeState = 'REJECTED';
    treasuryImpact = '+0.00 GEN (RELEASED TO POOL)';
    beneficiaryAction = 'CONCLUDED / NO PAYOUT';
    settlementStatus = 'QUORUM_UNMET';
  } else {
    calculatedOutcomeState = 'APPROVED';
    treasuryImpact = `-${requestAmount.toFixed(2)} GEN CREDIT`;
    beneficiaryAction = 'CREDITED // READY FOR WITHDRAWAL ↗';
    settlementStatus = 'RECIPIENT_LEDGER_CREDITED';
  }

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* Top Header Section */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 pt-16 pb-20">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex items-center justify-between font-mono text-xs text-[#888884] pb-2 border-b border-[#262626]">
            <div className="flex items-center gap-2">
              <span className="text-[#ff5719] font-bold">PROTOCOL BLUEPRINT</span>
              <span>// DOC: CF-EXEC-SPEC-04</span>
            </div>
            <div className="flex items-center gap-3">
              <Barcode width={80} height={14} color="#888884" />
              <span>CHAIN ID: 61997</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-8 space-y-4">
              <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl lg:text-5xl uppercase font-bold text-[#e5e2e1] leading-tight">
                Freeze the rules.<br />
                Review each proposal.<br />
                <span className="text-[#ff5719]">Pay only what passed.</span>
              </h1>
              <p className="font-['Hanken_Grotesk'] text-base sm:text-lg text-[#c8c6c2] leading-relaxed max-w-3xl">
                CharterFlow enforces an uncompromising separation of powers. Deterministic EVM logic regulates balance ceilings and permissions; GenLayer validator consensus interrogates charter clause compliance; registered member keys vote; designated recipients autonomously withdraw test GEN.
              </p>
            </div>

            {/* Metric Telemetry Capsule */}
            <div className="lg:col-span-4 bg-[#1c1b1b] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-4">
              <div className="flex items-center justify-between font-mono text-xs pb-3 border-b border-[#2a2a2a]">
                <span className="text-[#888884]">MECHANICAL EQUILIBRIUM</span>
                <span className="text-[#00e599] font-bold">0.00% DRIFT</span>
              </div>
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between items-baseline">
                  <span className="text-[#888884]">DISPUTE SURFACE</span>
                  <span className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]">
                    0 ARBITRATION
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[#888884]">EVALUATION MODEL</span>
                  <span className="font-['Space_Grotesk'] text-base font-bold text-[#ff5719]">
                    AI CONSENSUS
                  </span>
                </div>
              </div>
              <div className="pt-3 border-t border-[#2a2a2a] flex items-center justify-between font-mono text-xs text-[#888884]">
                <span>GENLAYER STUDIO TESTNET</span>
                <span className="text-[#00e599] font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00e599] animate-pulse"></span>
                  CONNECTED #61997
                </span>
              </div>
            </div>
          </div>

          {/* 4 Power Layers Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[#262626] border border-[#262626] mt-8">
            <div className="bg-[#1c1b1b] p-5 space-y-2">
              <div className="font-mono text-xs text-[#ff5719] font-bold">POWER LAYER 01</div>
              <div className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]">
                Mechanical Logic
              </div>
              <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                Hardcoded mathematical guards execute parameter checks, cap limitations, and immediate lock reservations without discretionary delay.
              </p>
            </div>
            <div className="bg-[#1c1b1b] p-5 space-y-2">
              <div className="font-mono text-xs text-[#ff5719] font-bold">POWER LAYER 02</div>
              <div className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]">
                GenLayer Consensus
              </div>
              <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                Intelligent nodes parse deliverables against natural language charter stipulations. Binary determination: ELIGIBLE or INELIGIBLE.
              </p>
            </div>
            <div className="bg-[#1c1b1b] p-5 space-y-2">
              <div className="font-mono text-xs text-[#ff5719] font-bold">POWER LAYER 03</div>
              <div className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]">
                Member Sovereign Vote
              </div>
              <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                Whitelisted member keys cast unweighted 1-member-1-vote cryptographic choices. Strict affirmative quorum controls payout validity.
              </p>
            </div>
            <div className="bg-[#1c1b1b] p-5 space-y-2">
              <div className="font-mono text-xs text-[#ff5719] font-bold">POWER LAYER 04</div>
              <div className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1]">
                Atomic Withdrawal
              </div>
              <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                Zero push transfers. Approved allocations credit beneficiary accounts. Beneficiaries invoke native test GEN withdrawal pull pipelines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE FIVE-STAGE PROTOCOL PIPELINE */}
      <section className="w-full bg-[#131313] px-4 lg:px-10 py-20 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#262626] pb-6">
            <div>
              <span className="font-mono text-xs text-[#ff5719] uppercase tracking-widest font-bold block mb-1">
                EXECUTION LIFECYCLE
              </span>
              <h2 className="font-['Space_Grotesk'] text-2xl sm:text-3xl uppercase text-[#e5e2e1] font-bold">
                The Five-Stage Protocol Pipeline
              </h2>
            </div>
            <p className="font-['Hanken_Grotesk'] text-xs sm:text-sm text-[#c8c6c2] max-w-md">
              Every treasury transaction traverses deterministic state shifts. Funds are sequestered beforehand, preventing double-spend and unauthorized liquidations.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#888884]">
                  <span>01 // INIT</span>
                  <span className="text-[#e5e2e1]">[INSET]</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-sm uppercase font-bold text-[#e5e2e1]">
                  Round Genesis & Charter Lock
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2]">
                  Creator deposits native test GEN into round pool, binds immutable numbered charter guidelines, declares proposal allocation caps, member rosters, and quorum voting minimums.
                </p>
              </div>
              <div className="pt-2 border-t border-[#2a2a2a] font-mono text-[10px] text-[#888884]">
                STATE: <span className="text-[#e5e2e1]">ACTIVE_ROUND</span>
              </div>
            </div>

            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#888884]">
                  <span>02 // ALLOC</span>
                  <span className="text-[#ff5719]">[RESERVE]</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-sm uppercase font-bold text-[#e5e2e1]">
                  Nomination & Fund Reservation
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2]">
                  A registered member nominates a destination wallet with deliverable metadata and exact request amount. Contract logic mechanically places equivalent test GEN into RESERVED state.
                </p>
              </div>
              <div className="pt-2 border-t border-[#2a2a2a] font-mono text-[10px] text-[#ff5719]">
                ESCROW: RESERVED_POOL
              </div>
            </div>

            <div className="bg-[#1c1b1b] border border-[#ff5719] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#ff5719]">
                  <span>03 // INFER</span>
                  <span className="font-bold">[VALIDATION]</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-sm uppercase font-bold text-[#e5e2e1]">
                  Intelligent Contract Review
                </h3>
                <p className="font-['Hanken_Groken'] text-xs text-[#c8c6c2]">
                  GenLayer validator consensus parses the nominee deliverable strictly against the frozen charter rules. Delivers clean verdict: ELIGIBLE or INELIGIBLE. If rejected, funds unreserve.
                </p>
              </div>
              <div className="pt-2 border-t border-[#2a2a2a] font-mono text-[10px] text-[#00e599] font-bold">
                VERDICT: ELIGIBLE / INELIGIBLE
              </div>
            </div>

            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#888884]">
                  <span>04 // QUORUM</span>
                  <span className="text-[#e5e2e1]">[VOTING]</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-sm uppercase font-bold text-[#e5e2e1]">
                  Member Voting Window
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2]">
                  Only certified charter-compliant proposals open to member voting. Eligible wallets submit affirmative or negative ballots. 1 member = 1 vote. If affirmative quorum is met before expiry, status shifts to APPROVED.
                </p>
              </div>
              <div className="pt-2 border-t border-[#2a2a2a] font-mono text-[10px] text-[#888884]">
                VOTE TALLY: QUORUM_REACHED
              </div>
            </div>

            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#888884]">
                  <span>05 // PAYOUT</span>
                  <span className="text-[#00e599]">[ATOMIC]</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-sm uppercase font-bold text-[#e5e2e1]">
                  Recipient Credit & Withdrawal
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2]">
                  Approval unlocks reserved treasury capital into a designated recipient credit balance. The recipient triggers a simple withdraw() execution to receive native test GEN directly.
                </p>
              </div>
              <div className="pt-2 border-t border-[#2a2a2a] font-mono text-[10px] text-[#00e599]">
                CREDIT: PULL_WITHDRAWAL
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROTOCOL OUTCOME MATRIX */}
      <section className="w-full bg-[#0e0e0e] px-4 lg:px-10 py-20 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626] pb-4">
            <div>
              <span className="font-mono text-xs text-[#ff5719] uppercase tracking-wider font-bold block">
                DETERMINISTIC BEHAVIOR
              </span>
              <h2 className="font-['Space_Grotesk'] text-2xl sm:text-3xl uppercase font-bold text-[#e5e2e1]">
                Protocol Outcome Matrix
              </h2>
            </div>
            <div className="font-mono text-xs text-[#888884]">
              7 DISCRETE STATES // NON-REVERSIBLE TRANSITIONS
            </div>
          </div>

          <div className="overflow-x-auto border border-[#262626]">
            <table className="w-full text-left font-mono text-xs divide-y divide-[#262626]">
              <thead className="bg-[#1c1b1b] text-[#888884] uppercase text-[11px]">
                <tr>
                  <th className="p-3.5">PROPOSAL STATE</th>
                  <th className="p-3.5">TRIGGER CONDITION</th>
                  <th className="p-3.5">TREASURY IMPACT</th>
                  <th className="p-3.5">AVAILABLE NEXT ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222] bg-[#131313]">
                <tr>
                  <td className="p-3.5 font-bold text-[#e5e2e1] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#ff5719]"></span>
                    NOMINATED
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    Whitelisted member nominates proposal; EVM code certifies proposal request is &lt;= round cap.
                  </td>
                  <td className="p-3.5 text-[#ff5719]">
                    FUNDS RESERVED (Deducted from available treasury pool)
                  </td>
                  <td className="p-3.5 text-[#888884]">
                    Awaiting GenLayer AI validator charter review
                  </td>
                </tr>

                <tr>
                  <td className="p-3.5 font-bold text-[#00e599] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#00e599]"></span>
                    ELIGIBLE
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    GenLayer validators confirm compliance with immutable natural language charter provisions.
                  </td>
                  <td className="p-3.5 text-[#e5e2e1]">
                    RESERVATION MAINTAINED (Capital remains quarantined for voting)
                  </td>
                  <td className="p-3.5 text-[#00e599]">
                    Whitelisted member voting window opens
                  </td>
                </tr>

                <tr>
                  <td className="p-3.5 font-bold text-[#ff3344] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#ff3344]"></span>
                    INELIGIBLE
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    Deliverable conflicts with frozen round charter clauses or explicit exclusions.
                  </td>
                  <td className="p-3.5 text-[#888884]">
                    RESERVATION RELEASED (Returned directly to available round pool)
                  </td>
                  <td className="p-3.5 text-[#ff3344]">
                    Proposal finalized / Terminal rejection
                  </td>
                </tr>

                <tr>
                  <td className="p-3.5 font-bold text-[#ffb800] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#ffb800]"></span>
                    NEEDS_CLARITY
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    Insufficient evidence, missing deliverable URLs, or ambiguous scope reported by validator quorum.
                  </td>
                  <td className="p-3.5 text-[#888884]">
                    RESERVATION RELEASED (No capital blocked during clarification)
                  </td>
                  <td className="p-3.5 text-[#ffb800]">
                    Member may re-nominate with specified details
                  </td>
                </tr>

                <tr>
                  <td className="p-3.5 font-bold text-[#00e599] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#00e599]"></span>
                    APPROVED
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    Affirmative member ballot votes satisfy or exceed configured quorum threshold before expiry.
                  </td>
                  <td className="p-3.5 text-[#00e599]">
                    CREDITED TO RECIPIENT (Committed; irrevocable credit minted)
                  </td>
                  <td className="p-3.5 text-[#e5e2e1] font-bold">
                    Recipient authorized to trigger withdraw()
                  </td>
                </tr>

                <tr>
                  <td className="p-3.5 font-bold text-[#ff3344] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#ff3344]"></span>
                    REJECTED
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    Member voting deadline passed without achieving required yes vote threshold.
                  </td>
                  <td className="p-3.5 text-[#888884]">
                    RESERVATION RELEASED (Returns to pool for other allocations)
                  </td>
                  <td className="p-3.5 text-[#888884]">
                    Concluded // No payout
                  </td>
                </tr>

                <tr>
                  <td className="p-3.5 font-bold text-[#00e599] flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#00e599]"></span>
                    PAYOUT_EMITTED
                  </td>
                  <td className="p-3.5 text-[#c8c6c2]">
                    Recipient wallet executes native contract claim transaction.
                  </td>
                  <td className="p-3.5 text-[#00e599]">
                    NATIVE GEN TRANSFERRED (Recipient ledger credit reset to 0.00)
                  </td>
                  <td className="p-3.5 text-[#888884]">
                    Receipt Finalized on GenLayer ledger
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* INTERACTIVE SCENARIO TRAVERSAL TOOL */}
      <section className="w-full bg-[#131313] px-4 lg:px-10 py-20 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto space-y-8">
          <div>
            <span className="font-mono text-xs text-[#ff5719] uppercase tracking-wider font-bold block">
              STATE SIMULATOR
            </span>
            <h2 className="font-['Space_Grotesk'] text-2xl sm:text-3xl uppercase font-bold text-[#e5e2e1]">
              Interactive Scenario Traversal
            </h2>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] mt-1">
              Simulate how CharterFlow evaluates a proposal through the five discrete mechanical gates.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Input Controls */}
            <div className="lg:col-span-5 bg-[#1c1b1b] border border-[#2a2a2a] p-6 space-y-6">
              <div className="font-mono text-xs text-[#888884] uppercase font-bold pb-2 border-b border-[#2a2a2a]">
                CONFIGURE SCENARIO INPUTS
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <label className="font-mono text-xs text-[#e5e2e1] uppercase font-bold flex justify-between">
                  <span>PROPOSAL REQUEST AMOUNT</span>
                  <span className="text-[#888884]">CAP: 5,000 GEN</span>
                </label>
                <div className="flex items-center bg-[#0e0e0e] border border-[#2a2a2a]">
                  <input
                    type="number"
                    value={requestAmount}
                    onChange={(e) => setRequestAmount(Number(e.target.value))}
                    min={1}
                    max={10000}
                    className="w-full bg-transparent p-2.5 font-mono text-sm text-[#e5e2e1] focus:outline-none"
                  />
                  <span className="px-3 font-mono text-xs text-[#ff5719] font-bold">test GEN</span>
                </div>
                {isCapExceeded && (
                  <p className="font-mono text-[11px] text-[#ff3344]">
                    Exceeds round maximum cap (5,000 test GEN). Mechanical revert triggered!
                  </p>
                )}
              </div>

              {/* Compliance Verdict */}
              <div className="space-y-2">
                <label className="font-mono text-xs text-[#e5e2e1] uppercase font-bold block">
                  CHARTER COMPLIANCE VERDICT (AI QUORUM)
                </label>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => setVerdict('ELIGIBLE')}
                    className={`p-2 uppercase font-bold transition-colors ${
                      verdict === 'ELIGIBLE'
                        ? 'bg-[#ff5719] text-[#521300]'
                        : 'bg-[#201f1f] text-[#c8c6c2] hover:bg-[#2a2a2a]'
                    }`}
                  >
                    ELIGIBLE
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerdict('AMBIGUOUS')}
                    className={`p-2 uppercase font-bold transition-colors ${
                      verdict === 'AMBIGUOUS'
                        ? 'bg-[#ffb800] text-black'
                        : 'bg-[#201f1f] text-[#c8c6c2] hover:bg-[#2a2a2a]'
                    }`}
                  >
                    AMBIGUOUS
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerdict('INELIGIBLE')}
                    className={`p-2 uppercase font-bold transition-colors ${
                      verdict === 'INELIGIBLE'
                        ? 'bg-[#ff3344] text-white'
                        : 'bg-[#201f1f] text-[#c8c6c2] hover:bg-[#2a2a2a]'
                    }`}
                  >
                    INELIGIBLE
                  </button>
                </div>
              </div>

              {/* Member Voting Results */}
              <div className="space-y-2">
                <label className="font-mono text-xs text-[#e5e2e1] uppercase font-bold block">
                  MEMBER VOTING RESULTS (STRICT 2/3 SUPERMAJORITY, RECIPIENT RECUSED)
                </label>
                <p className="font-mono text-[10px] text-[#888884]">
                  Contract Rule: (n_eligible * 2 + 2) // 3 YES votes required. Committee recipient is strictly recused from voting on own proposal (n_eligible = roster - 1).
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                  <button
                    type="button"
                    disabled={verdict !== 'ELIGIBLE' || isCapExceeded}
                    onClick={() => setVotingOutcome('PASSED')}
                    className={`p-2 uppercase font-bold transition-colors ${
                      verdict !== 'ELIGIBLE' || isCapExceeded
                        ? 'opacity-40 cursor-not-allowed bg-[#201f1f] text-[#888884]'
                        : votingOutcome === 'PASSED'
                        ? 'bg-[#00e599] text-black'
                        : 'bg-[#201f1f] text-[#c8c6c2] hover:bg-[#2a2a2a]'
                    }`}
                  >
                    RATIFIED (4 YES / 1 NO - EXCEEDS 2/3)
                  </button>
                  <button
                    type="button"
                    disabled={verdict !== 'ELIGIBLE' || isCapExceeded}
                    onClick={() => setVotingOutcome('FAILED')}
                    className={`p-2 uppercase font-bold transition-colors ${
                      verdict !== 'ELIGIBLE' || isCapExceeded
                        ? 'opacity-40 cursor-not-allowed bg-[#201f1f] text-[#888884]'
                        : votingOutcome === 'FAILED'
                        ? 'bg-[#ff3344] text-white'
                        : 'bg-[#201f1f] text-[#c8c6c2] hover:bg-[#2a2a2a]'
                    }`}
                  >
                    FAILED (2 YES / 3 NO - BELOW 2/3)
                  </button>
                </div>
              </div>
            </div>

            {/* Resolved Telemetry Output Box */}
            <div className="lg:col-span-7 bg-[#0e0e0e] border border-[#2a2a2a] p-6 space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                <div className="flex items-center gap-2 font-mono text-xs text-[#ff5719] font-bold">
                  <span className="w-2 h-2 bg-[#ff5719]"></span>
                  <span>RESOLVED TRANSACTION TELEMETRY</span>
                </div>
                <span className={`px-2 py-0.5 font-mono text-[10px] uppercase font-bold ${
                  calculatedOutcomeState === 'APPROVED'
                    ? 'bg-[#00e599]/20 text-[#00e599]'
                    : 'bg-[#ff3344]/20 text-[#ff3344]'
                }`}>
                  STATE: {calculatedOutcomeState}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#1c1b1b] p-4 border border-[#2a2a2a]">
                  <span className="font-mono text-[10px] text-[#888884] uppercase block">
                    TREASURY CAPITAL EFFECT
                  </span>
                  <span className="font-['Space_Grotesk'] text-xl font-bold text-[#e5e2e1] block mt-1">
                    {treasuryImpact}
                  </span>
                </div>
                <div className="bg-[#1c1b1b] p-4 border border-[#2a2a2a]">
                  <span className="font-mono text-[10px] text-[#888884] uppercase block">
                    BENEFICIARY ACTION
                  </span>
                  <span className={`font-['Space_Grotesk'] text-base font-bold block mt-1 ${
                    calculatedOutcomeState === 'APPROVED' ? 'text-[#00e599]' : 'text-[#ff3344]'
                  }`}>
                    {beneficiaryAction}
                  </span>
                </div>
              </div>

              {/* Mechanical Verification Trail */}
              <div className="space-y-2 font-mono text-xs pt-2 border-t border-[#2a2a2a]">
                <div className="flex justify-between py-1 text-[#888884] border-b border-[#222222]">
                  <span>01. MECHANICAL GATE (AMOUNT &lt;= 5000):</span>
                  <span className={isCapExceeded ? 'text-[#ff3344] font-bold' : 'text-[#00e599]'}>
                    {isCapExceeded ? 'FAILED (CAP EXCEEDED)' : 'VALIDATED (PASS)'}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-[#888884] border-b border-[#222222]">
                  <span>02. ESCROW RESERVATION MUTATION:</span>
                  <span className="text-[#e5e2e1]">
                    {isCapExceeded ? 'REJECTED' : `${requestAmount.toFixed(2)} GEN RESERVED`}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-[#888884] border-b border-[#222222]">
                  <span>03. GENLAYER CHARTER CONSENSUS:</span>
                  <span className={verdict === 'ELIGIBLE' ? 'text-[#00e599]' : 'text-[#ff3344]'}>
                    {verdict}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-[#888884] border-b border-[#222222]">
                  <span>04. MEMBER VOTING THRESHOLD:</span>
                  <span className="text-[#e5e2e1]">
                    {verdict === 'ELIGIBLE' && !isCapExceeded ? votingOutcome : 'SKIPPED'}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-[#888884]">
                  <span>05. FINAL SETTLEMENT VECTOR:</span>
                  <span className="text-[#ff5719] font-bold">{settlementStatus}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM CTA BANNER */}
      <section className="w-full bg-[#1c1b1b] px-4 lg:px-10 py-16 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="font-['Space_Grotesk'] text-2xl uppercase font-bold text-[#e5e2e1]">
              Ready to Instantiate an Autonomous Treasury Round?
            </h3>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] mt-1">
              Deploy your charter rules or inspect ongoing active rounds on Studio Next.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/rounds"
              className="px-6 py-3 bg-[#2a2a2a] text-[#e5e2e1] font-mono text-xs uppercase font-bold hover:bg-[#353534] transition-colors"
            >
              EXPLORE ROUNDS ↗
            </Link>
            <Link
              to="/rounds/new"
              className="px-6 py-3 bg-[#ff5719] text-[#521300] font-mono text-xs uppercase font-bold hover:bg-white hover:text-black transition-colors"
            >
              DEPLOY CHARTER ↗
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
