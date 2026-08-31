import React from 'react';

interface AmaavigoLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  variant?: 'full' | 'compact' | 'mark';
  theme?: 'light' | 'dark' | 'auto';
  height?: number | string;
  showTagline?: boolean;
  align?: 'left' | 'center';
}

export const AmaavigoLogo: React.FC<AmaavigoLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'full',
  theme = 'light',
  height,
  showTagline = true,
  align = 'left',
}) => {
  // Dimensions based on size presets
  const sizeConfig = {
    sm: { width: 140, height: 32, markSize: 26 },
    md: { width: 185, height: 42, markSize: 34 },
    lg: { width: 230, height: 52, markSize: 42 },
    xl: { width: 290, height: 66, markSize: 54 },
    custom: { width: 200, height: 46, markSize: 38 },
  };

  const currentSize = sizeConfig[size] || sizeConfig.md;
  const textColor = theme === 'light' ? '#111827' : theme === 'dark' ? '#FFFFFF' : 'currentColor';
  const taglineColor = theme === 'light' ? '#64748B' : '#94A3B8';
  const orangeBrand = '#FA7014'; // Signature Amaavigo Orange

  // Compact Mark Only
  if (variant === 'mark') {
    const markDim = height || currentSize.markSize;
    return (
      <svg
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`inline-block shrink-0 ${className}`}
        style={{ height: markDim, width: markDim }}
        role="img"
        aria-label="Amaavigo Mark"
      >
        {/* Flight pip notch */}
        <rect x="2" y="3" width="9" height="9" rx="1.5" fill={orangeBrand} />
        {/* Bold O Ring */}
        <circle cx="24" cy="24" r="15" stroke={orangeBrand} strokeWidth="8" fill="none" />
      </svg>
    );
  }

  // Full or Compact Logo matching the official website typography
  const isCentered = align === 'center';
  const viewBoxWidth = 230;
  const viewBoxHeight = showTagline && variant === 'full' ? 52 : 36;
  const renderHeight = height || (showTagline && variant === 'full' ? currentSize.height : currentSize.height * 0.78);
  const textX = isCentered ? '50%' : '0';
  const textAnchor = isCentered ? 'middle' : 'start';

  return (
    <div className={`inline-flex flex-col select-none shrink-0 ${className}`}>
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-auto shrink-0"
        style={{ height: renderHeight, minHeight: renderHeight }}
        role="img"
        aria-label="Amaavigo - Where Brand takes Flight"
      >
        <g id="amaavigo-wordmark">
          {/* Main wordmark "amaavig" with "o" */}
          <text
            x={textX}
            y="28"
            textAnchor={textAnchor}
            style={{
              fontFamily:
                '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontWeight: 900,
              fontSize: '32px',
              letterSpacing: '-0.04em',
            }}
          >
            <tspan fill={textColor}>amaavig</tspan>
            <tspan fill={orangeBrand}>o</tspan>
          </text>
        </g>

        {/* Tagline: "Where Brand takes Flight" */}
        {showTagline && variant === 'full' && (
          <g id="amaavigo-tagline">
            <text
              x={textX}
              y="46"
              textAnchor={textAnchor}
              fill={taglineColor}
              style={{
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontWeight: 600,
                fontSize: '11px',
                letterSpacing: '0.04em',
              }}
            >
              Where Brand takes Flight
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};

