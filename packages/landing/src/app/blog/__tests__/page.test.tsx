import { render, screen } from '@testing-library/react';
import { getPosts } from '@/lib/blog';
import BlogPage from '../page';

describe('BlogPage', () => {
  it('renders the heading and post count', () => {
    render(<BlogPage />);
    expect(screen.getByRole('heading', { name: 'Blog' })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${getPosts().length} posts`))
    ).toBeInTheDocument();
  });

  it('lists posts', () => {
    render(<BlogPage />);
    const [latest] = getPosts();
    expect(
      screen.getByRole('link', { name: new RegExp(latest.title) })
    ).toHaveAttribute('href', `/blog/${latest.slug}`);
  });
});
