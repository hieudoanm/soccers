import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatPostDate } from '@/lib/format';
import { getSeries, getSeriesBySlug, seriesReadingOrder } from '@/lib/series';
import { siteName, siteUrl } from '@/lib/site';

export const dynamicParams = false;

export const generateStaticParams = () =>
  getSeries().map((series) => ({ slug: series.slug }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> => {
  const { slug } = await params;
  const series = getSeriesBySlug(slug);
  if (!series) return {};

  const title = `${series.title} | ${siteName} Blog`;
  const url = `${siteUrl}/blog/series/${series.slug}`;
  return {
    title,
    description: series.description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: series.description,
      url,
      siteName,
      type: 'website',
    },
  };
};

type SeriesPageProps = Readonly<{
  params: Promise<{ slug: string }>;
}>;

const SeriesDetailPage = async ({ params }: SeriesPageProps) => {
  const { slug } = await params;
  const series = getSeriesBySlug(slug);
  if (!series) notFound();

  const posts = seriesReadingOrder(series.posts);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-16">
      <div className="mb-10">
        <nav className="text-base-content/60 mb-4 text-xs">
          <Link href="/blog" className="hover:text-primary">
            ← All posts
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/blog/series" className="hover:text-primary">
            All series
          </Link>
        </nav>
        <h1 className="text-base-content text-3xl font-bold tracking-tight">
          {series.title}
        </h1>
        <p className="text-base-content/60 mt-2">{series.description}</p>
        <p className="text-base-content/50 mt-1 text-sm">
          {posts.length} {posts.length === 1 ? 'post' : 'posts'}
        </p>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {posts.map((post, index) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className="card border-base-300 bg-base-100 hover:border-primary/60 group flex h-full flex-col border p-5 transition">
              <div className="text-base-content/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-primary font-medium">#{index + 1}</span>
                {post.date ? (
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                ) : null}
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
              <span className="text-primary mt-auto pt-4 text-sm font-medium">
                Read post →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
};

export default SeriesDetailPage;
