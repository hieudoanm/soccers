import { getPost, getPosts } from '@/lib/blog';
import { getSeries, getSeriesBySlug, seriesReadingOrder } from '@/lib/series';

describe('getPosts', () => {
  it('returns the markdown posts sorted by date, latest first', () => {
    const posts = getPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].slug).toBe('discipline-report');
    expect(posts[posts.length - 1].slug).toBe('welcome-to-soccers');
  });

  it('parses front matter', () => {
    const post = getPosts().find((p) => p.slug === 'welcome-to-soccers');
    expect(post?.title).toBe('Welcome to soccers');
    expect(post?.author).toBe('hieudoan');
    expect(post?.tags).toContain('intro');
    expect(post?.content).toContain('# Welcome to soccers');
  });

  it('assigns posts to series by directory', () => {
    const post = getPosts().find((p) => p.slug === 'best-of-premier-league');
    expect(post?.series).toBe('record-books');
    const root = getPosts().find((p) => p.slug === 'welcome-to-soccers');
    expect(root?.series).toBeUndefined();
  });
});

describe('getSeries', () => {
  it('groups posts into ordered series', () => {
    const series = getSeries();
    expect(series.map((s) => s.slug)).toEqual([
      'match-analysis',
      'management',
      'record-books',
      'transfers',
      'awards',
    ]);
    expect(series[2].posts.length).toBe(20);
    expect(series[0].posts.length).toBe(24);
    expect(series[3].posts.length).toBe(5);
    expect(series[4].posts.length).toBe(1);
    expect(series.every((s) => s.posts.length > 0)).toBe(true);
  });

  it('resolves a series by slug and orders posts for reading', () => {
    const series = getSeriesBySlug('match-analysis');
    expect(series?.title).toBe('Match Analysis');
    const ordered = series ? seriesReadingOrder(series.posts) : [];
    const orders = ordered.map((p) => p.order ?? Number.MAX_SAFE_INTEGER);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe('getPost', () => {
  it('finds a post by slug', () => {
    const post = getPost('xg-luck');
    expect(post?.title).toContain('xG luck index');
  });

  it('computes reading time and links the analysis notebook', () => {
    const post = getPost('corners');
    expect(post?.wordCount).toBeGreaterThan(0);
    expect(post?.readingTime).toBeGreaterThanOrEqual(1);
    expect(post?.notebook).toBe('mars/posts/match-analysis/corners.mars');
  });

  it('rejects invalid slugs', () => {
    expect(getPost('../etc/passwd')).toBeUndefined();
    expect(getPost('does-not-exist')).toBeUndefined();
  });
});
