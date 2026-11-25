import type { Metadata } from 'next';
import Link from 'next/link';
import { formatPostDate } from '@/lib/format';
import { getSeries } from '@/lib/series';
import { siteName, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: `Series | ${siteName} Blog`,
  description:
    'Explore curated series on football match analysis, team management, and record books.',
  alternates: {
    canonical: `${siteUrl}/blog/series`,
  },
  openGraph: {
    title: `Series | ${siteName} Blog`,
    description:
      'Explore curated series on football match analysis, team management, and record books.',
    url: `${siteUrl}/blog/series`,
    siteName,
    type: 'website',
  },
};

export default function SeriesPage() {
  const series = getSeries();

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-16">
      <div className="mb-10">
        <nav className="text-base-content/60 mb-4 text-xs">
          <Link href="/blog" className="hover:text-primary">
            ← All posts
          </Link>
        </nav>
        <h1 className="text-base-content text-3xl font-bold tracking-tight">
          Series
        </h1>
        <p className="text-base-content/60 mt-2">
          Posts grouped into curated series.
        </p>
      </div>

      <div className="grid gap-6">
        {series.map((s) => (
          <section
            key={s.slug}
            id={s.slug}
            className="border-base-300 bg-base-100 scroll-mt-20 rounded-2xl border p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base-content text-xl font-semibold">
                {s.title}
              </h2>
              <span className="text-base-content/50 text-xs">
                {s.posts.length} {s.posts.length === 1 ? 'post' : 'posts'}
              </span>
            </div>
            <p className="text-base-content/60 mt-1 text-sm">{s.description}</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {s.posts.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="group border-base-300 hover:border-primary/60 flex h-full flex-col rounded-xl border p-4 transition">
                    <span className="text-base-content group-hover:text-primary text-sm font-medium">
                      {post.title}
                    </span>
                    {post.date ? (
                      <time
                        dateTime={post.date}
                        className="text-base-content/50 mt-1 text-xs">
                        {formatPostDate(post.date)}
                      </time>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
