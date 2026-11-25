import type { FC } from 'react';

interface StatEntry {
  name: string;
  wins: number;
  years: number[];
}

export const StatList: FC<{ title: string; data: StatEntry[] }> = ({
  title,
  data,
}) => (
  <div>
    <h2 className="text-base-content mb-4 text-center text-xl font-bold">
      {title}
    </h2>
    <div className="space-y-1.5">
      {data.map((w) => (
        <div
          key={w.name}
          className="border-base-300 flex items-center justify-between rounded-lg border px-4 py-2 text-sm">
          <span className="text-base-content font-medium">{w.name}</span>
          <span className="text-base-content/70">
            {w.wins}{' '}
            <span className="text-base-content/50">({w.years.join(', ')})</span>
          </span>
        </div>
      ))}
    </div>
  </div>
);
