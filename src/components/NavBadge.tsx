import React from 'react';

/** The small orange count pill used in the sidebar. Nothing is drawn for zero; anything over 99 reads "99+". */
export const NavBadge: React.FC<{ count?: number; className?: string }> = ({ count, className = '' }) => {
  if (!count || count <= 0) return null;
  const text = count > 99 ? '99+' : String(Math.floor(count));
  return (
    <span aria-label={`${text} waiting`} className={`bg-[#FA7014] text-white rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold shrink-0 min-w-[1.25rem] text-center ${className}`}>
      {text}
    </span>
  );
};
