import type { FC } from 'react';

const PITCH = '#cfe0cf';
const PITCH_LINE = '#9dbf9d';
const PASS = '#7d9bb3';
const ON_TARGET = '#dc2626';
const OFF_TARGET = '#d97706';
const YELLOW = '#eab308';
const RED = '#dc2626';

const Swatch: FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 10 10"
    className={`h-2.5 w-2.5 ${className ?? ''}`}
    aria-hidden="true">
    <circle cx="5" cy="5" r="4" className="fill-current" />
  </svg>
);

const MatchAnalysis: FC = () => (
  <div className="card border-base-300 bg-base-100 w-full border shadow-sm">
    <div className="card-body gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base-content m-0 text-sm font-semibold">
          Match analysis
        </h2>
        <span className="badge badge-sm badge-outline badge-success">
          xG 1.8 – 0.9
        </span>
      </div>
      <svg
        viewBox="0 0 360 260"
        className="w-full"
        role="img"
        aria-label="Shot map and event positions on a football pitch">
        <rect
          x="8"
          y="8"
          width="344"
          height="244"
          rx="4"
          fill={PITCH}
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <line
          x1="8"
          y1="130"
          x2="352"
          y2="130"
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <circle
          cx="180"
          cy="130"
          r="34"
          fill="none"
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <circle cx="180" cy="130" r="3" fill={PITCH_LINE} />
        <rect
          x="115"
          y="8"
          width="130"
          height="58"
          fill="none"
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <rect
          x="145"
          y="8"
          width="70"
          height="26"
          fill="none"
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <circle cx="180" cy="60" r="3" fill={PITCH_LINE} />
        <rect
          x="115"
          y="194"
          width="130"
          height="58"
          fill="none"
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <rect
          x="145"
          y="226"
          width="70"
          height="26"
          fill="none"
          stroke={PITCH_LINE}
          strokeWidth="2"
        />
        <circle cx="180" cy="200" r="3" fill={PITCH_LINE} />
        <g stroke={PASS} strokeWidth="2" strokeDasharray="4 4" fill="none">
          <path d="M92 214 L138 186" />
          <path d="M138 186 L192 172" />
          <path d="M192 172 L232 148" />
          <path d="M84 168 L120 148" />
          <path d="M268 196 L236 176" />
        </g>
        <g>
          <circle cx="122" cy="72" r="8" fill={ON_TARGET} />
          <circle cx="204" cy="56" r="6" fill={ON_TARGET} />
          <circle cx="252" cy="92" r="9" fill={ON_TARGET} />
          <circle cx="146" cy="112" r="5" fill={ON_TARGET} />
          <circle cx="232" cy="132" r="6" fill={ON_TARGET} />
          <circle cx="182" cy="84" r="10" fill={ON_TARGET} />
          <circle cx="106" cy="140" r="5" fill={OFF_TARGET} />
          <circle cx="286" cy="70" r="6" fill={OFF_TARGET} />
          <circle cx="168" cy="152" r="5" fill={OFF_TARGET} />
        </g>
        <g>
          <rect x="296" y="146" width="10" height="10" rx="1" fill={YELLOW} />
          <rect x="64" y="118" width="10" height="10" rx="1" fill={RED} />
        </g>
      </svg>
      <div className="text-base-content/60 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Swatch className="text-primary" /> Shot on target
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch className="text-warning" /> Shot off target
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 16 4" className="h-1 w-4" aria-hidden="true">
            <line
              x1="0"
              y1="2"
              x2="16"
              y2="2"
              stroke={PASS}
              strokeWidth="2"
              strokeDasharray="3 2"
            />
          </svg>
          Pass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <rect
              x="1"
              y="1"
              width="8"
              height="8"
              rx="1"
              className="fill-warning"
            />
          </svg>
          Card
        </span>
      </div>
    </div>
  </div>
);

export default MatchAnalysis;
