import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyAccountsChanged,
  classifyWalletError,
  collectInjectedProviders,
  firstAccountFromProviderAccounts,
  formatWalletBalanceLabel,
  readWalletSession,
  selectWalletByRdns,
  shouldAdoptAsyncWalletResult,
  shouldAdoptAuthorizedAccounts,
  writeWalletSession,
  type AsyncWalletGate,
  type DiscoveredWallet,
  type Eip1193Provider,
  type WalletSession,
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
  const sessionStatusRef = useRef<WalletSession['status'] | null>(
    readWalletSession(getLocalStorage())?.status ?? null
  );
  const sessionEpochRef = useRef(0);
  const selectedRdnsRef = useRef<string | undefined>(selectedRdns);
  const selectedProviderRef = useRef<Eip1193Provider | null>(null);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  useEffect(() => {
    selectedRdnsRef.current = selectedRdns;
  }, [selectedRdns]);

  const currentWalletGate = useCallback(
    (requireConnected = false): AsyncWalletGate => ({
      epoch: sessionEpochRef.current,
      status: sessionStatusRef.current,
      rdns: selectedRdnsRef.current,
      provider: selectedProviderRef.current,
      requireConnected,
    }),
    []
  );

  const bumpWalletEpoch = useCallback(() => {
    sessionEpochRef.current += 1;
  }, []);

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
  useEffect(() => {
    selectedProviderRef.current = provider;
  }, [provider]);

  const updateBalance = useCallback(async (userAddress: string, activeProvider: Eip1193Provider) => {
    const started = currentWalletGate(true);
    const stillCurrent = () =>
      shouldAdoptAsyncWalletResult(started, currentWalletGate(true)) &&
      selectedProviderRef.current === activeProvider;
    try {
      const currentChainHex = await activeProvider.request({ method: 'eth_chainId' });
      if (!stillCurrent()) return;
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
      if (!stillCurrent()) return;
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
      if (!stillCurrent()) return;
      setBalanceGen(null);
      setBalanceReadFailed(true);
    }
  }, [currentWalletGate]);

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
      if (selectedProviderRef.current !== provider) {
        return;
      }
      const session: WalletSession | null =
        sessionStatusRef.current != null
          ? { status: sessionStatusRef.current }
          : readWalletSession(getLocalStorage());
      const next = applyAccountsChanged(session, accounts);
      if (!next.adopt) {
        return;
      }
      if (next.account) {
        setAccount(next.account);
        setError(null);
        updateBalance(next.account, provider);
      } else {
        setAccount(null);
        setBalanceGen(null);
        setBalanceReadFailed(false);
      }
    };

    const handleChainChanged = (chainHex: unknown) => {
      if (selectedProviderRef.current !== provider) {
        return;
      }
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

    const restoreStarted = currentWalletGate(true);
    provider
      .request({ method: 'eth_chainId' })
      .then((hex) => {
        if (!shouldAdoptAsyncWalletResult(restoreStarted, currentWalletGate(true))) {
          return;
        }
        if (selectedProviderRef.current !== provider) {
          return;
        }
        const id = parseInt(String(hex), 16);
        setChainId(Number.isFinite(id) ? id : null);
        const liveSession =
          sessionStatusRef.current != null
            ? { status: sessionStatusRef.current }
            : readWalletSession(getLocalStorage());
        if (!shouldAdoptAuthorizedAccounts(liveSession)) {
          return;
        }
        return provider.request({ method: 'eth_accounts' }).then((accounts) => {
          if (!shouldAdoptAsyncWalletResult(restoreStarted, currentWalletGate(true))) {
            return;
          }
          if (selectedProviderRef.current !== provider) {
            return;
          }
          const first = firstAccountFromProviderAccounts(accounts);
          if (first) {
            setAccount(first);
            if (id === GENLAYER_STUDIO_NEXT.chainId) {
              updateBalance(first, provider);
            }
          }
        });
      })
      .catch(() => {});

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [provider, updateBalance, currentWalletGate]);

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
    bumpWalletEpoch();
    setSelectedRdns(chosen.rdns);
    selectedRdnsRef.current = chosen.rdns;
    selectedProviderRef.current = chosen.provider;
    const connectStarted = currentWalletGate(false);
    setIsConnecting(true);
    setError(null);
    const connectStillCurrent = () =>
      shouldAdoptAsyncWalletResult(connectStarted, currentWalletGate(false)) &&
      selectedProviderRef.current === chosen.provider;
    try {
      const accounts = await chosen.provider.request({ method: 'eth_requestAccounts' });
      if (!connectStillCurrent()) {
        return;
      }
      const hexChain = await chosen.provider.request({ method: 'eth_chainId' });
      if (!connectStillCurrent()) {
        return;
      }
      const id = parseInt(String(hexChain), 16);
      const first = firstAccountFromProviderAccounts(accounts);
      if (first) {
        setAccount(first);
        sessionStatusRef.current = 'connected';
        writeWalletSession(getLocalStorage(), { status: 'connected', rdns: chosen.rdns });
        setChainId(Number.isFinite(id) ? id : null);
        if (id === GENLAYER_STUDIO_NEXT.chainId) {
          await updateBalance(first, chosen.provider);
        } else {
          setBalanceGen(null);
        }
      }
    } catch (err: unknown) {
      if (!connectStillCurrent()) {
        return;
      }
      const classified = classifyWalletError(err);
      setError(classified.message);
    } finally {
      if (connectStillCurrent()) {
        setIsConnecting(false);
      }
    }
  };

  const disconnectWallet = () => {
    bumpWalletEpoch();
    sessionStatusRef.current = 'cleared';
    setAccount(null);
    setBalanceGen(null);
    setBalanceReadFailed(false);
    setError(null);
    setIsConnecting(false);
    writeWalletSession(getLocalStorage(), { status: 'cleared', rdns: selectedRdnsRef.current });
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
