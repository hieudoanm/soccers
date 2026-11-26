import { render, screen } from '@testing-library/react';
import SeriesDetailPage, {
  generateMetadata,
  generateStaticParams,
} from '../page';

const renderSeries = async (slug: string) =>
  render(await SeriesDetailPage({ params: Promise.resolve({ slug }) }));

describe('SeriesDetailPage', () => {
  it('generates static params for every series', () => {
    const slugs = generateStaticParams().map((p) => p.slug);
    expect(slugs).toContain('match-analysis');
    expect(slugs).toContain('record-books');
  });

  it('renders the series title, description and numbered posts', async () => {
    await renderSeries('match-analysis');
    expect(
      screen.getByRole('heading', { name: 'Match Analysis' })
    ).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /Read post/ }).length
    ).toBeGreaterThan(0);
  });

  it('returns empty metadata for a missing series', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: 'missing' }) })
    ).resolves.toEqual({});
  });
});
