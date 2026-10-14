import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyWalletError,
  collectInjectedProviders,
  formatWalletBalanceLabel,
  readWalletSession,
  selectWalletByRdns,
  shouldAdoptAuthorizedAccounts,
  writeWalletSession,
  type DiscoveredWallet,
  type Eip1193Provider,
} from '../services/eip1193';

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
  balanceReadFailed: boolean;
  error: string | null;
  wallets: DiscoveredWallet[];
  selectedWallet: DiscoveredWallet | null;
  provider: Eip1193Provider | null;
  walletInstalled: boolean;
  needsWalletChoice: boolean;
  connectWallet: (rdns?: string) => Promise<void>;
  disconnectWallet: () => void;
  switchToStudioNext: () => Promise<void>;
  balanceLabel: string;
}

const WalletContext = createContext<WalletContextType>({
  account: null,
  chainId: null,
  isConnected: false,
  isCorrectNetwork: false,
  isConnecting: false,
  balanceGen: null,
  balanceReadFailed: false,
  error: null,
  wallets: [],
  selectedWallet: null,
  provider: null,
  walletInstalled: false,
  needsWalletChoice: false,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  switchToStudioNext: async () => {},
  balanceLabel: 'NO WALLET',
});

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balanceGen, setBalanceGen] = useState<string | null>(null);
  const [balanceReadFailed, setBalanceReadFailed] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [selectedRdns, setSelectedRdns] = useState<string | undefined>(
    () => readWalletSession(getLocalStorage())?.rdns
  );
  const eip6963 = useRef<DiscoveredWallet[]>([]);
  const accountRef = useRef<string | null>(null);
  accountRef.current = account;

  const refreshDiscovery = useCallback(() => {
    const win = typeof window === 'undefined' ? null : (window as Window & { ethereum?: Eip1193Provider });
    const discovered = collectInjectedProviders({
      ethereum: win?.ethereum,
      discovered: eip6963.current,
    });
    setWallets(discovered);
    return discovered;
  }, []);

  const selectedWallet = useMemo(
    () => selectWalletByRdns(wallets, selectedRdns),
    [wallets, selectedRdns]
  );
  const provider = selectedWallet?.provider || null;

  const updateBalance = useCallback(async (userAddress: string, activeProvider: Eip1193Provider) => {
    try {
      const currentChainHex = await activeProvider.request({ method: 'eth_chainId' });
      const currentId = parseInt(String(currentChainHex), 16);
      if (currentId !== GENLAYER_STUDIO_NEXT.chainId) {
        setBalanceGen(null);
        setBalanceReadFailed(false);
        return;
      }
      const balanceHex = await activeProvider.request({
        method: 'eth_getBalance',
        params: [userAddress, 'latest'],
      });
      if (balanceHex === undefined || balanceHex === null || balanceHex === '') {
        setBalanceGen(null);
        setBalanceReadFailed(true);
        return;
      }
      const wei = BigInt(String(balanceHex));
      setBalanceReadFailed(false);
      if (wei === 0n) {
        setBalanceGen('0.00');
        return;
      }
      const whole = wei / 10n ** 18n;
      const remainderWei = wei % 10n ** 18n;
      const fourDec = remainderWei / 10n ** 14n;
      if (whole === 0n && fourDec === 0n) {
        setBalanceGen('< 0.0001');
      } else {
        setBalanceGen(`${whole}.${fourDec.toString().padStart(4, '0')}`);
      }
    } catch {
      setBalanceGen(null);
      setBalanceReadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const info = detail?.info;
      const announced = detail?.provider;
      if (!info || !announced) return;
      const wallet: DiscoveredWallet = {
        uuid: String(info.uuid || info.rdns || `eip6963-${eip6963.current.length}`),
        name: String(info.name || 'Injected wallet'),
        rdns: String(info.rdns || info.uuid || `eip6963.${eip6963.current.length}`),
        provider: announced,
      };
      eip6963.current = [...eip6963.current.filter((item) => item.rdns !== wallet.rdns), wallet];
      refreshDiscovery();
    };

    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    refreshDiscovery();
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    };
  }, [refreshDiscovery]);

  useEffect(() => {
    if (!provider) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      if (list.length > 0) {
        setAccount(list[0]);
        setError(null);
        updateBalance(list[0], provider);
      } else {
        setAccount(null);
        setBalanceGen(null);
        setBalanceReadFailed(false);
      }
    };

    const handleChainChanged = (chainHex: unknown) => {
      const id = parseInt(String(chainHex), 16);
      setChainId(Number.isFinite(id) ? id : null);
      const current = accountRef.current;
      if (current) {
        updateBalance(current, provider);
      } else {
        setBalanceGen(null);
      }
    };

    provider.on?.('accountsChanged', handleAccountsChanged);
    provider.on?.('chainChanged', handleChainChanged);

    const session = readWalletSession(getLocalStorage());
    provider
      .request({ method: 'eth_chainId' })
      .then((hex) => {
        const id = parseInt(String(hex), 16);
        setChainId(Number.isFinite(id) ? id : null);
        if (!shouldAdoptAuthorizedAccounts(session)) {
          return;
        }
        return provider.request({ method: 'eth_accounts' }).then((accounts) => {
          const list = Array.isArray(accounts) ? accounts.map(String) : [];
          if (list.length > 0) {
            setAccount(list[0]);
            if (id === GENLAYER_STUDIO_NEXT.chainId) {
              updateBalance(list[0], provider);
            }
          }
        });
      })
      .catch(() => {});

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [provider, updateBalance]);

  const connectWallet = async (rdns?: string) => {
    const discovered = refreshDiscovery();
    if (discovered.length === 0) {
      setError('No injected EIP-1193 wallet detected. Install a browser wallet such as MetaMask, then return here. CharterFlow never asks for a seed phrase or private key.');
      return;
    }
    const chosen = selectWalletByRdns(discovered, rdns || selectedRdns);
    if (!chosen) {
      setError('Multiple injected wallets detected. Choose one wallet to connect. The app does not claim support for wallets it cannot see as EIP-1193 providers.');
      return;
    }
    setSelectedRdns(chosen.rdns);
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = await chosen.provider.request({ method: 'eth_requestAccounts' });
      const hexChain = await chosen.provider.request({ method: 'eth_chainId' });
      const id = parseInt(String(hexChain), 16);
      setChainId(Number.isFinite(id) ? id : null);
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      if (list.length > 0) {
        setAccount(list[0]);
        writeWalletSession(getLocalStorage(), { status: 'connected', rdns: chosen.rdns });
        if (id === GENLAYER_STUDIO_NEXT.chainId) {
          await updateBalance(list[0], chosen.provider);
        } else {
          setBalanceGen(null);
        }
      }
    } catch (err: unknown) {
      const classified = classifyWalletError(err);
      setError(classified.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setBalanceGen(null);
    setBalanceReadFailed(false);
    setError(null);
    writeWalletSession(getLocalStorage(), { status: 'cleared', rdns: selectedRdns });
  };

  const switchToStudioNext = async () => {
    if (!provider) {
      setError('No injected wallet selected. Connect a wallet before adding or switching to chain 61997.');
      return;
    }
    setError(null);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: GENLAYER_STUDIO_NEXT.chainIdHex }],
      });
    } catch (switchError: unknown) {
      const classified = classifyWalletError(switchError);
      if (classified.code === 4902) {
        try {
          await provider.request({
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
        } catch (addError: unknown) {
          setError(classifyWalletError(addError).message);
        }
      } else {
        setError(classified.message);
      }
    }
  };

  const isConnected = !!account;
  const isCorrectNetwork = chainId === GENLAYER_STUDIO_NEXT.chainId;
  const balanceLabel = formatWalletBalanceLabel({
    isConnected,
    isCorrectNetwork,
    balanceGen,
    balanceReadFailed,
  });

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        isConnected,
        isCorrectNetwork,
        isConnecting,
        balanceGen,
        balanceReadFailed,
        error,
        wallets,
        selectedWallet,
        provider,
        walletInstalled: wallets.length > 0,
        needsWalletChoice: wallets.length > 1 && !account,
        connectWallet,
        disconnectWallet,
        switchToStudioNext,
        balanceLabel,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => useContext(WalletContext);
