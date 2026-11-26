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

  it('renders key-finding blockquotes as callouts', () => {
    const { container } = render(
      <Markdown
        content={
          '> **Key finding:** corners barely predict winning.\n>\n> More detail here.\n\n> A regular quote.'
        }
      />
    );

    const asides = container.querySelectorAll('aside');
    expect(asides).toHaveLength(1);
    expect(asides[0]).toHaveTextContent('corners barely predict winning');
    expect(container.querySelectorAll('blockquote')).toHaveLength(1);
  });
});
