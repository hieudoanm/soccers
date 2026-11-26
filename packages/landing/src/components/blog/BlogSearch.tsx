'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatPostDate } from '@/lib/format';
import { seriesTitle } from '@/lib/series-meta';

export type SearchablePost = {
  slug: string;
  title: string;
  description?: string;
  series?: string;
  date?: string;
  readingTime: number;
  tags: string[];
};

const scorePost = (post: SearchablePost, query: string): number => {
  const q = query.toLowerCase();
  let score = 0;
  if (post.title.toLowerCase().includes(q)) score += 4;
  if (post.slug.replace(/-/g, ' ').includes(q)) score += 3;
  if (post.tags.some((tag) => tag.toLowerCase().includes(q))) score += 2;
  if (seriesTitle(post.series)?.toLowerCase().includes(q)) score += 2;
  if (post.description?.toLowerCase().includes(q)) score += 1;
  return score;
};

type BlogSearchProps = Readonly<{ posts: SearchablePost[] }>;

export default function BlogSearch({ posts }: BlogSearchProps) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return posts
      .map((post) => ({ post, score: scorePost(post, q) }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.post.title.localeCompare(b.post.title)
      )
      .slice(0, 50)
      .map((r) => r.post);
  }, [posts, query]);

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search posts by title, tag or topic…"
        aria-label="Search blog posts"
        className="input input-bordered border-base-300 bg-base-100 w-full"
        autoFocus
      />

      {query.trim() === '' ? (
        <p className="text-base-content/60 mt-6 text-sm">
          Type to search {posts.length} posts — titles, tags, series and
          descriptions are all indexed.
        </p>
      ) : results.length === 0 ? (
        <p className="text-base-content/60 mt-6 text-sm">
          No posts match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <>
          <p className="text-base-content/50 mt-4 text-xs">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </p>
          <ul className="mt-3 grid gap-3">
            {results.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="card border-base-300 bg-base-100 hover:border-primary/60 group block border p-4 transition">
                  <div className="text-base-content/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {post.date ? (
                      <time dateTime={post.date}>
                        {formatPostDate(post.date)}
                      </time>
                    ) : null}
                    {post.series ? (
                      <span className="text-primary">
                        {seriesTitle(post.series)}
                      </span>
                    ) : null}
                    <span>· {post.readingTime} min read</span>
                  </div>
                  <h2 className="text-base-content group-hover:text-primary mt-1 font-semibold">
                    {post.title}
                  </h2>
                  {post.description ? (
                    <p className="text-base-content/60 mt-1 line-clamp-2 text-sm">
                      {post.description}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
