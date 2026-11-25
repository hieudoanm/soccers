import type { FC } from 'react';

export const Legend: FC = () => (
  <div className="text-base-content/60 mt-4 flex flex-wrap justify-center gap-4 text-xs">
    <span className="inline-flex items-center gap-1.5">
      <span className="bg-warning inline-block h-2 w-2 rounded-full" /> Click to
      advance
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="bg-primary inline-block h-2 w-2 rounded-full" /> Through
      to the next round
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="bg-base-300 inline-block h-2 w-2 rounded-full" />{' '}
      Eliminated
    </span>
  </div>
);
