import { render, screen } from '@testing-library/react';
import Hero from '../Hero';

const PROPS = {
  title: 'Every match. Every stat. One database.',
  description: 'A historical football data platform.',
  primary: { label: 'Explore', href: '/blog/' },
  secondary: {
    label: 'GitHub',
    href: 'https://github.com/hieudoanm/soccers',
    external: true,
  },
  stats: [
    { value: '~300k', label: 'matches' },
    { value: '11k+', label: 'players' },
  ],
};

describe('Hero', () => {
  it('renders title, description and stats', () => {
    render(<Hero {...PROPS} />);
    expect(
      screen.getByRole('heading', { name: PROPS.title })
    ).toBeInTheDocument();
    expect(screen.getByText(PROPS.description)).toBeInTheDocument();
    expect(screen.getByText('~300k')).toBeInTheDocument();
    expect(screen.getByText('players')).toBeInTheDocument();
  });

  it('renders internal and external CTAs', () => {
    render(<Hero {...PROPS} />);
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/blog'
    );
    const external = screen.getByRole('link', { name: 'GitHub' });
    expect(external).toHaveAttribute(
      'href',
      'https://github.com/hieudoanm/soccers'
    );
    expect(external).toHaveAttribute('target', '_blank');
  });

  it('omits the secondary CTA when not provided', () => {
    render(<Hero {...PROPS} secondary={undefined} />);
    expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull();
  });

  it('renders hash CTAs as anchors', () => {
    render(<Hero {...PROPS} primary={{ label: 'Jump', href: '#match' }} />);
    expect(screen.getByRole('link', { name: 'Jump' })).toHaveAttribute(
      'href',
      '#match'
    );
  });
});
