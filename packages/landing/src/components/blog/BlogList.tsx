'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatPostDate } from '@/lib/format';
import type { Post } from '@/lib/blog';
import { seriesTitle } from '@/lib/series-meta';

const POSTS_PER_PAGE = 10;
const PINNED_SLUG = 'welcome-to-soccers';

type BlogListProps = Readonly<{ posts: Post[] }>;

const PinnedCard = ({ post }: Readonly<{ post: Post }>) => (
  <Link
    href={`/blog/${post.slug}`}
    className="card border-primary/40 bg-primary/5 hover:border-primary group mb-6 flex flex-col gap-2 border p-6 transition sm:flex-row sm:items-center sm:gap-6">
    <div className="shrink-0">
      <span className="badge badge-primary badge-sm">Start here</span>
    </div>
    <div className="min-w-0">
      <h2 className="text-base-content group-hover:text-primary text-xl font-semibold">
        {post.title}
      </h2>
      {post.description ? (
        <p className="text-base-content/60 mt-1 line-clamp-2 text-sm">
          {post.description}
        </p>
      ) : null}
      <span className="text-base-content/50 mt-2 block text-xs">
        {post.date ? `${formatPostDate(post.date)} · ` : ''}
        {post.readingTime} min read
      </span>
    </div>
    <span className="text-primary shrink-0 text-sm font-medium sm:ml-auto">
      Read post →
    </span>
  </Link>
);

export default function BlogList({ posts }: BlogListProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const pinned = posts.find((post) => post.slug === PINNED_SLUG);
  const unpinned = posts.filter((post) => post.slug !== PINNED_SLUG);

  const allTags = [...new Set(unpinned.flatMap((post) => post.tags))].sort(
    (a, b) => a.localeCompare(b)
  );
  const filteredPosts = activeTag
    ? unpinned.filter((post) => post.tags.includes(activeTag))
    : unpinned;

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPosts.length / POSTS_PER_PAGE)
  );
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * POSTS_PER_PAGE;
  const paginatedPosts = filteredPosts.slice(
    startIndex,
    startIndex + POSTS_PER_PAGE
  );

  const selectTag = (tag: string | null) => {
    setActiveTag(tag);
    setCurrentPage(1);
  };

  if (posts.length === 0) {
    return <p className="text-base-content/60">No posts yet.</p>;
  }

  return (
    <>
      {pinned ? <PinnedCard post={pinned} /> : null}

      {allTags.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => selectTag(null)}
            className={`badge badge-sm cursor-pointer transition ${
              activeTag === null
                ? 'badge-primary'
                : 'badge-ghost hover:badge-primary'
            }`}>
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => selectTag(activeTag === tag ? null : tag)}
              className={`badge badge-sm cursor-pointer transition ${
                activeTag === tag
                  ? 'badge-primary'
                  : 'badge-ghost hover:badge-primary'
              }`}>
              {tag}
            </button>
          ))}
        </div>
      )}

      {filteredPosts.length === 0 ? (
        <p className="text-base-content/60">
          No posts tagged &ldquo;{activeTag}&rdquo;.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {paginatedPosts.map((post) => (
            <li key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="card border-base-300 bg-base-100 hover:border-primary/60 group flex h-full flex-col border p-5 transition">
                <div className="text-base-content/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {post.date ? (
                    <time dateTime={post.date}>
                      {formatPostDate(post.date)}
                    </time>
                  ) : null}
                  {post.author ? <span>· {post.author}</span> : null}
                  <span>· {post.readingTime} min read</span>
                </div>
                <h2 className="text-base-content group-hover:text-primary mt-2 text-lg font-semibold">
                  {post.title}
                </h2>
                {post.description ? (
                  <p className="text-base-content/60 mt-1 line-clamp-3 text-sm">
                    {post.description}
                  </p>
                ) : null}
                {post.series ? (
                  <span className="badge badge-primary badge-sm mt-3 w-fit">
                    {seriesTitle(post.series)}
                  </span>
                ) : null}
                {post.tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {post.tags.map((tag) => (
                      <span key={tag} className="badge badge-ghost badge-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <span className="text-primary mt-auto pt-4 text-sm font-medium">
                  Read post →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="btn btn-outline btn-sm">
            ← Previous
          </button>
          <span className="text-base-content/60 mx-4 text-sm">
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="btn btn-outline btn-sm">
            Next →
          </button>
        </div>
      )}
    </>
  );
}
