import React from 'react';
import { NETWORK_CONFIG, VERIFIED_DEPLOYMENT, LEGACY_FUNDED_ROUND, LEGACY_UNPATCHABLE_CONTRACT } from '../config/network';
import { explorerAddressUrl, explorerTxUrl } from '../services/eip1193';

export const VerifiedDeploymentLinks: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const explorer = NETWORK_CONFIG.explorerUrl;
  const contractUrl = explorerAddressUrl(explorer, NETWORK_CONFIG.contractAddress);
  const deployUrl = explorerTxUrl(explorer, VERIFIED_DEPLOYMENT.deployTransaction);
  const recoveryContractUrl = explorerAddressUrl(explorer, LEGACY_FUNDED_ROUND.contractAddress);
  const recoveryDeployUrl = explorerTxUrl(explorer, LEGACY_FUNDED_ROUND.deployTransaction);
  const recoveryCreateUrl = explorerTxUrl(explorer, LEGACY_FUNDED_ROUND.stage2Transaction);
  const recoveryFundedUrl = explorerTxUrl(explorer, LEGACY_FUNDED_ROUND.createTransaction);

  return (
    <div className={`font-mono text-[11px] ${compact ? 'space-y-1' : 'space-y-2'}`}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#c8c6c2]">
        <span className="text-[#888884]">CHAIN</span>
        <span className="text-[#e5e2e1] font-bold">61997</span>
        <span className="text-[#888884]">LIVE CONTRACT</span>
        <a href={contractUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline break-all">
          {NETWORK_CONFIG.contractAddress}
        </a>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#c8c6c2]">
        <a href={deployUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline">
          Live deploy tx ↗
        </a>
        <span className="text-[#888884]">Live source SHA-256 {VERIFIED_DEPLOYMENT.sourceSha256.slice(0, 8)}…</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#c8c6c2]">
        <span className="text-[#ffb800]">LEGACY</span>
        <span className="break-all text-[#e5e2e1]">{LEGACY_UNPATCHABLE_CONTRACT.contractAddress}</span>
        <span className="text-[#888884]">AI review and voting closed · funded rounds visible for recovery</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#c8c6c2]">
        <span className="text-[#888884]">RECOVERY</span>
        <a href={recoveryContractUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline break-all">
          {LEGACY_FUNDED_ROUND.contractAddress}
        </a>
        <a href={recoveryDeployUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline">
          legacy deploy ↗
        </a>
        <a href={recoveryCreateUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline">
          {LEGACY_FUNDED_ROUND.pilotRoundId} ↗
        </a>
        <a href={recoveryFundedUrl} target="_blank" rel="noreferrer" className="text-[#ff5719] hover:underline">
          {LEGACY_FUNDED_ROUND.roundId} ↗
        </a>
      </div>
    </div>
  );
};
