import React from 'react';
import { Link } from 'react-router-dom';
import { Barcode } from './Barcode';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-[#0e0e0e] border-t border-[#262626] text-[#e5e2e1] pt-12 pb-8 px-4 lg:px-10 mt-auto">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 pb-10 border-b border-[#222222]">
        {/* Brand & Barcode Column */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <img src="/brand/charterflow-mark.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
            <span className="font-['Space_Grotesk'] text-lg uppercase tracking-tight text-[#e5e2e1] font-bold">
              CharterFlow
            </span>
          </div>
          <p className="font-['Hanken_Grotesk'] text-xs text-[#888884] leading-relaxed max-w-sm">
            Autonomous grant distributions and decentralized treasury protocols driven by deterministic GenLayer consensus machines.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <Barcode width={110} height={18} color="#c8c6c2" />
            <span className="font-mono text-[10px] text-[#c8c6c2] tracking-widest">
              GEN-61997-TX
            </span>
          </div>
        </div>

        {/* Protocol Architecture */}
        <div className="lg:col-span-3 flex flex-col gap-3 font-mono text-xs">
          <span className="font-bold text-[#e5e2e1] uppercase tracking-wider text-[11px] border-b border-[#222222] pb-1">
            PROTOCOL ARCHITECTURE
          </span>
          <ul className="flex flex-col gap-2 text-[#888884]">
            <li className="hover:text-[#ff5719] transition-colors cursor-default">
              Intelligent Contract Engine
            </li>
            <li className="hover:text-[#ff5719] transition-colors cursor-default">
              Optimistic Execution Tiers
            </li>
            <li className="hover:text-[#ff5719] transition-colors cursor-default">
              Deterministic Oracle Rigs
            </li>
            <li className="hover:text-[#ff5719] transition-colors cursor-default">
              Verifiable Consensus Ledger
            </li>
          </ul>
        </div>

        {/* Exploration & Tools */}
        <div className="lg:col-span-2 flex flex-col gap-3 font-mono text-xs">
          <span className="font-bold text-[#e5e2e1] uppercase tracking-wider text-[11px] border-b border-[#222222] pb-1">
            EXPLORATION & TOOLS
          </span>
          <ul className="flex flex-col gap-2 text-[#888884]">
            <li>
              <Link to="/test" className="hover:text-[#ff5719] transition-colors flex items-center gap-1">
                <span>Test CharterFlow</span>
                <span>↗</span>
              </Link>
            </li>
            <li>
              <a
                href="https://explorer-studio-dev.genlayer.com/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#ff5719] transition-colors flex items-center gap-1"
              >
                <span>Studio Next Explorer</span>
                <span>↗</span>
              </a>
            </li>
            <li>
              <a
                href="https://docs.genlayer.com/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#ff5719] transition-colors flex items-center gap-1"
              >
                <span>Documentation & SDK</span>
                <span>↗</span>
              </a>
            </li>
            <li>
              <a
                href="https://studio-next.genlayer.com/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#ff5719] transition-colors flex items-center gap-1"
              >
                <span>GenLayer Studio Web IDE</span>
                <span>↗</span>
              </a>
            </li>
            <li>
              <a
                href="https://studio-next.genlayer.com/api"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#ff5719] transition-colors flex items-center gap-1"
              >
                <span>Contract Simulator API</span>
                <span>↗</span>
              </a>
            </li>
          </ul>
        </div>

        {/* Immutability Registry */}
        <div className="lg:col-span-3 flex flex-col gap-3 font-mono text-xs">
          <span className="font-bold text-[#e5e2e1] uppercase tracking-wider text-[11px] border-b border-[#222222] pb-1">
            IMMUTABILITY REGISTRY
          </span>
          <div className="bg-[#141414] border border-[#222222] p-2.5 space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[#888884]">NETWORK</span>
              <span className="text-[#e5e2e1] font-semibold">STUDIO NEXT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#888884]">CHAIN ID</span>
              <span className="text-[#e5e2e1] font-semibold">61997</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#888884]">ENGINE</span>
              <span className="text-[#e5e2e1] font-semibold">GEN-VM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#888884]">STATUS</span>
              <span className="text-[#ff5719] font-semibold">VERIFIED PILOT · LIVE READS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom disclaimer bar */}
      <div className="max-w-7xl mx-auto pt-6 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-[10px] text-[#888884]">
        <div className="text-center md:text-left">
          <span className="text-[#ff5719] font-bold">DISCLAIMER:</span>{' '}
          Studio development preview. Amounts are test GEN. The pilot payout was verified; check the live round ledger for current balances. Creator close and refund have not been tested. Preview state can be reset.
        </div>
        <div className="text-center md:text-right">
          © 2026 CHARTERFLOW LABS. PROTOCOL OPERATING UNDER GENLAYER INTELLIGENT CONTRACT CONSENSUS.
        </div>
      </div>
    </footer>
  );
};
