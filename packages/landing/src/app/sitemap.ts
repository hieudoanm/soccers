import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/blog';
import { getSeries } from '@/lib/series';
import { siteUrl } from '@/lib/site';
import { TOURNAMENT_CONFIG } from '@/data/touraments/tournament';
import { ALL_WORLD_CUPS } from '@/data/touraments/international/world-cup';
import { ALL_EUROS } from '@/data/touraments/international/euro';
import { ALL_COPA } from '@/data/touraments/international/copa';
import { ALL_AFCON } from '@/data/touraments/international/afcon';
import { ALL_AFC } from '@/data/touraments/international/afc';
import { ALL_CONCACAF } from '@/data/touraments/international/concacaf';
import { ALL_ASEAN } from '@/data/touraments/international/asean';
import { ALL_PREMIER_LEAGUE } from '@/data/touraments/club/premier-league';
import { ALL_LA_LIGA } from '@/data/touraments/club/la-liga';
import { ALL_BUNDESLIGA } from '@/data/touraments/club/bundesliga';
import { ALL_CHAMPIONS_LEAGUE } from '@/data/touraments/club/champions-league';

export const dynamic = 'force-static';

const TOURNAMENT_YEARS: Record<string, { year: number | string }[]> = {
  'world-cup': ALL_WORLD_CUPS,
  euro: ALL_EUROS,
  'copa-america': ALL_COPA,
  afcon: ALL_AFCON,
  afc: ALL_AFC,
  concacaf: ALL_CONCACAF,
  asean: ALL_ASEAN,
  'premier-league': ALL_PREMIER_LEAGUE,
  'la-liga': ALL_LA_LIGA,
  bundesliga: ALL_BUNDESLIGA,
  'champions-league': ALL_CHAMPIONS_LEAGUE,
};

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    '',
    '/blog',
    '/blog/series',
    '/blog/search',
    '/fantasy',
    '/touraments',
  ].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.8,
  }));

  const seriesRoutes: MetadataRoute.Sitemap = getSeries().map((series) => ({
    url: `${siteUrl}/blog/series/${series.slug}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const postRoutes: MetadataRoute.Sitemap = getPosts().map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: post.date,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const tournamentRoutes: MetadataRoute.Sitemap = Object.keys(
    TOURNAMENT_CONFIG
  ).flatMap((slug) => [
    {
      url: `${siteUrl}/touraments/${slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    },
    ...(TOURNAMENT_YEARS[slug] ?? []).map((c) => ({
      url: `${siteUrl}/touraments/${slug}/${c.year}`,
      changeFrequency: 'yearly' as const,
      priority: 0.5,
    })),
  ]);

  return [...staticRoutes, ...seriesRoutes, ...postRoutes, ...tournamentRoutes];
}
