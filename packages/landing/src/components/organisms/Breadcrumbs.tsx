import Link from 'next/link';
import type { FC } from 'react';

export interface YearOption {
  year: number;
  href: string;
}

export interface Crumb {
  label: string;
  href?: string;
  years?: YearOption[];
}

export const Breadcrumbs: FC<{ crumbs: Crumb[] }> = ({ crumbs }) => (
  <nav className="text-base-content/60 mb-6 flex items-center gap-2 text-xs">
    {crumbs.map((crumb, i) => (
      <span key={i} className="flex items-center gap-2">
        {i > 0 && <span className="text-base-content/30">/</span>}
        {crumb.years ? (
          <select
            value={crumb.href ?? ''}
            onChange={(e) => {
              window.location.href = e.target.value;
            }}
            className="text-base-content/80 hover:text-primary cursor-pointer bg-transparent transition-colors outline-none">
            {crumb.years.map((y) => (
              <option key={y.year} value={y.href}>
                {y.year}
              </option>
            ))}
          </select>
        ) : crumb.href ? (
          <Link
            href={crumb.href}
            className="hover:text-primary transition-colors">
            {crumb.label}
          </Link>
        ) : (
          <span className="text-base-content">{crumb.label}</span>
        )}
      </span>
    ))}
  </nav>
);
