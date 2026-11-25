import { getPost, getPosts } from '@/lib/blog';

describe('getPosts', () => {
  it('returns the markdown posts sorted by date, latest first', () => {
    const posts = getPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].slug).toBe('manager-debut');
    expect(posts[posts.length - 1].slug).toBe('welcome-to-soccers');
  });

  it('parses front matter', () => {
    const post = getPosts().find((p) => p.slug === 'welcome-to-soccers');
    expect(post?.title).toBe('Welcome to soccers');
    expect(post?.author).toBe('hieudoan');
    expect(post?.tags).toContain('intro');
    expect(post?.content).toContain('# Welcome to soccers');
  });
});

describe('getPost', () => {
  it('finds a post by slug', () => {
    const post = getPost('inside-the-database');
    expect(post?.title).toBe('Inside the database: a tour of the schema');
  });

  it('rejects invalid slugs', () => {
    expect(getPost('../etc/passwd')).toBeUndefined();
    expect(getPost('does-not-exist')).toBeUndefined();
  });
});
