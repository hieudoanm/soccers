import type { FC } from 'react';

import { roundName } from './constants';
import type { TeamInfo } from '@/data/touraments/types/bracket';

export const StatusBar: FC<{
  champ: string | null;
  currentLevel: number | null;
  maxLevel: number;
  decided: number;
  total: number;
  progress: number;
  teams: Record<string, TeamInfo>;
}> = ({ champ, currentLevel, maxLevel, decided, total, progress, teams }) => (
  <div className="border-base-300 bg-base-200 mx-auto mb-1.5 flex max-w-screen-sm flex-wrap items-center gap-2.5 rounded-full border px-4 py-2.5">
    <div className="text-base-content text-xs">
      {champ ? (
        <span>
          <b className="text-primary font-semibold">{teams[champ]?.name}</b>{' '}
          lifts the trophy.
        </span>
      ) : (
        <span>
          <b className="text-primary font-semibold">
            {currentLevel ? roundName(currentLevel, maxLevel) : '—'}
          </b>{' '}
          · {decided} / {total} matches decided
        </span>
      )}
    </div>
    <div className="bg-base-300 h-1 min-w-20 flex-1 overflow-hidden rounded-full">
      <div
        className="bg-primary h-full transition-all duration-500 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  </div>
);
