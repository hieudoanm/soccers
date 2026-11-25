import { render, screen } from '@testing-library/react';
import BlogPostPage, { generateStaticParams } from '../page';

const renderPost = async (slug: string) =>
  render(await BlogPostPage({ params: Promise.resolve({ slug }) }));

describe('BlogPostPage', () => {
  it('generates static params for all posts', () => {
    const slugs = generateStaticParams().map((p) => p.slug);
    expect(slugs).toContain('welcome-to-soccers');
    expect(slugs).toContain('inside-the-database');
  });

  it('renders the post title, tags and content', async () => {
    await renderPost('welcome-to-soccers');
    expect(
      screen.getAllByRole('heading', { name: 'Welcome to soccers' }).length
    ).toBeGreaterThan(0);
    expect(screen.getByText('intro')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
  });

  it('renders previous/next navigation', async () => {
    await renderPost('inside-the-database');
    expect(
      screen.getByRole('link', { name: /Welcome to soccers/ })
    ).toHaveAttribute('href', '/blog/welcome-to-soccers');
  });
});
