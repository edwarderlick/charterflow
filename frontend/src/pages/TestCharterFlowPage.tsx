import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { NETWORK_CONFIG, VERIFIED_DEPLOYMENT, LEGACY_FUNDED_ROUND, NEXT_RUNNER_COMPAT_SOURCE, LEGACY_UNPATCHABLE_CONTRACT } from '../config/network';
import { useWallet } from '../context/WalletContext';
import { VerifiedDeploymentLinks } from '../components/VerifiedDeploymentLinks';
import { STUDIO_NEXT_FAUCET } from '../services/eip1193';

export const TestCharterFlowPage: React.FC = () => {
  const {
    isConnected,
    account,
    isCorrectNetwork,
    chainId,
    balanceLabel,
    walletInstalled,
    selectedWallet,
    connectWallet,
    switchToStudioNext,
  } = useWallet();

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const el = document.getElementById(hash);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="flex flex-col w-full bg-[#131313]">
      <section className="w-full bg-[#0e0e0e] border-b border-[#262626] px-4 lg:px-10 py-3">
        <div className="max-w-5xl mx-auto font-mono text-[11px] text-[#888884] flex flex-wrap gap-3">
          <span className="text-[#ff5719] font-bold uppercase">Test CharterFlow</span>
          <span>Wallet-free browsing first. Writes need your own injected EIP-1193 wallet on chain 61997.</span>
        </div>
      </section>

      <section className="w-full px-4 lg:px-10 pt-10 pb-8 border-b border-[#262626]">
        <div className="max-w-5xl mx-auto space-y-4">
          <h1 className="font-['Space_Grotesk'] text-3xl sm:text-4xl uppercase font-bold text-[#e5e2e1]">
            Test CharterFlow
          </h1>
          <p className="font-['Hanken_Grotesk'] text-sm sm:text-base text-[#c8c6c2] max-w-3xl">
            A steward can inspect the live contract, the recorded create_round transaction, and this UI without connecting a wallet and without spending GEN. Connecting a wallet is only for actions that the deployed contract would actually accept from that address. UI gating is guidance; the contract is authoritative.
          </p>
          <VerifiedDeploymentLinks />
          <div className="font-mono text-[11px] text-[#c8c6c2] space-y-1">
            <p>
              Session: {isConnected && account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'disconnected'} ·{' '}
              {walletInstalled ? selectedWallet?.name || 'injected wallet present' : 'no injected wallet'} · chain{' '}
              {chainId ?? 'n/a'} · {balanceLabel}
            </p>
            <p className="text-[#888884]">
              CharterFlow never asks for a seed phrase or private key. CLEAR SESSION only clears this app&apos;s localStorage flag.
            </p>
          </div>
        </div>
      </section>

      <section id="browse" className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">1. Wallet-free live browsing</h2>
          <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
            Leave DESIGN PREVIEW off. Open Explore, a round, or a proposal without connecting. Public reads use the Studio Next RPC. If <code className="text-[#ffb596]">gen_call</code> returns JSON-RPC <code className="text-[#ffb596]">-32603</code>, the UI must show a read error, not “no rounds” and not fixture grants.
          </p>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <Link to="/rounds" className="px-3 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase">
              Explore rounds
            </Link>
            <Link
              to={`/rounds/${LEGACY_FUNDED_ROUND.pilotRoundId}`}
              className="px-3 py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] uppercase"
            >
              Recovery round (read only)
            </Link>
            <Link to="/how-it-works" className="px-3 py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] uppercase">
              How it works
            </Link>
            <Link to="/deploy-corrected" className="px-3 py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] uppercase">
              Deploy corrected core
            </Link>
          </div>
          <p className="font-mono text-[11px] text-[#888884]">
            Round {LEGACY_FUNDED_ROUND.pilotRoundId} is a locked recovery/refund case on {LEGACY_FUNDED_ROUND.contractAddress}. Do not nominate into it. Stage 2 genesis readback is INCONCLUSIVE.
          </p>
        </div>
      </section>

      <section id="connect" className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">
            2. Connect a compatible wallet and switch to Studio Next
          </h2>
          <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
            Supported path: a browser-injected EIP-1193 provider (EIP-6963 when several wallets are installed). The app does not claim WalletConnect, hardware-only, or mobile deep-link wallets it cannot see. Connection uses <code className="text-[#ffb596]">eth_requestAccounts</code>. Switching uses <code className="text-[#ffb596]">wallet_switchEthereumChain</code> / <code className="text-[#ffb596]">wallet_addEthereumChain</code> only after you click. The app will not auto-sign, auto-fund, or auto-switch.
          </p>
          <ul className="font-mono text-[11px] text-[#c8c6c2] space-y-1 list-disc pl-5">
            <li>RPC {NETWORK_CONFIG.rpcUrl}</li>
            <li>Chain 61997 (0xf22d)</li>
            <li>Explorer {NETWORK_CONFIG.explorerUrl}</li>
          </ul>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={() => void connectWallet()}
              className="px-3 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase"
            >
              {walletInstalled ? (isConnected ? 'Wallet connected' : 'Connect injected wallet') : 'No wallet detected'}
            </button>
            {isConnected && !isCorrectNetwork && (
              <button
                type="button"
                onClick={() => void switchToStudioNext()}
                className="px-3 py-2 bg-[#201f1f] text-[#ff3344] border border-[#ff3344] font-bold uppercase"
              >
                Switch / add Studio Next
              </button>
            )}
            <Link to="/network" className="px-3 py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] uppercase">
              Network diagnostics
            </Link>
          </div>
        </div>
      </section>

      <section id="faucet" className="w-full px-4 lg:px-10 py-10 border-b border-[#262626] scroll-mt-24">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">3. Test GEN for chain 61997</h2>
          <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">{STUDIO_NEXT_FAUCET.note}</p>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <a
              href={STUDIO_NEXT_FAUCET.studioWeb}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 bg-[#ff5719] text-[#521300] font-bold uppercase"
            >
              Studio account faucet ↗
            </a>
            <a
              href={STUDIO_NEXT_FAUCET.docs}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] uppercase"
            >
              Network docs ↗
            </a>
          </div>
          <p className="font-mono text-[11px] text-[#888884]">
            You do not need test GEN to inspect this project. Spend GEN only if you intend to send a real write after a successful live <code>gen_call</code> read.
          </p>
        </div>
      </section>

      <section id="roles" className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">4. Who can do what</h2>
          <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2]">
            One arbitrary connected wallet cannot vote or withdraw for someone else. Disabled buttons show the real reason. The contract still rejects unauthorized calls.
          </p>
          <div className="overflow-x-auto border border-[#2a2a2a]">
            <table className="w-full font-mono text-[11px] text-left">
              <thead className="bg-[#1c1b1b] text-[#ff5719]">
                <tr>
                  <th className="p-2">Action</th>
                  <th className="p-2">Who</th>
                  <th className="p-2">Notes</th>
                </tr>
              </thead>
              <tbody className="text-[#c8c6c2]">
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">create_round</td>
                  <td className="p-2">Any funded wallet on 61997</td>
                  <td className="p-2">1 GEN minimum deposit, roster, deadlines, fee estimate</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">nominate_proposal</td>
                  <td className="p-2">Listed committee member</td>
                  <td className="p-2">Blocked on recovery round {LEGACY_FUNDED_ROUND.pilotRoundId}</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">evaluate_charter_fit</td>
                  <td className="p-2">Anyone (paid)</td>
                  <td className="p-2">Permissionless, still a transaction while SUBMITTED</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">cast_vote</td>
                  <td className="p-2">Listed committee member</td>
                  <td className="p-2">Recipient on the committee is recused from their own proposal</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">withdraw_credit</td>
                  <td className="p-2">Named recipient only</td>
                  <td className="p-2">APPROVED credit; positive native-message fees</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">close_round / claim refund</td>
                  <td className="p-2">Round creator only</td>
                  <td className="p-2">After round_end; refund after CLOSED</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="p-2 text-[#e5e2e1]">settle_expired_proposal</td>
                  <td className="p-2">Anyone (paid)</td>
                  <td className="p-2">Shown only when the submission or voting deadline has actually passed</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="evidence" className="w-full px-4 lg:px-10 py-10 border-b border-[#262626]">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">5. Verified deployment and pilot evidence</h2>
          <VerifiedDeploymentLinks />
          <ul className="font-mono text-[11px] text-[#c8c6c2] space-y-1 list-disc pl-5">
            <li>
              Verified contract {VERIFIED_DEPLOYMENT.contractAddress} runs source {VERIFIED_DEPLOYMENT.sourceSha256} (deploy {VERIFIED_DEPLOYMENT.deployTransaction}). Do not deploy that source again. Legacy contract {LEGACY_UNPATCHABLE_CONTRACT.contractAddress} still runs {NEXT_RUNNER_COMPAT_SOURCE.unpatchableLiveSourceSha256} and cannot be patched. AI review and voting stay closed there. Its funded rounds stay visible for recovery.
            </li>
            <li>
              Public evidence: <code>docs/PUBLIC_EVIDENCE.md</code>
            </li>
            <li>Builder Portal is not submitted from this task.</li>
          </ul>
        </div>
      </section>

      <section id="limits" className="w-full px-4 lg:px-10 py-10">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="font-['Space_Grotesk'] text-xl uppercase font-bold text-[#e5e2e1]">6. Current limitations</h2>
          <ul className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] space-y-2 list-disc pl-5">
            <li>
              Studio Next <code className="font-mono text-[#ffb596]">gen_call</code> views currently fail with JSON-RPC{' '}
              <code className="font-mono text-[#ffb596]">-32603</code> (rollback). Live round ledgers cannot be proven from that path until GenLayer restores reads.
            </li>
            <li>
              Stage 2 for {LEGACY_FUNDED_ROUND.pilotRoundId} on the legacy contract remains INCONCLUSIVE. A finalized create_round receipt is not round-state proof.
            </li>
            <li>Do not treat DESIGN PREVIEW fixtures as chain evidence.</li>
            <li>No public Vercel origin is claimed until one is deployed after a localhost review.</li>
          </ul>
        </div>
      </section>
    </div>
  );
};
