import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet, GENLAYER_STUDIO_NEXT } from '../context/WalletContext';

export const TransactionNetworkStatesPage: React.FC = () => {
  const {
    chainId,
    isConnected,
    isCorrectNetwork,
    connectWallet,
    switchToStudioNext,
  } = useWallet();


  const [activeMatrixState, setActiveMatrixState] = useState<'A' | 'B' | 'C' | 'D' | 'ALL'>('ALL');
  const [copiedRpc, setCopiedRpc] = useState(false);
  const [modalLog, setModalLog] = useState<string | null>(null);

  const handleCopyRpc = () => {
    navigator.clipboard.writeText(GENLAYER_STUDIO_NEXT.rpcUrl);
    setCopiedRpc(true);
    setTimeout(() => setCopiedRpc(false), 2000);
  };

  const currentChainDisplay = chainId ? `Chain ID ${chainId}` : 'Disconnected';

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      {/* Diagnostic Header */}
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-[#888884]">
          <div className="flex items-center gap-2">
            <span className="text-[#ff5719] font-bold">DIAGNOSTIC MATRIX</span>
            <span className="text-[#383838]">/</span>
            <span>RUNTIME OBSERVER // CF-SPEC-0041.GEN</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#ff5719]"></span>
              <span>TARGET NODE: GENLAYER STUDIO NEXT (#61997)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Title Section */}
      <section className="w-full px-4 lg:px-10 pt-10 pb-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-3">
          <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl uppercase font-bold text-[#e5e2e1]">
            Transaction Telemetry & Network States
          </h1>
          <p className="font-['Hanken_Grotesk'] text-sm sm:text-base text-[#c8c6c2] max-w-3xl">
            Contract lifecycle state transitions, wallet guardrails, simulated verification screens, and fault-recovery protocols on GenLayer Studio Next.
          </p>
        </div>
      </section>

      {/* Network Mismatch Diagnostic Alert */}
      <section className="w-full px-4 lg:px-10 py-6 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto bg-[#1c1b1b] border border-[#ff3344] p-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-xs text-[#ff3344] font-bold">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                <span className="uppercase">
                  {isConnected && !isCorrectNetwork
                    ? 'LIVE NETWORK MISMATCH DETECTED'
                    : isConnected && isCorrectNetwork
                    ? 'NETWORK SYNCHRONIZED: CHAIN 61997'
                    : 'NETWORK STANDBY: GENLAYER STUDIO NEXT'}
                </span>
              </div>
              <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
                {isConnected && !isCorrectNetwork
                  ? `Your injected wallet is currently pointed to ${currentChainDisplay}. CharterFlow operates exclusively on GenLayer Studio Next Testnet (Chain ID 61997). Please switch your provider to interact with contract treasuries.`
                  : isConnected && isCorrectNetwork
                  ? 'Your wallet provider is correctly connected to GenLayer Studio Next (Chain ID 61997). RPC endpoints and contract queries are operational.'
                  : 'CharterFlow executes all intelligent contracts and AI validator consensus on GenLayer Studio Next Testnet (Chain ID 61997). Connect an EIP-1193 wallet to synchronize.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
              {isConnected && !isCorrectNetwork ? (
                <button
                  type="button"
                  onClick={switchToStudioNext}
                  className="px-6 py-3 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black font-bold uppercase tracking-wider flex items-center gap-2 transition-colors"
                >
                  <span>SWITCH TO CHAIN 61997</span>
                  <span className="material-symbols-outlined text-[16px]">north_east</span>
                </button>
              ) : isConnected ? (
                <span className="px-6 py-3 bg-[#201f1f] text-[#00e599] border border-[#2a2a2a] font-bold uppercase">
                  On chain 61997
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void connectWallet()}
                  className="px-6 py-3 bg-[#ff5719] text-[#521300] hover:bg-white hover:text-black font-bold uppercase tracking-wider flex items-center gap-2 transition-colors"
                >
                  <span>CONNECT WALLET</span>
                  <span className="material-symbols-outlined text-[16px]">north_east</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyRpc}
                className="px-4 py-3 bg-[#201f1f] text-[#c8c6c2] hover:text-white border border-[#2a2a2a] flex items-center gap-1.5 uppercase transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">
                  {copiedRpc ? 'check' : 'content_copy'}
                </span>
                <span>{copiedRpc ? 'COPIED!' : 'RPC: studio-next.genlayer.com/api'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#2a2a2a] font-mono text-[11px] text-[#888884]">
            <div className="flex items-center gap-3">
              <span>
                CLIENT_STATUS:{' '}
                <span className={isCorrectNetwork ? 'text-[#00e599]' : 'text-[#ff3344]'}>
                  {isConnected
                    ? isCorrectNetwork
                      ? 'SYNCHRONIZED_STUDIO_NEXT'
                      : 'MISCONFIGURED_PROVIDER'
                    : 'DISCONNECTED'}
                </span>
              </span>
              <span>|</span>
              <span>AUTO_RECOVERY: STANDBY</span>
            </div>
            <div>EXPLORER: explorer-studio-dev.genlayer.com</div>
          </div>
        </div>
      </section>

      {/* 4-Stage Transaction Lifecycle Matrix */}
      <section className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#262626] font-mono text-xs">
            <div>
              <span className="text-[#888884] block text-[10px] uppercase">
                [DESIGN PREVIEW // SIMULATED LIFECYCLE STATES] /// INTERFACE DEMONSTRATION
              </span>
              <h2 className="font-['Space_Grotesk'] text-2xl uppercase font-bold text-[#e5e2e1]">
                4-Stage Transaction Lifecycle Matrix
              </h2>
            </div>

            <div className="flex items-center gap-1 bg-[#1c1b1b] border border-[#2a2a2a] p-1">
              <span className="text-[#888884] px-2 text-[10px] uppercase">FILTER STAGE:</span>
              {(['ALL', 'A', 'B', 'C', 'D'] as const).map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setActiveMatrixState(stage)}
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase transition-colors ${
                    activeMatrixState === stage
                      ? 'bg-[#ff5719] text-[#521300]'
                      : 'text-[#c8c6c2] hover:text-white'
                  }`}
                >
                  {stage === 'ALL' ? 'ALL 4 STAGES' : `STAGE 0${stage === 'A' ? '1' : stage === 'B' ? '2' : stage === 'C' ? '3' : '4'}`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CARD A: STAGE 01 PRE-FLIGHT */}
            {(activeMatrixState === 'ALL' || activeMatrixState === 'A') && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] flex flex-col justify-between font-mono text-xs">
                <div className="bg-[#0e0e0e] px-5 py-3 flex items-center justify-between border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2 text-[#ff5719] font-bold">
                    <span className="w-2 h-2 rounded-full bg-[#ff5719]"></span>
                    <span>STAGE 01 // PRE-FLIGHT AUTHORIZATION</span>
                  </div>
                  <span className="text-[#888884] text-[10px]">[STG-SIG-REQ]</span>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      CONFIRM TRANSACTION // NOMINATE PROPOSAL
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] mt-1">
                      Review parameters before cryptographic signing to avoid state revert on Chain ID 61997.
                    </p>
                  </div>

                  <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-[#888884]">TARGET CONTRACT:</span>
                      <span className="text-[#e5e2e1]">[DESIGN PREVIEW] 0x8a92...38f1</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#888884]">EXECUTION METHOD:</span>
                      <span className="text-[#ff5719] font-bold">
                        nominateProposal(recipient, 5000 GEN)
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1 text-[11px]">
                    <div className="flex justify-between text-[#888884]">
                      <span>BASE GAS (L1 EQUIV):</span>
                      <span className="text-[#e5e2e1]">0.0031 test GEN</span>
                    </div>
                    <div className="flex justify-between text-[#888884]">
                      <span>INTELLIGENT VM EXECUTION:</span>
                      <span className="text-[#e5e2e1]">0.0018 test GEN</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1 border-t border-[#222222]">
                      <span className="text-[#ff5719]">MAX TELEMETRY CAP FEE:</span>
                      <span className="text-[#e5e2e1]">0.0049 test GEN</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[#0e0e0e] border-t border-[#2a2a2a] flex items-center justify-between gap-3">
                  <span className="text-[#888884] text-[10px]">REJECT (ESC)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setModalLog('PRE-FLIGHT SIMULATION: Verified local cryptographic payload signature.')
                    }
                    className="px-5 py-2.5 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
                  >
                    SIGN & BROADCAST ↗
                  </button>
                </div>
              </div>
            )}

            {/* CARD B: STAGE 02 CONSENSUS IN FLIGHT */}
            {(activeMatrixState === 'ALL' || activeMatrixState === 'B') && (
              <div className="bg-[#1c1b1b] border border-[#2a2a2a] flex flex-col justify-between font-mono text-xs">
                <div className="bg-[#0e0e0e] px-5 py-3 flex items-center justify-between border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2 text-[#ffb800] font-bold">
                    <span className="w-2 h-2 rounded-full bg-[#ffb800] animate-pulse"></span>
                    <span>STAGE 02 // VALIDATOR SYNCHRONIZATION</span>
                  </div>
                  <span className="text-[#ffb800] text-[10px]">420ms IN-FLIGHT</span>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      CONSENSUS IN FLIGHT // OPTIMISTIC PROOF
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] mt-1">
                      Simulated validator synchronization demonstrating multi-node natural-language heuristic evaluation.
                    </p>
                  </div>

                  <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-[#888884]">OBSERVED BLOCK:</span>
                      <span className="text-[#e5e2e1]">#1,849,248</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#888884]">INTENT HASH:</span>
                      <span className="text-[#ff5719]">[DESIGN PREVIEW] 0x77aa...cb29</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#888884]">CONSENSUS MODEL:</span>
                      <span className="text-[#e5e2e1]">GEN-LLM-CONSENSUS-V2</span>
                    </div>
                  </div>

                  {/* Resolution Tracker */}
                  <div className="space-y-1.5 pt-1 text-[11px]">
                    <span className="text-[#888884] text-[10px] uppercase font-bold block">
                      VALIDATOR QUORUM RESOLUTION TRACKER:
                    </span>
                    <div className="flex justify-between p-2 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="text-[#e5e2e1]">NODE #01 (val.eu-central.gen)</span>
                      <span className="text-[#00e599]">RECEIVED & COMPILED (14ms)</span>
                    </div>
                    <div className="flex justify-between p-2 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="text-[#e5e2e1]">NODE #02 (val.us-east.gen)</span>
                      <span className="text-[#00e599]">SEMANTIC AST PARSED (28ms)</span>
                    </div>
                    <div className="flex justify-between p-2 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="text-[#e5e2e1]">NODE #03 (val.ap-southeast.gen)</span>
                      <span className="text-[#ffb800]">AWAITING QUORUM (2 of 5 ACK)</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[#0e0e0e] border-t border-[#2a2a2a] flex items-center justify-between text-[#888884] text-[11px]">
                  <span>TX_PIPE: [DESIGN PREVIEW] 0x77aa...cb29</span>
                  <span className="text-[#ffb800] animate-pulse">SYNCHRONIZING...</span>
                </div>
              </div>
            )}

            {/* CARD C: STAGE 03 EXECUTION CONFIRMED */}
            {(activeMatrixState === 'ALL' || activeMatrixState === 'C') && (
              <div className="bg-[#1c1b1b] border border-[#00e599]/40 flex flex-col justify-between font-mono text-xs">
                <div className="bg-[#0e0e0e] px-5 py-3 flex items-center justify-between border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2 text-[#00e599] font-bold">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>STAGE 03 // IMMUTABLE SETTLEMENT</span>
                  </div>
                  <span className="text-[#00e599] text-[10px]">[200_FINALIZED]</span>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      EXECUTION CONFIRMED // STATE: NOMINATED
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] mt-1">
                      Demonstration state transition representing completed nomination acceptance upon contract deployment.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="text-[#888884] text-[10px] uppercase block">BLOCK HEIGHT</span>
                      <span className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1] block mt-1">
                        1,849,252
                      </span>
                    </div>
                    <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="text-[#888884] text-[10px] uppercase block">STATE NONCE</span>
                      <span className="font-['Space_Grotesk'] text-base font-bold text-[#e5e2e1] block mt-1">
                        0x88F2
                      </span>
                    </div>
                    <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a]">
                      <span className="text-[#888884] text-[10px] uppercase block">GAS CONSUMED</span>
                      <span className="font-['Space_Grotesk'] text-base font-bold text-[#00e599] block mt-1">
                        0.0042 GEN
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1.5 text-[11px]">
                    <div className="flex justify-between text-[#888884]">
                      <span>VERIFIED TREASURY MUTATION:</span>
                      <span className="text-[#00e599] font-bold">STATUS: COMMITTED</span>
                    </div>
                    <div className="flex justify-between text-[#c8c6c2]">
                      <span>AVAILABLE POOL: 27,500.00 GEN</span>
                      <span className="text-[#ff3344]">- 5,000.00 GEN</span>
                    </div>
                    <div className="flex justify-between text-[#c8c6c2]">
                      <span>TREASURY RESERVATION:</span>
                      <span className="text-[#00e599] font-bold">+ 5,000.00 GEN ALLOCATED</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[#0e0e0e] border-t border-[#2a2a2a] flex items-center justify-between gap-3">
                  <a
                    href="https://explorer-studio-dev.genlayer.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#c8c6c2] hover:text-[#ff5719] flex items-center gap-1 text-[11px]"
                  >
                    <span>STUDIO NEXT EXPLORER</span>
                    <span>↗</span>
                  </a>
                  <Link
                    to="/proposals/prp-094-01"
                    className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
                  >
                    PROPOSAL #094-01 ↗
                  </Link>
                </div>
              </div>
            )}

            {/* CARD D: STAGE 04 TRANSACTION FAILED */}
            {(activeMatrixState === 'ALL' || activeMatrixState === 'D') && (
              <div className="bg-[#1c1b1b] border border-[#ff3344]/50 flex flex-col justify-between font-mono text-xs">
                <div className="bg-[#0e0e0e] px-5 py-3 flex items-center justify-between border-b border-[#2a2a2a]">
                  <div className="flex items-center gap-2 text-[#ff3344] font-bold">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    <span>STAGE 04 // FAULT ISOLATION & RECOVERY</span>
                  </div>
                  <span className="text-[#ff3344] text-[10px]">[ERR_CAP_EXCEEDED]</span>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-['Space_Grotesk'] text-lg uppercase font-bold text-[#e5e2e1]">
                      TRANSACTION FAILED // INTEL CONTRACT EXCEPTION
                    </h3>
                    <p className="font-['Hanken_Grotesk'] text-xs text-[#c8c6c2] mt-1">
                      Intelligent Contract state assertion rejected the payload during optimistic semantic evaluation.
                    </p>
                  </div>

                  <div className="p-4 bg-[#2a1114] border border-[#ff3344]/40 space-y-1 text-[11px]">
                    <div className="flex justify-between text-[#ff3344] font-bold text-[10px]">
                      <span>REASON: ERR_CAP_EXCEEDED</span>
                      <span>ROUND_POLICY_BREACH</span>
                    </div>
                    <p className="text-[#ffdad6] leading-relaxed">
                      Max grant allocation per proposal in Round #094 is capped at 5,000.00 test GEN; requested 7,500.00 test GEN.
                    </p>
                  </div>

                  <div className="p-3 bg-[#0e0e0e] border border-[#2a2a2a] space-y-1 text-[11px]">
                    <div className="flex justify-between text-[#888884]">
                      <span>MECHANICAL ROLLBACK STATUS:</span>
                      <span className="text-[#00e599] font-bold">CLEAN ROLLBACK</span>
                    </div>
                    <div className="flex justify-between text-[#888884]">
                      <span>TREASURY IMPACT:</span>
                      <span className="text-[#e5e2e1]">0.00 GEN DEDUCTED</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[#0e0e0e] border-t border-[#2a2a2a] flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setModalLog('ERROR LOG EXPORT: Captured state rollback snapshot #ERR_CAP_EXCEEDED.')
                    }
                    className="text-[#c8c6c2] hover:text-white uppercase text-[11px]"
                  >
                    EXPORT LOG JSON
                  </button>
                  <Link
                    to="/rounds/round-094-sdk/nominate"
                    className="px-4 py-2 bg-[#201f1f] text-[#ff5719] border border-[#ff5719] font-bold uppercase hover:bg-[#ff5719] hover:text-[#521300] transition-colors"
                  >
                    ADJUST & RETRY ↗
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* No Active Testnet Session Detected */}
      <section className="w-full px-4 lg:px-10 py-12 bg-[#0e0e0e] border-b border-[#262626]">
        <div className="max-w-7xl mx-auto bg-[#141414] border border-[#2a2a2a] p-8 lg:p-10 flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="space-y-3 max-w-xl font-mono text-xs">
            <span className="text-[#888884] block text-[10px] uppercase font-bold">
              STATE ISOLATION // ZERO-CREDENTIAL STANDBY
            </span>
            <h3 className="font-['Space_Grotesk'] text-2xl uppercase font-bold text-[#e5e2e1]">
              GenLayer Studio Next Testnet Session
            </h3>
            <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
              Connect an EVM-compatible wallet configured for GenLayer Studio Next (Chain ID 61997) or request a test token allocation from the automated drip faucet.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto font-mono text-xs">
            <button
              type="button"
              onClick={() => void connectWallet()}
              className="w-full sm:w-auto px-6 py-3.5 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
            >
              CONNECT TESTNET WALLET
            </button>
            <a
              href="https://studio-next.genlayer.com/"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-6 py-3.5 bg-[#201f1f] text-[#e5e2e1] hover:text-white border border-[#2a2a2a] font-bold uppercase text-center transition-colors"
            >
              [+ GET TEST GEN FAUCET]
            </a>
          </div>
        </div>
      </section>

      {/* Modal Dialog */}
      {modalLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-[#1c1b1b] border border-[#ff5719] max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-[#2a2a2a]">
              <span className="text-[#ff5719] font-bold uppercase">DIAGNOSTIC LOG</span>
              <button
                type="button"
                onClick={() => setModalLog(null)}
                className="text-[#888884] hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-[#c8c6c2] leading-relaxed">{modalLog}</p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setModalLog(null)}
                className="px-4 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black"
              >
                DISMISS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
