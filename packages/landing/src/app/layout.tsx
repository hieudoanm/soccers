import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import type { FC, ReactNode } from 'react';
import Navbar from '@/components/molecules/Navbar';
import Footer from '@/components/molecules/Footer';
import { repositoryUrl, siteName, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'soccers',
  description: 'Every match. Every stat. One database.',
  keywords: [
    'football data',
    'soccer data',
    'football statistics',
    'sqlite',
    'prisma',
    'open data',
  ],
  authors: [{ name: 'hieudoan', url: 'https://github.com/hieudoanm/soccers' }],
  category: 'sports',
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: 'website',
    siteName,
    url: siteUrl,
    title: 'soccers — Every match. Every stat. One database.',
    description:
      'A historical football/soccer data platform: ~300k matches, event-level stats, 60+ leagues, SQLite via Prisma 8.',
    images: [
      {
        url: `${siteUrl}/og.png`,
        width: 1280,
        height: 640,
        alt: 'soccers — Every match. Every stat. One database.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'soccers — Every match. Every stat. One database.',
    description:
      'A historical football/soccer data platform: ~300k matches, event-level stats, 60+ leagues, SQLite via Prisma 8.',
    images: [`${siteUrl}/og.png`],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const inter = Inter({ subsets: ['latin'] });

const NAV_LINKS = [{ label: 'Blog', href: '/blog/' }];

const RootLayout: FC<{ children: ReactNode }> = ({ children }) => (
  <html lang="en" data-theme="soccers" className={inter.className}>
    <body className="bg-base-100 text-base-content flex min-h-screen flex-col">
      <Navbar
        name={siteName}
        logoSrc={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo.svg`}
        links={NAV_LINKS}
        githubUrl={repositoryUrl}
      />
      <div className="flex-1">{children}</div>
      <Footer
        name={siteName}
        tagline="Football data · SQLite · MIT licensed"
        githubUrl={repositoryUrl}
      />
    </body>
  </html>
);

export default RootLayout;
