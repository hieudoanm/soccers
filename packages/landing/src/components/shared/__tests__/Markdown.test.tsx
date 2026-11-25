import { render, screen } from '@testing-library/react';
import Markdown from '../Markdown';

describe('Markdown', () => {
  it('renders markdown content', () => {
    render(<Markdown content={'# Title\n\nSome **bold** text.'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('allows data image URLs and transforms other URLs', () => {
    render(
      <Markdown
        content={
          '![pixel](data:image/png;base64,AAA)\n\n[link](https://example.com)'
        }
      />
    );

    expect(screen.getByRole('img', { name: 'pixel' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AAA'
    );
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
  });
});
