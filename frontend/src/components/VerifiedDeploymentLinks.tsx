import React from 'react';
import { NETWORK_CONFIG, VERIFIED_DEPLOYMENT } from '../config/network';
import { explorerAddressUrl, explorerTxUrl } from '../services/eip1193';

export const VerifiedDeploymentLinks: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const explorer = NETWORK_CONFIG.explorerUrl;
  const contractUrl = explorerAddressUrl(explorer, NETWORK_CONFIG.contractAddress);
  const deployUrl = explorerTxUrl(explorer, '0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4');
  const createUrl = explorerTxUrl(explorer, VERIFIED_DEPLOYMENT.stage2Transaction);

  return (
    <div className={`font-mono text-[11px] ${compact ? 'space-y-1' : 'space-y-2'}`}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#c8c6c2]">
        <span className="text-[#888884]">CHAIN</span>
        <span className="text-[#e5e2e1] font-bold">61997</span>
        <span className="text-[#888884]">CONTRACT</span>
        <a href={contractUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline break-all">
          {NETWORK_CONFIG.contractAddress}
        </a>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#c8c6c2]">
        <a href={deployUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline">
          Deploy tx ↗
        </a>
        <a href={createUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline">
          create_round tx ↗
        </a>
        <span className="text-[#888884]">
          Round {VERIFIED_DEPLOYMENT.intendedRoundId} remains unverified (Stage 2 INCONCLUSIVE).
        </span>
      </div>
    </div>
  );
};
