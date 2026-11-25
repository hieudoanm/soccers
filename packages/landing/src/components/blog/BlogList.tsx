'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatPostDate } from '@/lib/format';
import type { Post } from '@/lib/blog';
import { seriesTitle } from '@/lib/series-meta';

const POSTS_PER_PAGE = 10;

type BlogListProps = Readonly<{ posts: Post[] }>;

export default function BlogList({ posts }: BlogListProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const paginatedPosts = posts.slice(startIndex, endIndex);

  if (posts.length === 0) {
    return <p className="text-base-content/60">No posts yet.</p>;
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2">
        {paginatedPosts.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className="card border-base-300 bg-base-100 hover:border-primary/60 group flex h-full flex-col border p-5 transition">
              <div className="text-base-content/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {post.date ? (
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                ) : null}
                {post.author ? <span>· {post.author}</span> : null}
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

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="btn btn-outline btn-sm">
            ← Previous
          </button>
          <span className="text-base-content/60 mx-4 text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="btn btn-outline btn-sm">
            Next →
          </button>
        </div>
      )}
    </>
  );
}
