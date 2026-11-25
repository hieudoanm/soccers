import type { Metadata } from 'next';
import Link from 'next/link';
import BlogList from '@/components/blog/BlogList';
import { getPosts } from '@/lib/blog';
import { siteName, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: `Blog | ${siteName}`,
  description:
    'Posts on football data analysis, the soccers dataset, and experiments run with Mars.',
  alternates: {
    canonical: `${siteUrl}/blog`,
  },
  openGraph: {
    title: `Blog | ${siteName}`,
    description:
      'Posts on football data analysis, the soccers dataset, and experiments run with Mars.',
    url: `${siteUrl}/blog`,
    siteName,
    type: 'website',
  },
};

export default function BlogPage() {
  const posts = getPosts();

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-16">
      <div className="mb-10">
        <h1 className="text-base-content text-3xl font-bold tracking-tight">
          Blog
        </h1>
        <p className="text-base-content/60 mt-2">
          Football data analysis, the soccers dataset, and experiments run with
          Mars.
        </p>
        <p className="text-base-content/50 mt-1 text-sm">
          {posts.length} {posts.length === 1 ? 'post' : 'posts'} ·{' '}
          <Link href="/blog/series" className="hover:text-primary">
            Browse series →
          </Link>
        </p>
      </div>

      <BlogList posts={posts} />
    </main>
  );
}
