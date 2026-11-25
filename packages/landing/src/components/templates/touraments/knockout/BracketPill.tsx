import type { FC } from 'react';

import type { BracketNode, TeamInfo } from '@/data/touraments/types/bracket';

export const BracketPill: FC<{
  node: BracketNode;
  pos: { x: number; y: number };
  team: string | null;
  info: TeamInfo | null;
  eliminated: boolean;
  canPick: boolean;
  invited: boolean;
  decided: boolean;
  isChampion?: boolean;
  onPick: () => void;
}> = ({
  node,
  pos,
  team,
  info,
  eliminated,
  canPick,
  invited,
  decided,
  isChampion,
  onPick,
}) => {
  const inner = [
    'flex h-full w-full items-center justify-center rounded-full border-2 bg-base-100 text-center transition-all duration-500',
    !team &&
      'border-dashed border-base-300 bg-transparent cursor-default scale-100 opacity-100',
    eliminated && 'scale-75 border-base-300 opacity-30 grayscale',
    decided && 'border-primary shadow-lg shadow-primary/30 cursor-default',
    invited && 'border-warning animate-pulse',
    canPick && !invited && team && 'border-base-300',
    canPick && 'cursor-pointer',
    !canPick && team && 'cursor-default',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-500"
      style={{
        width: isChampion ? '10%' : '7.6%',
        left: `${pos.x}%`,
        top: `${pos.y}%`,
      }}
      onClick={canPick ? onPick : undefined}>
      {isChampion && (
        <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 text-lg drop-shadow-lg sm:text-xl">
          🏆
        </span>
      )}
      <div className={inner}>
        {info && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://flagcdn.com/w80/${info.iso}.png`}
            alt={info.name}
            className="bg-base-300 block size-5/6 rounded-full object-cover object-center"
            loading="eager"
          />
        )}
      </div>
      {node.kind === 'leaf' && (
        <div
          className={`absolute -bottom-4 left-1/2 -translate-x-1/2 text-xs tracking-wider ${
            eliminated
              ? 'text-base-content/40 line-through'
              : 'text-base-content/60'
          }`}>
          {info?.id?.toUpperCase() ?? ''}
        </div>
      )}
    </div>
  );
};
