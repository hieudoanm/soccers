import Link from 'next/link';
import type { FC } from 'react';

export const ErrorState: FC<{
  symbol: string;
  message: string;
  backHref?: string;
  backLabel?: string;
}> = ({ symbol, message, backHref, backLabel }) => (
  <div className="bg-base-100 mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
    <div className="text-center">
      <div className="text-base-300 text-6xl font-bold">{symbol}</div>
      <div className="text-base-content/60 mt-2 text-lg">{message}</div>
      {backHref && backLabel && (
        <Link
          href={backHref}
          className="text-primary/70 hover:text-primary mt-4 inline-block text-sm transition-colors">
          ← {backLabel}
        </Link>
      )}
    </div>
  </div>
);
