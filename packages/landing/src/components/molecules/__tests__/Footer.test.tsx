import { render, screen } from '@testing-library/react';
import Footer from '../Footer';

const PROPS = {
  name: 'soccers',
  tagline: 'Food & Drink · Static site · MIT licensed',
  githubUrl: 'https://github.com/hieudoanm/soccers',
};

describe('Footer', () => {
  it('renders the copyright, tagline and footer links', () => {
    render(<Footer {...PROPS} />);
    expect(
      screen.getByText(`© ${new Date().getFullYear()} soccers`)
    ).toBeInTheDocument();
    expect(screen.getByText(/Food & Drink/)).toBeInTheDocument();

    const github = screen.getByRole('link', { name: /GitHub/ });
    expect(github).toHaveAttribute(
      'href',
      'https://github.com/hieudoanm/soccers'
    );
    expect(github).toHaveAttribute('target', '_blank');

    const readme = screen.getByRole('link', { name: 'README' });
    expect(readme).toHaveAttribute(
      'href',
      'https://github.com/hieudoanm/soccers#readme'
    );
  });
});
