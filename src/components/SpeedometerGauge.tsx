import React from 'react';

export interface SpeedometerGaugeProps {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  warningThreshold?: number;
  criticalThreshold?: number;
  decimals?: number;
  size?: 'sm' | 'md' | 'lg';
  extraInfo?: Array<{ label: string; value: string; highlight?: 'ok' | 'warn' | 'err' }>;
}

function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  if (Math.abs(endAngle - startAngle) < 0.1) return '';
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return ['M', start.x, start.y, 'A', r, r, 0, largeArcFlag, 0, end.x, end.y].join(' ');
}

export const SpeedometerGauge: React.FC<SpeedometerGaugeProps> = ({
  label,
  sublabel,
  value,
  min,
  max,
  unit,
  warningThreshold,
  criticalThreshold,
  decimals = 1,
  size = 'md',
  extraInfo,
}) => {
  const safeRange = Math.max(0.0001, max - min);
  const clamped = Math.min(Math.max(value, min), max);
  const ratio = (clamped - min) / safeRange;

  // Speedometer sweep from -125 deg to +125 deg (total 250 deg arc)
  const startAngle = -125;
  const endAngle = 125;
  const totalSweep = endAngle - startAngle;
  const currentAngle = startAngle + ratio * totalSweep;

  const warnRatio =
    warningThreshold !== undefined
      ? Math.min(Math.max((warningThreshold - min) / safeRange, 0), 1)
      : 0.78;
  const critRatio =
    criticalThreshold !== undefined
      ? Math.min(Math.max((criticalThreshold - min) / safeRange, 0), 1)
      : 0.9;

  const warnAngle = startAngle + warnRatio * totalSweep;
  const critAngle = startAngle + critRatio * totalSweep;

  const isCritical = criticalThreshold !== undefined && value >= criticalThreshold;
  const isWarning =
    !isCritical && warningThreshold !== undefined && value >= warningThreshold;

  const statusColor = isCritical
    ? '#EF4444'
    : isWarning
    ? '#F59E0B'
    : '#10B981';

  const cx = 100;
  const cy = 102;
  const radius = 74;

  // Generate 21 minor ticks and 6 major ticks with numeric labels
  const majorSteps = 5;
  const minorSteps = 25;

  const ticks = [];
  for (let i = 0; i <= minorSteps; i++) {
    const tRatio = i / minorSteps;
    const angle = startAngle + tRatio * totalSweep;
    const isMajor = i % (minorSteps / majorSteps) === 0;
    const outerPt = polarToCartesian(cx, cy, radius - 5, angle);
    const innerPt = polarToCartesian(cx, cy, radius - (isMajor ? 15 : 10), angle);
    const labelPt = polarToCartesian(cx, cy, radius - 26, angle);
    const tickVal = Math.round(min + tRatio * safeRange);

    ticks.push(
      <g key={i}>
        <line
          x1={outerPt.x}
          y1={outerPt.y}
          x2={innerPt.x}
          y2={innerPt.y}
          stroke={isMajor ? '#94A3B8' : '#475569'}
          strokeWidth={isMajor ? 2 : 1}
          strokeLinecap="round"
        />
        {isMajor && (
          <text
            x={labelPt.x}
            y={labelPt.y + 3}
            textAnchor="middle"
            fill="#94A3B8"
            fontSize="8.5"
            fontFamily="JetBrains Mono, monospace"
            fontWeight="600"
          >
            {tickVal}
          </text>
        )}
      </g>
    );
  }

  // Needle geometry
  const needleTip = polarToCartesian(cx, cy, radius - 14, currentAngle);
  const needleTail = polarToCartesian(cx, cy, 14, currentAngle + 180);
  const needleSideL = polarToCartesian(cx, cy, 4.5, currentAngle - 90);
  const needleSideR = polarToCartesian(cx, cy, 4.5, currentAngle + 90);

  const svgHeight = size === 'sm' ? 'h-36' : size === 'lg' ? 'h-48' : 'h-40';

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-[#0E1525] flex flex-col justify-between shadow-inner">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-200 tracking-tight">{label}</div>
          {sublabel && <div className="text-[11px] text-slate-400 font-mono">{sublabel}</div>}
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
            isCritical
              ? 'bg-red-500/20 text-red-400 border border-red-500/40'
              : isWarning
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          }`}
        >
          {isCritical ? 'АВАРИЯ' : isWarning ? 'ВНИМАНИЕ' : 'НОРМА'}
        </span>
      </div>

      {/* Analog Speedometer Dial with Needle */}
      <div className="relative flex flex-col items-center justify-center my-1">
        <svg viewBox="0 0 200 155" className={`w-full ${svgHeight} overflow-visible`}>
          {/* Outer dark bezel ring */}
          <path
            d={describeArc(cx, cy, radius + 4, startAngle, endAngle)}
            fill="none"
            stroke="#1E293B"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Background track arc */}
          <path
            d={describeArc(cx, cy, radius, startAngle, endAngle)}
            fill="none"
            stroke="#1E293B"
            strokeWidth="8"
            strokeLinecap="round"
          />

          {/* Nominal Zone Arc (Green) */}
          <path
            d={describeArc(cx, cy, radius, startAngle, warnAngle)}
            fill="none"
            stroke="#10B981"
            strokeOpacity="0.28"
            strokeWidth="8"
          />

          {/* Warning Zone Arc (Amber) */}
          <path
            d={describeArc(cx, cy, radius, warnAngle, critAngle)}
            fill="none"
            stroke="#F59E0B"
            strokeOpacity="0.35"
            strokeWidth="8"
          />

          {/* Critical Zone Arc (Red) */}
          <path
            d={describeArc(cx, cy, radius, critAngle, endAngle)}
            fill="none"
            stroke="#EF4444"
            strokeOpacity="0.4"
            strokeWidth="8"
          />

          {/* Active Value Arc */}
          {ratio > 0.005 && (
            <path
              d={describeArc(cx, cy, radius, startAngle, currentAngle)}
              fill="none"
              stroke={statusColor}
              strokeWidth="8"
              strokeLinecap="round"
            />
          )}

          {/* Scale Ticks and Numbers */}
          {ticks}

          {/* Speedometer Needle Polygon */}
          <polygon
            points={`${needleTip.x},${needleTip.y} ${needleSideL.x},${needleSideL.y} ${needleTail.x},${needleTail.y} ${needleSideR.x},${needleSideR.y}`}
            fill={statusColor}
            className="transition-all duration-500 ease-out"
          />
          <line
            x1={cx}
            y1={cy}
            x2={needleTip.x}
            y2={needleTip.y}
            stroke="#F8FAFC"
            strokeWidth="1.2"
            strokeOpacity="0.85"
            className="transition-all duration-500 ease-out"
          />

          {/* Center Pivot Hub */}
          <circle cx={cx} cy={cy} r="9" fill="#1E293B" stroke="#475569" strokeWidth="2" />
          <circle cx={cx} cy={cy} r="4" fill={statusColor} />

          {/* Digital Value Readout inside Speedometer */}
          <text
            x={cx}
            y={cy + 34}
            textAnchor="middle"
            fill="#F8FAFC"
            fontSize="18"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {value.toFixed(decimals)}
          </text>
          <text
            x={cx}
            y={cy + 48}
            textAnchor="middle"
            fill="#94A3B8"
            fontSize="9.5"
            fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >
            {unit}
          </text>
        </svg>
      </div>

      {/* Extra Sub-Telemetry Rows */}
      {extraInfo && extraInfo.length > 0 && (
        <div className="pt-2.5 border-t border-slate-800/90 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          {extraInfo.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-1">
              <span className="text-slate-400 truncate">{item.label}:</span>
              <span
                className={`font-mono font-semibold whitespace-nowrap ${
                  item.highlight === 'err'
                    ? 'text-red-400'
                    : item.highlight === 'warn'
                    ? 'text-amber-300'
                    : item.highlight === 'ok'
                    ? 'text-emerald-400'
                    : 'text-slate-200'
                }`}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
