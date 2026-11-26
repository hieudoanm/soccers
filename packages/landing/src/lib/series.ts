import { getPosts, type Post } from '@/lib/blog';
import { SERIES_META } from '@/lib/series-meta';

export type Series = {
  slug: string;
  title: string;
  description: string;
  posts: Post[];
};

const SERIES_ORDER = [
  'match-analysis',
  'management',
  'record-books',
  'transfers',
  'awards',
];

export const getSeries = (): Series[] => {
  const posts = getPosts();
  return SERIES_ORDER.filter((slug) => SERIES_META[slug])
    .map((slug) => ({
      slug,
      title: SERIES_META[slug].title,
      description: SERIES_META[slug].description,
      posts: posts.filter((post) => post.series === slug),
    }))
    .filter((series) => series.posts.length > 0);
};

export const getSeriesBySlug = (slug: string): Series | undefined =>
  getSeries().find((series) => series.slug === slug);

// Within a series, `order` is the intended reading sequence; fall back to
// newest-first for posts without one.
export const seriesReadingOrder = (posts: Post[]): Post[] =>
  [...posts].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return a.title.localeCompare(b.title);
  });
