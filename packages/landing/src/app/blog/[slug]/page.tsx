import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from '@/components/shared/Markdown';
import { formatPostDate } from '@/lib/format';
import { getPost, getPosts } from '@/lib/blog';
import { getSeriesBySlug, seriesReadingOrder } from '@/lib/series';
import { seriesTitle } from '@/lib/series-meta';
import { repositoryUrl, siteName, siteUrl } from '@/lib/site';

export const dynamicParams = false;

export const generateStaticParams = () => {
  return getPosts().map((post) => ({ slug: post.slug }));
};

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> => {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};

  const title = `${post.title} | ${siteName} Blog`;
  const description =
    post.description || `Read ${post.title} on the ${siteName} blog.`;
  const url = `${siteUrl}/blog/${post.slug}`;

  return {
    title,
    description,
    keywords: post.tags.join(', '),
    authors: [{ name: post.author || siteName }],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author || siteName],
      tags: post.tags,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
};

type BlogPostPageProps = Readonly<{
  params: Promise<{ slug: string }>;
}>;

const BlogPostPage = async ({ params }: BlogPostPageProps) => {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const posts = getPosts();
  const currentIndex = posts.findIndex((p) => p.slug === slug);
  const previous = currentIndex > 0 ? posts[currentIndex - 1] : undefined;
  const next =
    currentIndex >= 0 && currentIndex < posts.length - 1
      ? posts[currentIndex + 1]
      : undefined;

  const series = post.series ? getSeriesBySlug(post.series) : undefined;
  const seriesPosts = series ? seriesReadingOrder(series.posts) : [];
  const seriesIndex = seriesPosts.findIndex((p) => p.slug === slug);
  const nextInSeries =
    seriesIndex >= 0 ? seriesPosts[seriesIndex + 1] : undefined;
  const notebookUrl = post.notebook
    ? `${repositoryUrl}/blob/master/packages/landing/${post.notebook}`
    : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-16">
      <nav className="text-base-content/60 mb-8 flex items-center gap-3 text-xs">
        <Link href="/blog" className="hover:text-primary">
          ← All posts
        </Link>
        {post.date ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>{post.readingTime} min read</span>
        {post.author ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{post.author}</span>
          </>
        ) : null}
        {post.series ? (
          <>
            <span aria-hidden="true">·</span>
            <Link
              href={`/blog/series/${post.series}`}
              className="hover:text-primary">
              {seriesTitle(post.series)}
            </Link>
          </>
        ) : null}
      </nav>

      <h1 className="text-base-content text-3xl font-bold tracking-tight sm:text-4xl">
        {post.title}
      </h1>
      {post.description ? (
        <p className="text-base-content/60 mt-3 text-lg">{post.description}</p>
      ) : null}
      {post.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span key={tag} className="badge badge-ghost badge-sm">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <article className="mt-8">
        <Markdown content={post.content} />
      </article>

      {notebookUrl ? (
        <aside className="border-base-300 bg-base-200/50 mt-10 rounded-xl border p-4">
          <p className="text-base-content/70 text-sm">
            <span className="text-base-content font-medium">
              Reproduce this analysis
            </span>{' '}
            — the numbers come from a{' '}
            <a
              href={notebookUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline">
              Mars notebook
            </a>{' '}
            (<code className="text-xs">{post.notebook}</code>) run against the
            soccers dataset.
          </p>
        </aside>
      ) : null}

      {series && seriesIndex >= 0 ? (
        <div className="border-base-300 mt-6 rounded-xl border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              href={`/blog/series/${series.slug}`}
              className="text-primary text-sm font-medium hover:underline">
              {series.title}
            </Link>
            <span className="text-base-content/50 text-xs">
              {seriesIndex + 1} of {seriesPosts.length}
            </span>
          </div>
          {nextInSeries ? (
            <Link
              href={`/blog/${nextInSeries.slug}`}
              className="group mt-2 block">
              <span className="text-base-content/50 text-xs">
                Next in series
              </span>
              <span className="text-base-content group-hover:text-primary font-medium">
                {nextInSeries.title} →
              </span>
            </Link>
          ) : (
            <p className="text-base-content/50 mt-2 text-xs">
              Last post in this series — browse the full series for more.
            </p>
          )}
        </div>
      ) : null}

      <nav className="border-base-content/10 mt-12 flex items-center justify-between gap-4 border-t pt-6">
        <div className="flex-1">
          {previous ? (
            <Link
              className="group border-base-300 hover:border-primary/60 flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition"
              href={`/blog/${previous.slug}`}>
              <span aria-hidden="true">←</span>
              <span className="flex flex-col">
                <span className="text-base-content/50 text-xs">Previous</span>
                <span className="font-medium">{previous.title}</span>
              </span>
            </Link>
          ) : null}
        </div>
        <div className="flex-1 text-right">
          {next ? (
            <Link
              className="group border-base-300 hover:border-primary/60 ml-auto flex items-center justify-end gap-2 rounded-lg border px-4 py-2 text-sm transition"
              href={`/blog/${next.slug}`}>
              <span className="flex flex-col items-end">
                <span className="text-base-content/50 text-xs">Next</span>
                <span className="font-medium">{next.title}</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </nav>
    </main>
  );
};

export default BlogPostPage;
