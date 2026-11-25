import type { FC, ReactNode } from 'react';

export const PageHeader: FC<{
  subtitle: string;
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}> = ({ subtitle, title, description, className = 'mb-6', children }) => (
  <header className={`text-center ${className}`}>
    <div className="text-primary mb-1.5 text-xs uppercase">{subtitle}</div>
    <h1 className="text-base-content m-0 mb-1.5 text-2xl font-semibold tracking-wide sm:text-3xl lg:text-4xl">
      {title}
    </h1>
    {children}
    {description && (
      <p className="text-base-content/60 mx-auto max-w-lg text-sm leading-relaxed">
        {description}
      </p>
    )}
  </header>
);
