import React, { useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  label,
  className = '',
  iconOnly = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 cursor-pointer transition-colors ${
        copied
          ? 'text-[#00e599]'
          : 'text-[#c8c6c2] hover:text-[#ff5719]'
      } ${className}`}
      title={copied ? 'Copied!' : `Copy: ${text}`}
    >
      <span className="material-symbols-outlined text-[13px]">
        {copied ? 'check' : 'content_copy'}
      </span>
      {!iconOnly && (
        <span className="font-mono text-[10px] tracking-wider uppercase">
          {copied ? 'COPIED' : label || 'COPY'}
        </span>
      )}
    </button>
  );
};
