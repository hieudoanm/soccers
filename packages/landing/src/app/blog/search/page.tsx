import type { Metadata } from 'next';
import Link from 'next/link';
import BlogSearch from '@/components/blog/BlogSearch';
import { getPosts } from '@/lib/blog';
import { siteName, siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: `Search | ${siteName} Blog`,
  description: 'Search football data analysis posts by title, tag or topic.',
  alternates: {
    canonical: `${siteUrl}/blog/search`,
  },
};

export default function BlogSearchPage() {
  const posts = getPosts().map((post) => ({
    slug: post.slug,
    title: post.title,
    description: post.description,
    series: post.series,
    date: post.date,
    readingTime: post.readingTime,
    tags: post.tags,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-16">
      <div className="mb-8">
        <nav className="text-base-content/60 mb-4 text-xs">
          <Link href="/blog" className="hover:text-primary">
            ← All posts
          </Link>
        </nav>
        <h1 className="text-base-content text-3xl font-bold tracking-tight">
          Search
        </h1>
      </div>

      <BlogSearch posts={posts} />
    </main>
  );
}
