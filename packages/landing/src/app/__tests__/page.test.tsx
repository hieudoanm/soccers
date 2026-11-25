import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('renders the hero tagline', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', {
        name: 'Every match. Every stat. One database.',
      })
    ).toBeInTheDocument();
  });

  it('links to the blog', () => {
    render(<HomePage />);
    expect(
      screen.getAllByRole('link', { name: 'Explore the data' })[0]
    ).toHaveAttribute('href', '/blog');
  });
});
