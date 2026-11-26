import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlogList from '../BlogList';
import type { Post } from '@/lib/blog';

const makePost = (slug: string, order: number, tags = ['football']): Post => ({
  slug,
  title: `Post ${slug}`,
  description: `Description for ${slug}`,
  author: 'hieudoan',
  date: '2026-11-25',
  order,
  tags,
  content: '# body',
  wordCount: 400,
  readingTime: 2,
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
    expect(screen.getByText(/2 min read/)).toBeInTheDocument();
  });

  it('pins the welcome post outside the paginated grid', () => {
    render(
      <BlogList
        posts={[
          makePost('post-a', 2),
          { ...makePost('welcome-to-soccers', 1), title: 'Welcome!' },
        ]}
      />
    );
    expect(screen.getByText('Start here')).toBeInTheDocument();
    const pinned = screen.getByRole('link', { name: /Welcome!/ });
    expect(pinned).toHaveAttribute('href', '/blog/welcome-to-soccers');
    // pinned post is not duplicated in the grid
    expect(screen.getAllByRole('link', { name: /Welcome!/ })).toHaveLength(1);
  });

  it('filters posts by tag', async () => {
    const user = userEvent.setup();
    render(
      <BlogList
        posts={[
          makePost('one', 1, ['possession']),
          makePost('two', 2, ['corners']),
        ]}
      />
    );
    expect(screen.getByRole('link', { name: /Post one/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Post two/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'possession' }));
    expect(screen.getByRole('link', { name: /Post one/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Post two/ })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('link', { name: /Post two/ })).toBeInTheDocument();
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
            wordCount: 3,
            readingTime: 1,
          },
        ]}
      />
    );

    expect(
      screen.getByRole('link', { name: /Minimal post/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/1 min read/)).toBeInTheDocument();
    expect(screen.queryByText('hieudoan')).not.toBeInTheDocument();
    expect(screen.queryByText('football')).not.toBeInTheDocument();
  });
});
