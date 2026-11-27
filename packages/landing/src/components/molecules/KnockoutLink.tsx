import Link from 'next/link';
import type { FC } from 'react';

import { TOURNAMENT_CONFIG } from '@/data/touraments/tournament';
import type { TournamentSlug } from '@/data/touraments/tournament';

export const KnockoutLink: FC<{
  year: number;
  tournament?: TournamentSlug;
}> = ({ year, tournament = 'world-cup' }) => {
  const config = TOURNAMENT_CONFIG[tournament];
  return (
    <div className="mb-6 flex justify-center">
      <Link
        href={`${config.hrefPrefix}/${year}/knock-out`}
        className="border-base-300 bg-base-200 text-primary hover:border-primary rounded-full border px-4 py-1.5 text-xs font-medium transition-colors">
        View Knockout Bracket →
      </Link>
    </div>
  );
};
