export const SERIES_META: Record<
  string,
  { title: string; description: string }
> = {
  'match-analysis': {
    title: 'Match Analysis',
    description:
      'Data-driven answers to classic football questions: win streaks, dangerous leads, comebacks, draws, away form and fixture congestion.',
  },
  management: {
    title: 'Management',
    description:
      'Do managerial changes actually work? Two Premier League studies on in-season appointments and debut seasons.',
  },
  'record-books': {
    title: 'Record Books',
    description:
      'Best-of record books for leagues and tournaments — titles, records, unbeaten sides and top scorers.',
  },
};

export const seriesTitle = (slug: string | undefined): string | undefined =>
  slug ? SERIES_META[slug]?.title : undefined;
