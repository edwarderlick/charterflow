import React from 'react';

interface BarcodeProps {
  className?: string;
  height?: number;
  width?: number;
  color?: string;
}

export const Barcode: React.FC<BarcodeProps> = ({
  className = '',
  height = 16,
  width = 120,
  color = '#888884',
}) => {
  return (
    <svg
      className={`inline-block select-none ${className}`}
      width={width}
      height={height}
      viewBox="0 0 120 16"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="0" width="3" height="16" />
      <rect x="5" y="0" width="1" height="16" />
      <rect x="8" y="0" width="4" height="16" />
      <rect x="15" y="0" width="2" height="16" />
      <rect x="20" y="0" width="6" height="16" />
      <rect x="29" y="0" width="1" height="16" />
      <rect x="33" y="0" width="3" height="16" />
      <rect x="40" y="0" width="5" height="16" />
      <rect x="48" y="0" width="2" height="16" />
      <rect x="53" y="0" width="4" height="16" />
      <rect x="60" y="0" width="1" height="16" />
      <rect x="64" y="0" width="5" height="16" />
      <rect x="72" y="0" width="3" height="16" />
      <rect x="78" y="0" width="2" height="16" />
      <rect x="83" y="0" width="6" height="16" />
      <rect x="92" y="0" width="2" height="16" />
      <rect x="96" y="0" width="4" height="16" />
      <rect x="103" y="0" width="1" height="16" />
      <rect x="107" y="0" width="5" height="16" />
      <rect x="115" y="0" width="3" height="16" />
    </svg>
  );
};
