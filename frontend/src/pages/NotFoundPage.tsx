import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  const location = useLocation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 lg:p-24 bg-[#131313] text-center min-h-[60vh]">
      <div className="max-w-xl w-full bg-[#1c1b1b] border border-[#2a2a2a] p-8 space-y-6 shadow-2xl">
        <div className="flex items-center justify-center gap-2 font-mono text-xs text-[#ff5719]">
          <span className="w-2 h-2 rounded-full bg-[#ff5719] animate-pulse"></span>
          <span>[SYSTEM_FAULT 404] UNKNOWN_URI_TARGET</span>
        </div>

        <h1 className="font-['Space_Grotesk'] text-4xl sm:text-5xl uppercase font-bold text-[#e5e2e1] tracking-tight">
          ROUTE NOT FOUND
        </h1>

        <div className="p-3 bg-[#0e0e0e] border border-[#262626] font-mono text-xs text-[#888884] space-y-1">
          <div className="flex justify-between">
            <span>REQUESTED PATH:</span>
            <span className="text-[#ff5719] font-bold">{location.pathname}</span>
          </div>
          <div className="flex justify-between">
            <span>NETWORK:</span>
            <span>GENLAYER STUDIO NEXT #61997</span>
          </div>
        </div>

        <p className="font-['Hanken_Grotesk'] text-sm text-[#c8c6c2] leading-relaxed">
          The requested route or resource identifier is not mapped to any active interface or contract view in CharterFlow.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 font-mono text-xs">
          <Link
            to="/rounds"
            className="px-6 py-3 bg-[#ff5719] text-[#521300] font-bold uppercase hover:bg-white hover:text-black transition-colors"
          >
            EXPLORE ROUNDS ↗
          </Link>
          <Link
            to="/"
            className="px-6 py-3 bg-[#201f1f] text-[#e5e2e1] border border-[#2a2a2a] hover:bg-[#2a2a2a] uppercase transition-colors"
          >
            RETURN HOME
          </Link>
        </div>
      </div>
    </div>
  );
};
