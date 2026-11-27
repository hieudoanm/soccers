import Link from 'next/link';
import type { FC } from 'react';

export interface TournamentDef {
  id: string;
  label: string;
  subtitle: string;
  href: string;
  editions: number;
  firstYear: number;
  lastYear: number;
  description: string;
}

export const TournamentCard: FC<{ t: TournamentDef }> = ({ t }) => (
  <Link
    href={t.href}
    className="group border-base-300 bg-base-100 hover:border-primary/50 hover:bg-primary/5 block rounded-xl border p-6 text-center transition-all duration-200 hover:-translate-y-1">
    <div className="text-primary mb-1 text-xs uppercase">{t.subtitle}</div>
    <h2 className="text-base-content group-hover:text-primary text-2xl font-bold tracking-tight transition-colors duration-200">
      {t.label}
    </h2>
    <div className="text-base-content/70 mt-2 text-sm">
      {t.editions} editions &middot; {t.firstYear}&ndash;{t.lastYear}
    </div>
    <p className="text-base-content/60 mx-auto mt-3 max-w-sm text-xs leading-relaxed">
      {t.description}
    </p>
  </Link>
);
