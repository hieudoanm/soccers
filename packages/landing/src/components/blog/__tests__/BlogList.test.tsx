import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlogList from '../BlogList';
import type { Post } from '@/lib/blog';

const makePost = (slug: string, order: number): Post => ({
  slug,
  title: `Post ${slug}`,
  description: `Description for ${slug}`,
  author: 'hieudoan',
  date: '2026-11-25',
  order,
  tags: ['football'],
  content: '# body',
});

describe('BlogList', () => {
  it('renders an empty state', () => {
    render(<BlogList posts={[]} />);
    expect(screen.getByText('No posts yet.')).toBeInTheDocument();
  });

  it('renders post cards linking to the post', () => {
    render(<BlogList posts={[makePost('hello', 1)]} />);
    const link = screen.getByRole('link', { name: /Post hello/ });
    expect(link).toHaveAttribute('href', '/blog/hello');
    expect(screen.getByText('football')).toBeInTheDocument();
  });

  it('paginates after 10 posts', async () => {
    const user = userEvent.setup();
    const posts = Array.from({ length: 12 }, (_, i) =>
      makePost(`post-${i}`, i)
    );
    render(<BlogList posts={posts} />);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Post post-11/ })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '← Previous' }));
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('omits optional post fields', () => {
    render(
      <BlogList
        posts={[
          {
            slug: 'minimal',
            title: 'Minimal post',
            tags: [],
            content: '# Minimal post',
          },
        ]}
      />
    );

    expect(
      screen.getByRole('link', { name: /Minimal post/ })
    ).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    expect(screen.queryByText('football')).not.toBeInTheDocument();
  });
});
