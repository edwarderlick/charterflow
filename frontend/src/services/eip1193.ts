export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  providers?: Eip1193Provider[];
}

export interface DiscoveredWallet {
  uuid: string;
  name: string;
  rdns: string;
  provider: Eip1193Provider;
}

export const WALLET_SESSION_KEY = 'cf_wallet_session_v1';

export interface WalletSession {
  status: 'connected' | 'cleared';
  rdns?: string;
}

export function readWalletSession(storage: Pick<Storage, 'getItem'> | null | undefined): WalletSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WALLET_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletSession;
    if (parsed.status !== 'connected' && parsed.status !== 'cleared') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeWalletSession(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  session: WalletSession
): void {
  if (!storage) return;
  storage.setItem(WALLET_SESSION_KEY, JSON.stringify(session));
}

export function shouldAdoptAuthorizedAccounts(session: WalletSession | null): boolean {
  return session?.status === 'connected';
}

export function classifyWalletError(err: unknown): { code?: number | string; message: string } {
  const anyErr = err as { code?: number | string; message?: string } | null;
  const code = anyErr?.code;
  const message = String(anyErr?.message || err || 'Wallet request failed');
  if (code === 4001 || code === 'ACTION_REJECTED' || /user rejected|denied|rejected the request/i.test(message)) {
    return { code: 4001, message: 'Connection rejected in the wallet. CharterFlow did not store a seed phrase or private key.' };
  }
  if (code === 4902) {
    return { code: 4902, message: 'Studio Next (chain 61997) is not in this wallet yet. Add it with an explicit click; the app will not auto-switch.' };
  }
  if (code === -32002) {
    return { code: -32002, message: 'A wallet request is already open. Finish or close that prompt, then retry.' };
  }
  return { code, message };
}

function asProvider(value: unknown): Eip1193Provider | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Eip1193Provider;
  return typeof candidate.request === 'function' ? candidate : null;
}

export function collectInjectedProviders(win: {
  ethereum?: Eip1193Provider;
  discovered?: DiscoveredWallet[];
} | null | undefined): DiscoveredWallet[] {
  const found: DiscoveredWallet[] = [];
  const seen = new Set<Eip1193Provider>();

  const push = (wallet: DiscoveredWallet) => {
    if (!wallet.provider || seen.has(wallet.provider)) return;
    seen.add(wallet.provider);
    found.push(wallet);
  };

  for (const announced of win?.discovered || []) {
    push(announced);
  }

  const ethereum = win?.ethereum;
  const nested = ethereum?.providers;
  if (Array.isArray(nested) && nested.length > 0) {
    nested.forEach((provider, index) => {
      if (!asProvider(provider)) return;
      push({
        uuid: `legacy-providers-${index}`,
        name: index === 0 ? 'Injected wallet 1' : `Injected wallet ${index + 1}`,
        rdns: `injected.providers.${index}`,
        provider,
      });
    });
  } else if (ethereum) {
    push({
      uuid: 'legacy-window-ethereum',
      name: 'Injected EIP-1193 wallet',
      rdns: 'injected.ethereum',
      provider: ethereum,
    });
  }

  return found;
}

export function selectWalletByRdns(wallets: DiscoveredWallet[], rdns?: string): DiscoveredWallet | null {
  if (wallets.length === 0) return null;
  if (rdns) {
    const match = wallets.find((wallet) => wallet.rdns === rdns);
    if (match) return match;
  }
  return wallets.length === 1 ? wallets[0] : null;
}

export function formatWalletBalanceLabel(params: {
  isConnected: boolean;
  isCorrectNetwork: boolean;
  balanceGen: string | null;
  balanceReadFailed?: boolean;
}): string {
  if (!params.isConnected) return 'NO WALLET';
  if (!params.isCorrectNetwork) return 'WRONG CHAIN';
  if (params.balanceReadFailed) return 'BALANCE READ FAILED';
  if (params.balanceGen === null) return 'BALANCE UNKNOWN';
  if (params.balanceGen === '0.00') return '0.00 GEN';
  return `${params.balanceGen} GEN`;
}

export const STUDIO_NEXT_FAUCET = {
  studioWeb: 'https://studio-dev.genlayer.com/',
  studioAlias: 'https://studio-next.genlayer.com/',
  docs: 'https://docs.genlayer.com/developers/networks',
  note:
    'Studio Next (chain 61997) test GEN is issued by the built-in Studio faucet (💧 in the Studio account selector at studio-dev.genlayer.com). The public Asimov faucet at testnet-faucet.genlayer.foundation funds chain 4221 and does not fund this app.',
};

export function explorerTxUrl(explorerBase: string, txHash: string): string {
  const base = explorerBase.endsWith('/') ? explorerBase : `${explorerBase}/`;
  return `${base}tx/${txHash}`;
}

export function explorerAddressUrl(explorerBase: string, address: string): string {
  const base = explorerBase.endsWith('/') ? explorerBase : `${explorerBase}/`;
  return `${base}address/${address}`;
}
