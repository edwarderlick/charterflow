import React from 'react';
import { useWallet } from '../context/WalletContext';

export const WalletSessionBanner: React.FC = () => {
  const {
    error,
    wallets,
    selectedWallet,
    isConnected,
    isCorrectNetwork,
    isConnecting,
    connectWallet,
    switchToStudioNext,
    walletInstalled,
    needsWalletChoice,
  } = useWallet();

  if (!error && !needsWalletChoice && !(isConnected && !isCorrectNetwork) && walletInstalled) {
    return null;
  }

  return (
    <div className="w-full bg-[#1c1b1b] border-b border-[#2a2a2a] px-4 lg:px-10 py-2 font-mono text-[11px] space-y-2">
      {!walletInstalled && (
        <p className="text-[#ffb800]">
          No injected EIP-1193 wallet detected. You can still explore live rounds without connecting. To transact, install a browser wallet (for example MetaMask). CharterFlow never asks for a seed phrase or private key.
        </p>
      )}
      {needsWalletChoice && (
        <div className="flex flex-wrap items-center gap-2 text-[#e5e2e1]">
          <span className="text-[#ffb800] font-bold uppercase">Multiple injected wallets</span>
          {wallets.map((wallet) => (
            <button
              key={wallet.rdns}
              type="button"
              onClick={() => connectWallet(wallet.rdns)}
              className="px-2 py-1 bg-[#ff5719] text-[#521300] font-bold uppercase"
            >
              Use {wallet.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[#ff3344]">{error}</p>}
      {isConnected && !isCorrectNetwork && (
        <div className="flex flex-wrap items-center gap-2 text-[#ff3344]">
          <span>Connected wallet is not on chain 61997.</span>
          <button
            type="button"
            onClick={switchToStudioNext}
            className="px-2 py-1 bg-[#ff5719] text-[#521300] font-bold uppercase"
          >
            Switch / add Studio Next
          </button>
        </div>
      )}
      {isConnecting && <p className="text-[#ffb800]">Waiting for wallet approval…</p>}
      {selectedWallet && isConnected && (
        <p className="text-[#888884]">Provider: {selectedWallet.name}. Session is local only; CLEAR SESSION does not revoke the browser extension.</p>
      )}
    </div>
  );
};
