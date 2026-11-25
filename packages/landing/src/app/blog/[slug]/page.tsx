import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from '@/components/shared/Markdown';
import { formatPostDate } from '@/lib/format';
import { getPost, getPosts } from '@/lib/blog';
import { siteName, siteUrl } from '@/lib/site';

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
        {post.author ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{post.author}</span>
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
