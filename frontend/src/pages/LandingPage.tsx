import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Barcode } from '../components/Barcode';
import { useData } from '../services/dataAccess';
import type { Round } from '../types';
import { NETWORK_CONFIG, isContractConfigured } from '../config/network';

export const LandingPage: React.FC = () => {
  const { adapter, isDesignPreview, setDesignPreview, refreshData, refreshKey } = useData();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
          setError(err?.message || 'Failed to query rounds');
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [adapter, refreshKey]);


  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* HERO STAGE */}
      <section className="relative w-full bg-[#0e0e0e] px-4 lg:px-10 pt-16 pb-24 overflow-hidden border-b border-[#262626]">
        {/* Subtle Background Wireframe Graphic */}
        <div className="absolute right-0 top-0 w-1/2 lg:w-1/3 h-full pointer-events-none opacity-20 flex flex-col justify-between py-8 pr-6">
          <div className="font-mono text-[10px] tracking-widest text-[#ff5719] flex items-center justify-end gap-2">
            <span>LOC://STUDIO-NEXT-61997</span>
            <span className="w-8 h-[1px] bg-[#ff5719]"></span>
          </div>
          <svg className="w-full h-auto text-[#ff5719]" fill="none" viewBox="0 0 320 280">
            <polygon
              fill="none"
              points="160,20 290,95 290,225 160,270 30,225 30,95"
              stroke="currentColor"
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
            <polygon
              fill="none"
              points="160,60 250,115 250,205 160,240 70,205 70,115"
              stroke="currentColor"
              strokeWidth="1"
            />
            <line stroke="currentColor" strokeWidth="1" x1="160" x2="160" y1="20" y2="270" />
            <line stroke="currentColor" strokeDasharray="2 2" strokeWidth="1" x1="30" x2="290" y1="95" y2="225" />
            <line stroke="currentColor" strokeDasharray="2 2" strokeWidth="1" x1="30" x2="290" y1="225" y2="95" />
          </svg>
          <div className="font-mono text-[10px] text-right text-[#c8c6c2] tracking-widest">
            DETERMINISTIC_REGISTRY // 0x61997
          </div>
        </div>

        <div className="max-w-6xl relative z-10 mx-auto">
          {/* Telemetry Tag */}
          <div className="inline-flex items-center gap-2 bg-[#201f1f] px-3 py-1 mb-8 border border-[#2a2a2a]">
            <span className="w-2 h-2 rounded-full bg-[#ff5719]"></span>
            <span className="font-mono text-[11px] text-[#e5e2e1] uppercase tracking-widest">
              GENLAYER INTELLIGENT CONTRACT CONSENSUS
            </span>
            <span className="text-[#c8c6c2] font-mono text-[11px]">// CHAIN 61997</span>
          </div>

          {/* Main Title */}
          <h1 className="font-['Space_Grotesk'] text-4xl sm:text-5xl lg:text-6xl tracking-tight text-[#e5e2e1] uppercase font-bold max-w-5xl leading-none">
            FREEZE THE RULES.<br />
            <span className="text-[#ff5719]">REVIEW AGAINST THEM.</span><br />
            LET MEMBERS VOTE.
          </h1>

          {/* Content & Right Telemetry Block */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-10 pt-4">
            <div className="lg:col-span-7 space-y-6">
              <p className="font-['Hanken_Grotesk'] text-base sm:text-lg text-[#c8c6c2] max-w-2xl leading-relaxed">
                CharterFlow brings intelligent contract governance to grant treasuries on GenLayer Studio Next. Lock permitted purposes, recipient caps, and member rosters at genesis. GenLayer&apos;s multi-node AI validator consensus evaluates proposal charter compliance against frozen natural-language rules.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  to="/rounds"
                  className="px-6 py-3.5 bg-[#ff5719] text-[#521300] font-['Space_Grotesk'] text-sm uppercase font-bold tracking-wider flex items-center gap-2 hover:bg-white hover:text-black transition-all"
                >
                  EXPLORE ACTIVE ROUNDS <span>↗</span>
                </Link>
                <Link
                  to="/rounds/new"
                  className="px-6 py-3.5 bg-[#201f1f] text-[#e5e2e1] font-['Space_Grotesk'] text-sm uppercase font-bold tracking-wider flex items-center gap-2 border border-[#2a2a2a] hover:bg-[#2a2a2a] transition-all"
                >
                  CREATE A ROUND <span>↗</span>
                </Link>
              </div>
            </div>

            {/* Hardware Specification Box */}
            <div className="lg:col-span-5 bg-[#201f1f] border border-[#2a2a2a] p-6 flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-[#2a2a2a]">
                <span className="font-mono text-xs text-[#ff5719] uppercase font-bold tracking-wider">
                  [SYS-STATE: NOMINAL]
                </span>
                <span className="font-mono text-xs text-[#c8c6c2]">CHAIN_61997</span>
              </div>
              <div className="space-y-2 font-mono text-xs py-4">
                <div className="flex justify-between py-1 text-[#c8c6c2] border-b border-[#2a2a2a]/60">
                  <span>TREASURY ISOLATION:</span>
                  <span className="text-[#e5e2e1] font-bold">STRICT_VAULT</span>
                </div>
                <div className="flex justify-between py-1 text-[#c8c6c2] border-b border-[#2a2a2a]/60">
                  <span>ORACLE JUDGMENT:</span>
                  <span className="text-[#ff5719] font-bold">VALIDATOR_CONSENSUS</span>
                </div>
                <div className="flex justify-between py-1 text-[#c8c6c2] border-b border-[#2a2a2a]/60">
                  <span>THRESHOLD LOGIC:</span>
                  <span className="text-[#e5e2e1] font-bold">1_MEMBER_1_VOTE</span>
                </div>
                <div className="flex justify-between py-1 text-[#c8c6c2]">
                  <span>EXECUTION RUNTIME:</span>
                  <span className="text-[#e5e2e1]">STUDIO NEXT TESTNET</span>
                </div>
              </div>
              <div className="pt-3 flex items-center gap-3 border-t border-[#2a2a2a]">
                <Barcode width={100} height={16} color="#c8c6c2" />
                <span className="font-mono text-[10px] text-[#c8c6c2] tracking-wider">
                  VERIFIED ROUND STANDARD
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HIGH-CONTRAST CORE DIRECTIVE BANNER */}
      <section className="w-full bg-[#ff5719] text-[#521300] px-4 lg:px-10 py-16 relative">
        <div className="max-w-6xl mx-auto flex flex-col gap-8">
          <div className="space-y-3">
            <div className="font-mono text-xs uppercase tracking-widest font-bold opacity-80">
              PROTOCOL CORE DIRECTIVE // NO POST-DEPLOYMENT ARBITRARY OVERRIDES
            </div>
            <h2 className="font-['Space_Grotesk'] text-2xl sm:text-3xl lg:text-4xl uppercase font-bold leading-tight max-w-5xl">
              By locking the charter into an immutable GenLayer intelligent contract, rounds guarantee that permitted purposes, member rosters, and grant caps can never be manipulated after deployment. Validators judge one narrow test: charter compliance.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-[#521300]/20">
            <div className="bg-[#ffdbd0]/30 p-4 border border-[#521300]/20">
              <span className="font-mono text-[10px] uppercase font-bold tracking-wider block">
                IMMUTABILITY
              </span>
              <span className="font-['Space_Grotesk'] text-2xl font-bold block mt-1">
                FROZEN
              </span>
              <p className="font-['Hanken_Grotesk'] text-xs mt-1 leading-snug">
                Charter clauses and caps permanently set at round initialization.
              </p>
            </div>
            <div className="bg-[#ffdbd0]/30 p-4 border border-[#521300]/20">
              <span className="font-mono text-[10px] uppercase font-bold tracking-wider block">
                NETWORK
              </span>
              <span className="font-['Space_Grotesk'] text-2xl font-bold block mt-1">
                #61997
              </span>
              <p className="font-['Hanken_Grotesk'] text-xs mt-1 leading-snug">
                Studio Next testnet deterministic validator consensus.
              </p>
            </div>
            <div className="bg-[#ffdbd0]/30 p-4 border border-[#521300]/20">
              <span className="font-mono text-[10px] uppercase font-bold tracking-wider block">
                GOVERNANCE
              </span>
              <span className="font-['Space_Grotesk'] text-2xl font-bold block mt-1">
                STRICT
              </span>
              <p className="font-['Hanken_Grotesk'] text-xs mt-1 leading-snug">
                Automated consensus validation before members can vote.
              </p>
            </div>
            <div className="bg-[#ffdbd0]/30 p-4 border border-[#521300]/20">
              <span className="font-mono text-[10px] uppercase font-bold tracking-wider block">
                RECONCILIATION
              </span>
              <span className="font-['Space_Grotesk'] text-2xl font-bold block mt-1">
                REALTIME
              </span>
              <p className="font-['Hanken_Grotesk'] text-xs mt-1 leading-snug">
                Continuous test GEN escrow accounting across all proposal stages.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE FIVE-STAGE TRUST TIMELINE */}
      <section className="w-full bg-[#131313] px-4 lg:px-10 py-20 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto space-y-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#262626] pb-6">
            <div>
              <span className="font-mono text-xs text-[#ff5719] uppercase tracking-widest font-bold block mb-1">
                LIFECYCLE VERIFICATION PROTOCOL
              </span>
              <h2 className="font-['Space_Grotesk'] text-3xl uppercase text-[#e5e2e1] font-bold">
                The Five-Stage Trust Timeline
              </h2>
            </div>
            <p className="font-['Hanken_Grotesk'] text-xs sm:text-sm text-[#c8c6c2] max-w-md">
              Deterministic progression from round ignition to native test GEN extraction. No intermediate human escrow or custodian signature required.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Stage 1 */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#ff5719]">
                  <span className="font-bold">01 // INIT</span>
                  <span className="material-symbols-outlined text-[14px]">lock</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1]">
                  Freeze Charter & Deposit
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                  Creator locks total test GEN, defines numbered rule clauses, sets grant ceilings, and freezes the voter registry.
                </p>
              </div>
              <div className="pt-3 border-t border-[#2a2a2a] font-mono text-[10px] text-[#888884] uppercase">
                STATE: <span className="text-[#e5e2e1]">IMMUTABLE_VAULT</span>
              </div>
            </div>

            {/* Stage 2 */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#ff5719]">
                  <span className="font-bold">02 // PROPOSE</span>
                  <span className="material-symbols-outlined text-[14px]">description</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1]">
                  Nominate & Reserve
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                  Applicant registers recipient address and requested test GEN. Contract runs mechanical cap check and reserves funds.
                </p>
              </div>
              <div className="pt-3 border-t border-[#2a2a2a] font-mono text-[10px] text-[#888884] uppercase">
                ESCROW: <span className="text-[#e5e2e1]">BALANCE_LOCKED</span>
              </div>
            </div>

            {/* Stage 3 */}
            <div className="bg-[#1c1b1b] border border-[#ff5719]/40 p-5 flex flex-col justify-between space-y-4 relative">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#ff5719]">
                  <span className="font-bold">03 // AI CONSENSUS</span>
                  <span className="w-2 h-2 rounded-full bg-[#ff5719]"></span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1]">
                  Validator Charter Review
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                  GenLayer intelligent validator nodes analyze proposal text strictly against frozen charter rules. If compliant, marked ELIGIBLE.
                </p>
              </div>
              <div className="pt-3 border-t border-[#2a2a2a] font-mono text-[10px] text-[#ff5719] uppercase font-bold">
                RULE CHECK: AUTOMATED_VERDICT
              </div>
            </div>

            {/* Stage 4 */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#ff5719]">
                  <span className="font-bold">04 // BALLOT</span>
                  <span className="material-symbols-outlined text-[14px]">how_to_vote</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1]">
                  Member Voting Window
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                  Whitelisted roster members cast YES/NO transactions. Strictly one member, one vote. Threshold consensus determines approval.
                </p>
              </div>
              <div className="pt-3 border-t border-[#2a2a2a] font-mono text-[10px] text-[#888884] uppercase">
                MODE: <span className="text-[#e5e2e1]">PEER_QUORUM</span>
              </div>
            </div>

            {/* Stage 5 */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-[#ff5719]">
                  <span className="font-bold">05 // PAYOUT</span>
                  <span className="material-symbols-outlined text-[14px]">payments</span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1]">
                  Credit & Native Withdrawal
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] leading-relaxed">
                  APPROVED verdict automatically transitions reserved funds into recipient claimable credits. Recipient triggers withdrawal.
                </p>
              </div>
              <div className="pt-3 border-t border-[#2a2a2a] font-mono text-[10px] text-[#888884] uppercase">
                DISBURSE: <span className="text-[#00e599]">PULL_PIPELINE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ACTIVE INDUSTRIAL ROUNDS PREVIEW */}
      <section className="w-full bg-[#0e0e0e] px-4 lg:px-10 py-20 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626] pb-4">
            <div>
              <span className="font-mono text-xs text-[#888884] uppercase tracking-wider block">
                ROUND TELEMETRY MONITOR //{' '}
                {isDesignPreview
                  ? 'DESIGN PREVIEW'
                  : loading
                    ? 'LIVE QUERY PENDING'
                    : error
                      ? 'LIVE READ ERROR'
                      : 'LIVE READ CONFIRMED'}
              </span>
              <h2 className="font-['Space_Grotesk'] text-2xl sm:text-3xl uppercase font-bold text-[#e5e2e1]">
                Active Industrial Rounds
              </h2>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <Link
                to="/rounds"
                className="px-3 py-1.5 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] uppercase"
              >
                EXPLORE ALL ROUNDS ↗
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {isDesignPreview ? (
              <>
                {/* Round Card 1 (Design Preview) */}
                <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-[#ff5719]">[ROUND #094-SDK]</span>
                      <span className="px-2 py-0.5 bg-[#ffb800]/20 text-[#ffb800] text-[10px] uppercase font-bold">
                        VOTING OPEN
                      </span>
                    </div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      GenLayer Tooling & SDK Sprint Round
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] line-clamp-2">
                      Restricted to developer infrastructure: compiler simulators, CLI debuggers, and Python contract testing suites.
                    </p>
                    <div className="pt-2 space-y-1.5 font-mono text-xs border-t border-[#2a2a2a]">
                      <div className="flex justify-between text-[#888884]">
                        <span>AVAILABLE:</span>
                        <span className="text-[#e5e2e1]">22,500.00 GEN</span>
                      </div>
                      <div className="flex justify-between text-[#888884]">
                        <span>RESERVED (PENDING):</span>
                        <span className="text-[#ff5719]">15,000.00 GEN</span>
                      </div>
                      <div className="flex justify-between text-[#888884]">
                        <span>GRANT CAP:</span>
                        <span className="text-[#e5e2e1]">5,000.00 GEN</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                    <span className="text-[#888884]">18 MEMBERS</span>
                    <Link
                      to="/rounds/round-094-sdk"
                      className="text-[#ff5719] font-bold hover:underline flex items-center gap-1"
                    >
                      VIEW CHARTER ↗
                    </Link>
                  </div>
                </div>

                {/* Round Card 2 (Design Preview) */}
                <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-[#ff5719]">[ROUND #102-AGT]</span>
                      <span className="px-2 py-0.5 bg-[#ffb800]/20 text-[#ffb800] text-[10px] uppercase font-bold">
                        VOTING OPEN
                      </span>
                    </div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      Autonomous Agent Verification Suite
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] line-clamp-2">
                      Incentivizing verifiable execution layers and multi-agent coordination frameworks on GenLayer Studio.
                    </p>
                    <div className="pt-2 space-y-1.5 font-mono text-xs border-t border-[#2a2a2a]">
                      <div className="flex justify-between text-[#888884]">
                        <span>AVAILABLE:</span>
                        <span className="text-[#e5e2e1]">48,200.00 GEN</span>
                      </div>
                      <div className="flex justify-between text-[#888884]">
                        <span>RESERVED (PENDING):</span>
                        <span className="text-[#ff5719]">24,000.00 GEN</span>
                      </div>
                      <div className="flex justify-between text-[#888884]">
                        <span>GRANT CAP:</span>
                        <span className="text-[#e5e2e1]">8,000.00 GEN</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                    <span className="text-[#888884]">12 MEMBERS</span>
                    <Link
                      to="/rounds/round-102-agt"
                      className="text-[#ff5719] font-bold hover:underline flex items-center gap-1"
                    >
                      VIEW CHARTER ↗
                    </Link>
                  </div>
                </div>
              </>
            ) : loading ? (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 col-span-1 lg:col-span-2 flex items-center justify-center font-mono text-xs text-[#888884]">
                READING IMMUTABLE ON-CHAIN ROUNDS ON RUNTIME 61997...
              </div>
            ) : error ? (
              /* Error State with Retry */
              <div className="bg-[#1c1b1b] border border-[#ff3344]/50 p-6 col-span-1 lg:col-span-2 flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-mono text-xs text-[#ff3344]">
                    <span className="w-2 h-2 rounded-full bg-[#ff3344]"></span>
                    <span>[READ ERROR] ON-CHAIN QUERY FAILED</span>
                  </div>
                  <h3 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">
                    GenLayer Studio Next (Chain ID 61997)
                  </h3>
                  <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                    An RPC or validation error occurred while querying the network. This error is not presented as an empty state.
                  </p>
                  <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] font-mono text-xs text-[#ffb596] break-all">
                    DIAGNOSTIC: {error}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                  <span className="text-[#888884]">ACTION REQUIRED</span>
                  <button
                    type="button"
                    onClick={refreshData}
                    className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors flex items-center gap-1.5"
                  >
                    <span>RETRY ON-CHAIN QUERY</span>
                    <span>↻</span>
                  </button>
                </div>
              </div>
            ) : !isContractConfigured() ? (
              /* Truthful configuration error: no contract address */
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 col-span-1 lg:col-span-2 flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-mono text-xs text-[#ffb800]">
                    <span className="w-2 h-2 rounded-full bg-[#ffb800]"></span>
                    <span>CONTRACT ADDRESS NOT CONFIGURED</span>
                  </div>
                  <h3 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">
                    GenLayer Studio Next (Chain ID 61997)
                  </h3>
                  <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                    This build has no contract address configured. Live reads are unavailable, and sample rounds remain disabled in live mode to prevent false states.
                  </p>
                  <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] font-mono text-xs space-y-1">
                    <div className="flex justify-between text-[#888884]">
                      <span>TARGET CHAIN:</span>
                      <span className="text-[#e5e2e1]">61997</span>
                    </div>
                    <div className="flex justify-between text-[#888884]">
                      <span>RPC ENDPOINT:</span>
                      <span className="text-[#e5e2e1]">{NETWORK_CONFIG.rpcUrl}</span>
                    </div>
                    <div className="flex justify-between text-[#888884]">
                      <span>CONFIGURATION STATUS:</span>
                      <span className="text-[#ffb800]">MISSING CONTRACT ADDRESS</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                  <span className="text-[#888884]">LIVE READS ADAPTER READY</span>
                  <button
                    type="button"
                    onClick={() => setDesignPreview(true)}
                    className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
                  >
                    SWITCH TO DESIGN PREVIEW ↗
                  </button>
                </div>
              </div>
            ) : rounds.length === 0 ? (
              /* Truthful Empty: Contract configured, 0 rounds */
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 col-span-1 lg:col-span-2 flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-mono text-xs text-[#00e599]">
                    <span className="w-2 h-2 rounded-full bg-[#00e599]"></span>
                    <span>LIVE READS ACTIVE</span>
                  </div>
                  <h3 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">
                    No Live Rounds Registered On-Chain
                  </h3>
                  <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                    The deployed contract at {NETWORK_CONFIG.contractAddress} currently contains 0 registered grant rounds on GenLayer Studio Next.
                  </p>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                  <span className="text-[#888884]">0 ROUNDS LOCATED</span>
                  <Link
                    to="/rounds/new"
                    className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
                  >
                    CREATE ROUND ↗
                  </Link>
                </div>
              </div>
            ) : (
              /* Real On-Chain Rounds */
              rounds.slice(0, 2).map((r) => (
                <div key={r.id} className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-[#ff5719]">[ROUND #{r.id.toUpperCase()}]</span>
                      <span className="px-2 py-0.5 bg-[#00e599]/20 text-[#00e599] text-[10px] uppercase font-bold">
                        {r.status}
                      </span>
                    </div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      {r.title}
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] line-clamp-2">
                      {r.summary}
                    </p>
                    <div className="pt-2 space-y-1.5 font-mono text-xs border-t border-[#2a2a2a]">
                      <div className="flex justify-between text-[#888884]">
                        <span>AVAILABLE:</span>
                        <span className="text-[#e5e2e1]">{r.availableGen.toLocaleString()} GEN</span>
                      </div>
                      <div className="flex justify-between text-[#888884]">
                        <span>RESERVED:</span>
                        <span className="text-[#ff5719]">{r.reservedGen.toLocaleString()} GEN</span>
                      </div>
                      <div className="flex justify-between text-[#888884]">
                        <span>GRANT CAP:</span>
                        <span className="text-[#e5e2e1]">{r.capPerProposalGen.toLocaleString()} GEN</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-[#2a2a2a] font-mono text-xs">
                    <span className="text-[#888884]">{r.totalVoters} MEMBERS</span>
                    <Link
                      to={`/rounds/${r.id}`}
                      className="text-[#ff5719] font-bold hover:underline flex items-center gap-1"
                    >
                      VIEW CHARTER ↗
                    </Link>
                  </div>
                </div>
              ))
            )}

            {/* Realtime Consensus Vector Map */}
            <div className="bg-[#1c1b1b] border border-[#2a2a2a] p-6 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between font-mono text-xs pb-2 border-b border-[#2a2a2a]">
                  <span className="text-[#e5e2e1] uppercase font-bold">
                    REALTIME TOPOLOGY
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#00e599] animate-pulse"></span>
                </div>
                <h3 className="font-['Space_Grotesk'] text-base uppercase font-bold text-[#e5e2e1] mt-3">
                  Consensus Vector Map
                </h3>
                <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2]">
                  Deterministic routing from proposer submission to validator charter analysis and member signature quorum.
                </p>
              </div>

              {/* Graphic Radar Simulation */}
              <div className="py-4 flex justify-center">
                <svg className="w-36 h-36 text-[#ff5719]" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#2a2a2a" strokeWidth="1" />
                  <circle cx="60" cy="60" r="35" fill="none" stroke="#353534" strokeWidth="1" strokeDasharray="2 2" />
                  <circle cx="60" cy="60" r="18" fill="none" stroke="#ff5719" strokeWidth="1.5" />
                  <line x1="60" y1="10" x2="60" y2="110" stroke="#2a2a2a" strokeWidth="0.5" />
                  <line x1="10" y1="60" x2="110" y2="60" stroke="#2a2a2a" strokeWidth="0.5" />
                  <circle cx="60" cy="60" r="4" fill="#ff5719" />
                  <circle cx="85" cy="40" r="2.5" fill="#00e599" />
                  <circle cx="35" cy="75" r="2.5" fill="#00e599" />
                  <circle cx="78" cy="88" r="2.5" fill="#ffb800" />
                  <line x1="60" y1="60" x2="85" y2="40" stroke="#ff5719" strokeWidth="1" />
                  <line x1="60" y1="60" x2="35" y2="75" stroke="#ff5719" strokeWidth="1" />
                </svg>
              </div>

              <div className="flex justify-between items-center font-mono text-[10px] text-[#888884] pt-2 border-t border-[#2a2a2a]">
                <span>{isDesignPreview ? 'VALIDATOR NODES: PREVIEW 5/5' : 'VALIDATOR NODES: NOT PROBED HERE'}</span>
                <span>STATUS: {isDesignPreview ? 'PREVIEW' : error ? 'READ ERROR' : loading ? 'QUERYING' : 'READ OK'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM CALL TO ACTION BANNER */}
      <section className="w-full bg-[#1c1b1b] px-4 lg:px-10 py-16 border-b border-[#262626]">
        <div className="max-w-6xl mx-auto bg-[#141414] border border-[#2a2a2a] p-8 lg:p-12 flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="space-y-4 max-w-2xl">
            <span className="font-mono text-xs text-[#ff5719] uppercase tracking-wider font-bold">
              GUARANTEE SPECIFICATION // PARAGRAPH 1.04
            </span>
            <h3 className="font-['Space_Grotesk'] text-2xl lg:text-3xl uppercase text-[#e5e2e1] font-bold leading-tight">
              "Freeze the rules. Review each proposal against them. Let members vote. Pay only what the round approved."
            </h3>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
              Decentralized treasuries historically suffer from scope drift, executive discretion, and multi-sig fatigue. CharterFlow automates validation: if a proposal requests capital outside defined purposes, GenLayer validators reject it before a single voter spends gas.
            </p>
          </div>
          <div className="flex flex-col gap-4 w-full sm:w-auto">
            <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] font-mono text-xs space-y-1.5 text-[#c8c6c2]">
              <div className="text-[#ff5719] font-bold uppercase pb-1 border-b border-[#2a2a2a]">
                ROUND GENESIS WORKFLOW
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#ff5719]">■</span> Connect GenLayer Testnet Wallet
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#ff5719]">■</span> Write Plain-Language Charter Clauses
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#ff5719]">■</span> Deposit Test GEN into Escrow
              </div>
            </div>
            <Link
              to="/rounds/new"
              className="px-6 py-3.5 bg-[#ff5719] text-[#521300] font-['Space_Grotesk'] text-sm uppercase font-bold tracking-wider text-center hover:bg-white hover:text-black transition-all"
            >
              LAUNCH NEW ROUND PROTOCOL ↗
            </Link>
          </div>
        </div>
      </section>

      {/* METRIC BOTTOM FOOTER RIBBON */}
      <div className="w-full bg-[#0e0e0e] px-4 lg:px-10 py-3 flex flex-wrap items-center justify-between gap-4 font-mono text-[10px] text-[#888884] border-b border-[#262626]">
        <div className="flex items-center gap-3">
          <Barcode width={70} height={12} color="#888884" />
          <span>CONSENSUS: MULTI_NODE_VALIDATOR</span>
        </div>
        <div>VALIDATION: GENLAYER INTELLIGENT CONTRACTS</div>
        <div className="hidden sm:inline">CHAIN ID: 61997</div>
        <div className="text-[#ff5719] font-bold">DEPLOYED CORE // STAGE 2 UNVERIFIED</div>
      </div>
    </div>
  );
};
