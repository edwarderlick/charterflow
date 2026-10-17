import React, { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';

import { useData } from '../services/dataAccess';

export const Header: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const {
    account,
    chainId,
    isConnected,
    isCorrectNetwork,
    balanceLabel,
    isConnecting,
    wallets,
    walletInstalled,
    connectWallet,
    disconnectWallet,
    switchToStudioNext,
  } = useWallet();
  const { isDesignPreview, setDesignPreview } = useData();
  const location = useLocation();

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`.toUpperCase();
  };

  const navLinks = [
    { label: 'Explore Rounds', to: '/rounds' },
    { label: 'How It Works', to: '/how-it-works' },
    { label: 'Test CharterFlow', to: '/test' },
    { label: 'Create Round', to: '/rounds/new' },
    { label: 'My Activity', to: '/activity' },
    { label: 'Network', to: '/network' },
  ];

  return (
    <>
      {/* Top Operational Notice Ribbon */}
      <div className="w-full bg-[#0e0e0e] border-b border-[#2a2a2a] py-1 px-4 lg:px-10 flex items-center justify-between text-[11px] font-mono select-none">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-[#ff5719] animate-pulse"></span>
          <span className="text-[#ff5719] font-bold uppercase tracking-wider">
            Operational Notice:
          </span>
          <span className="text-[#c8c6c2] hidden sm:inline">
            GenLayer Studio Next Testnet. Deterministic consensus checks on Chain ID 61997.
          </span>
          <span className="text-[#c8c6c2] sm:hidden">
            Chain ID 61997
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[#c8c6c2] hidden md:inline">
            RPC: studio-next.genlayer.com/api
          </span>
          <span className="text-[#5c4037] hidden md:inline">|</span>
          <button
            type="button"
            onClick={() => setDesignPreview(!isDesignPreview)}
            className={`px-1.5 py-0.5 text-[10px] tracking-wider uppercase font-bold transition-colors ${
              isDesignPreview
                ? 'bg-[#ff5719] text-[#521300]'
                : 'bg-[#2a2a2a] text-[#c8c6c2] hover:text-white'
            }`}
          >
            {isDesignPreview ? 'PREVIEW DATA: ON' : 'PREVIEW DATA: OFF'}
          </button>
        </div>
      </div>

      {/* Main Persistent Header */}
      <header className="sticky top-0 w-full z-50 bg-[#131313]/95 backdrop-blur-sm border-b border-[#262626]">
        <div className="h-20 w-full px-4 lg:px-10 flex items-center justify-between">
          {/* Left Brand + Nav */}
          <div className="flex items-center gap-6 lg:gap-10">
            {/* CF Brand Identity */}
            <Link to="/" className="flex items-center gap-3 group">
              <img
                src="/brand/charterflow-mark.svg"
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 transition-transform group-hover:scale-105"
              />
              <div className="flex flex-col">
                <span className="font-['Space_Grotesk'] text-lg uppercase tracking-tight text-[#e5e2e1] font-bold leading-tight">
                  CharterFlow
                </span>
                <span className="font-mono text-[10px] text-[#c8c6c2] flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff5719]"></span>
                  STUDIO NEXT · CHAIN 61997
                </span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-6">
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `py-2 uppercase tracking-wider text-xs font-mono transition-colors border-b-2 ${
                      isActive
                        ? 'text-[#ff5719] font-bold border-[#ff5719]'
                        : 'text-[#e6beb2] hover:text-[#e5e2e1] border-transparent font-medium'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right Telemetry Controls */}
          <div className="flex items-center gap-2 sm:gap-3 font-mono text-xs">
            {/* Balance Pill */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#1c1b1b] border border-[#2a2a2a]">
              <span className="material-symbols-outlined text-[#ff5719] text-[15px]">
                token
              </span>
              <span className="text-[#888884] text-[11px]">BALANCE:</span>
              <span className="text-[#e5e2e1] font-semibold">
                {balanceLabel}
              </span>
              <Link
                to="/test#faucet"
                className="ml-1 text-[10px] text-[#ff5719] hover:underline"
                title="Official Studio Next test GEN source"
              >
                [TEST GEN]
              </Link>
            </div>

            {/* Network State Pill */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-[#2a2a2a] border border-[#353534]">
              {isConnected ? (
                isCorrectNetwork ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[#00e599]"></span>
                    <span className="text-[#e5e2e1] text-[11px]">GENLAYER #61997</span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={switchToStudioNext}
                    className="flex items-center gap-1 text-[#ff3344] font-bold text-[11px] animate-pulse hover:underline"
                    title="Click to switch wallet to Chain 61997"
                  >
                    <span className="w-2 h-2 rounded-full bg-[#ff3344]"></span>
                    <span>SWITCH TO #61997</span>
                  </button>
                )
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#888884]"></span>
                  <span className="text-[#c8c6c2] text-[11px]">GENLAYER #61997</span>
                </>
              )}
            </div>

            {/* Wallet Connect / Account Trigger */}
            {isConnected && account ? (
              <div className="flex items-center gap-1">
                <span className="px-2.5 py-1.5 bg-[#1c1b1b] border border-[#2a2a2a] text-[#e5e2e1] font-bold text-[11px]">
                  {truncateAddress(account)}
                </span>
                <button
                  type="button"
                  onClick={disconnectWallet}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-[#2a2a2a] text-[#c8c6c2] hover:text-white hover:bg-[#353534] font-bold uppercase tracking-wider text-[10px] transition-colors"
                  title="Clear local application session (Browser wallet extension remains authorized in browser)"
                >
                  <span>CLEAR SESSION</span>
                  <span className="material-symbols-outlined text-[12px]">logout</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (wallets.length === 1) {
                    void connectWallet(wallets[0].rdns);
                  } else {
                    void connectWallet();
                  }
                }}
                disabled={isConnecting}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#ff5719] text-[#521300] font-bold uppercase tracking-wider text-[11px] hover:bg-white hover:text-black transition-colors disabled:opacity-60"
              >
                <span>{!walletInstalled ? 'NO WALLET' : isConnecting ? 'CONNECTING…' : wallets.length > 1 ? 'CHOOSE WALLET' : 'CONNECT WALLET'}</span>
                <span className="material-symbols-outlined text-[14px]">account_balance_wallet</span>
              </button>
            )}

            {/* Mobile Hamburger Toggle Button */}
            <button
              type="button"
              id="mobile-nav-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-[#e5e2e1] hover:text-[#ff5719] bg-[#1c1b1b] border border-[#2a2a2a] cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              <span className="material-symbols-outlined text-[20px]">
                {mobileMenuOpen ? 'close' : 'menu'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden w-full bg-[#131313] border-b border-[#262626] p-4 flex flex-col gap-3 font-mono text-xs">
            <nav className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`p-2 uppercase tracking-wider ${
                    location.pathname === link.to
                      ? 'bg-[#ff5719] text-[#521300] font-bold'
                      : 'bg-[#1c1b1b] text-[#e5e2e1] hover:bg-[#201f1f]'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="pt-2 border-t border-[#262626] flex flex-col gap-2">
              <div className="flex items-center justify-between p-2 bg-[#1c1b1b]">
                <span className="text-[#888884]">NETWORK:</span>
                <span className="text-[#e5e2e1] font-semibold">
                  {isConnected
                    ? isCorrectNetwork
                      ? 'GenLayer Studio Next (61997)'
                      : `Wrong Chain (#${chainId})`
                    : 'Studio Next #61997'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 bg-[#1c1b1b]">
                <span className="text-[#888884]">BALANCE:</span>
                <span className="text-[#e5e2e1] font-semibold">
                  {balanceLabel}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 bg-[#1c1b1b]">
                <span className="text-[#888884]">WALLET:</span>
                {isConnected && account ? (
                  <button
                    type="button"
                    onClick={disconnectWallet}
                    className="px-2 py-1 bg-[#2a2a2a] text-[#c8c6c2] text-[10px] font-bold uppercase"
                  >
                    CLEAR SESSION ({truncateAddress(account)})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void connectWallet(wallets.length === 1 ? wallets[0].rdns : undefined)}
                    className="px-2 py-1 bg-[#ff5719] text-[#521300] text-[10px] font-bold uppercase"
                  >
                    {!walletInstalled ? 'NO WALLET' : wallets.length > 1 ? 'CHOOSE WALLET' : 'CONNECT WALLET'}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between p-2 bg-[#1c1b1b]">
                <span className="text-[#888884]">DESIGN PREVIEW:</span>
                <button
                  type="button"
                  onClick={() => setDesignPreview(!isDesignPreview)}
                  className={`px-2 py-1 font-bold uppercase text-[10px] ${
                    isDesignPreview ? 'bg-[#ff5719] text-[#521300]' : 'bg-[#2a2a2a] text-[#c8c6c2]'
                  }`}
                >
                  {isDesignPreview ? 'ACTIVE' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        )}
      </header>
    </>
  );
};
