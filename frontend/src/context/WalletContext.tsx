import React, { createContext, useContext, useEffect, useState } from 'react';

export const GENLAYER_STUDIO_NEXT = {
  chainId: 61997,
  chainIdHex: '0xf22d',
  chainName: 'GenLayer Studio Next Testnet',
  rpcUrl: 'https://studio-next.genlayer.com/api',
  explorerUrl: 'https://explorer-studio-dev.genlayer.com/',
  nativeCurrency: {
    name: 'test GEN',
    symbol: 'GEN',
    decimals: 18,
  },
};

interface WalletContextType {
  account: string | null;
  chainId: number | null;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  balanceGen: string | null;
  error: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchToStudioNext: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  account: null,
  chainId: null,
  isConnected: false,
  isCorrectNetwork: false,
  isConnecting: false,
  balanceGen: null,
  error: null,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  switchToStudioNext: async () => {},
});

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balanceGen, setBalanceGen] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ethereum = typeof window !== 'undefined' ? (window as any).ethereum : undefined;

  const updateBalance = async (userAddress: string) => {
    if (!ethereum) return;
    try {
      const currentChainHex = await ethereum.request({ method: 'eth_chainId' });
      const currentId = parseInt(currentChainHex, 16);
      // Strictly verify Chain ID 61997 before displaying balance as test GEN
      if (currentId !== GENLAYER_STUDIO_NEXT.chainId) {
        setBalanceGen(null);
        return;
      }

      const balanceHex = await ethereum.request({
        method: 'eth_getBalance',
        params: [userAddress, 'latest'],
      });

      if (balanceHex) {
        const wei = BigInt(balanceHex);
        if (wei === 0n) {
          setBalanceGen('0.00');
        } else {
          const whole = wei / (10n ** 18n);
          const remainderWei = wei % (10n ** 18n);
          const fourDec = remainderWei / (10n ** 14n);
          if (whole === 0n && fourDec === 0n) {
            setBalanceGen('< 0.0001');
          } else {
            const formatted = `${whole}.${fourDec.toString().padStart(4, '0')}`;
            setBalanceGen(formatted);
          }
        }
      }
    } catch {
      setBalanceGen(null);
    }
  };

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length > 0) {
      setAccount(accounts[0]);
      setError(null);
      updateBalance(accounts[0]);
    } else {
      setAccount(null);
      setBalanceGen(null);
    }
  };

  const handleChainChanged = (chainHex: string) => {
    const id = parseInt(chainHex, 16);
    setChainId(id);
    if (account) {
      updateBalance(account);
    } else {
      setBalanceGen(null);
    }
  };

  useEffect(() => {
    if (!ethereum) return;

    ethereum
      .request({ method: 'eth_chainId' })
      .then((hex: string) => {
        const id = parseInt(hex, 16);
        setChainId(id);
        ethereum
          .request({ method: 'eth_accounts' })
          .then((accounts: string[]) => {
            if (accounts.length > 0) {
              setAccount(accounts[0]);
              if (id === GENLAYER_STUDIO_NEXT.chainId) {
                updateBalance(accounts[0]);
              }
            }
          })
          .catch(() => {});
      })
      .catch(() => {});

    ethereum.on?.('accountsChanged', handleAccountsChanged);
    ethereum.on?.('chainChanged', handleChainChanged);

    return () => {
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const connectWallet = async () => {
    if (!ethereum) {
      setError('No EIP-1193 compatible wallet detected. Please install MetaMask or a web3 provider.');
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const hexChain = await ethereum.request({ method: 'eth_chainId' });
      const id = parseInt(hexChain, 16);
      setChainId(id);
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0]);
        if (id === GENLAYER_STUDIO_NEXT.chainId) {
          await updateBalance(accounts[0]);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  /**
   * Honest Session Clearing:
   * EIP-1193 providers (MetaMask, Rabby) remain authorized in the browser extension.
   * Clearing session removes local React application state without claiming to sever the extension's provider connection.
   */
  const disconnectWallet = () => {
    setAccount(null);
    setBalanceGen(null);
  };

  const switchToStudioNext = async () => {
    if (!ethereum) return;
    setError(null);
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: GENLAYER_STUDIO_NEXT.chainIdHex }],
      });
    } catch (switchError: any) {
      // 4902 indicates chain has not been added to wallet
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: GENLAYER_STUDIO_NEXT.chainIdHex,
                chainName: GENLAYER_STUDIO_NEXT.chainName,
                rpcUrls: [GENLAYER_STUDIO_NEXT.rpcUrl],
                blockExplorerUrls: [GENLAYER_STUDIO_NEXT.explorerUrl],
                nativeCurrency: GENLAYER_STUDIO_NEXT.nativeCurrency,
              },
            ],
          });
        } catch (addError: any) {
          setError(addError?.message || 'Could not add Studio Next network');
        }
      } else {
        setError(switchError?.message || 'Could not switch to Studio Next network');
      }
    }
  };

  const isConnected = !!account;
  const isCorrectNetwork = chainId === GENLAYER_STUDIO_NEXT.chainId;

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        isConnected,
        isCorrectNetwork,
        isConnecting,
        balanceGen,
        error,
        connectWallet,
        disconnectWallet,
        switchToStudioNext,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => useContext(WalletContext);
