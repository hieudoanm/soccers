import type { FC } from 'react';

export interface YearInfo {
  year: number;
  host: string;
  champion: string | null;
  runnerUp: string | null;
  available: boolean;
}

export const YearCard: FC<{ info: YearInfo; href: string }> = ({
  info,
  href,
}) => (
  <a
    href={href}
    className={`block rounded-xl border p-4 text-center transition-all duration-200 ${
      info.available
        ? 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 hover:-translate-y-1'
        : 'border-base-300 bg-base-200 hover:bg-base-300 hover:-translate-y-0.5'
    }`}>
    <div className="text-base-content text-2xl font-bold tracking-tight">
      {info.year}
    </div>
    <div className="text-base-content/60 mt-0.5 text-xs">{info.host}</div>
    {info.champion && (
      <div className="text-primary mt-1.5 text-xs font-medium">
        🏆 {info.champion}
      </div>
    )}
    {info.runnerUp && (
      <div className="text-base-content/60 mt-0.5 text-xs">
        2nd {info.runnerUp}
      </div>
    )}
    {!info.champion && info.available && (
      <div className="text-base-content/60 mt-1.5 text-xs italic">Upcoming</div>
    )}
  </a>
);
