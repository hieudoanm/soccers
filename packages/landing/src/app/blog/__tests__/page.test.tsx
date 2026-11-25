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
    expect(
      screen.getByRole('link', { name: /Welcome to soccers/ })
    ).toHaveAttribute('href', '/blog/welcome-to-soccers');
  });
});
