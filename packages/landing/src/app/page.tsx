import type { Metadata } from 'next';
import type { NextPage } from 'next';
import {
  PiBracketsCurly,
  PiChartLineUp,
  PiDatabase,
  PiFileCsv,
  PiHardDrives,
  PiPulse,
} from 'react-icons/pi';
import CTA from '@/components/molecules/CTA';
import Features, { type Feature } from '@/components/molecules/Features';
import Hero from '@/components/molecules/Hero';
import MatchAnalysis from '@/components/molecules/MatchAnalysis';
import { repositoryUrl } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const FEATURES: Feature[] = [
  {
    title: 'Match history',
    body: '~300k matches across 60+ leagues and tournaments, from 1958 to the present season',
    icon: PiDatabase,
  },
  {
    title: 'Event-level stats',
    body: 'Every pass, shot, card and substitution — aggregated into player and team match stats',
    icon: PiPulse,
  },
  {
    title: 'Open data pipeline',
    body: 'Idempotent importers for football-data.co.uk and StatsBomb open data, with CSV exports',
    icon: PiFileCsv,
  },
  {
    title: 'Analysis playground',
    body: 'A curated dataset for football analytics experiments, built with Mars notebooks',
    icon: PiChartLineUp,
  },
  {
    title: 'Typed schema contracts',
    body: 'Prisma 8 contracts emit TypeScript types and DBML/ER diagrams — the schema is reviewed like code',
    icon: PiBracketsCurly,
  },
  {
    title: 'One portable database',
    body: 'The entire history lives in a single SQLite file — no server, query it with sqlite3 or any notebook',
    icon: PiHardDrives,
  },
];

const HomePage: NextPage = () => (
  <>
    <Hero
      title="Every match. Every stat. One database."
      description="A historical football/soccer data platform — results, standings, and event-level stats across 60+ leagues and tournaments, stored in SQLite via Prisma 8."
      primary={{ label: 'Explore the data', href: '/blog/' }}
      secondary={{
        label: 'View on GitHub',
        href: repositoryUrl,
        external: true,
      }}
      stats={[
        { value: '~300k', label: 'matches' },
        { value: '11k+', label: 'players' },
        { value: '60+', label: 'leagues' },
      ]}>
      <MatchAnalysis />
    </Hero>
    <Features
      title="What is inside"
      description="One SQLite database covering the modern game — from World Cups to domestic leagues."
      features={FEATURES}
    />
    <CTA
      title="New analysis posts soon"
      description="Data explorations, model experiments, and visualisations — published here as they are completed."
      primary={{ label: 'Explore the data', href: '/blog/' }}
      secondary={{
        label: 'View on GitHub',
        href: repositoryUrl,
        external: true,
      }}
    />
  </>
);

export default HomePage;
