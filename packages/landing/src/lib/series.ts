import { getPosts, type Post } from '@/lib/blog';
import { SERIES_META } from '@/lib/series-meta';

export type Series = {
  slug: string;
  title: string;
  description: string;
  posts: Post[];
};

const SERIES_ORDER = ['match-analysis', 'management', 'record-books'];

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
