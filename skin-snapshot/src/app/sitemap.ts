import type { MetadataRoute } from 'next';
import { siteEnv } from '../lib/siteenv';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  if (siteEnv().noindex || !base) return [];
  const pages = ['', '/healthy-skin', '/acne-pigmentation', '/scars-marks', '/how-it-works', '/about', '/faq', '/contact', '/privacy', '/consent', '/terms', '/disclaimer'];
  return ['en', 'hi'].flatMap((l) => pages.map((p) => ({ url: `${base}/${l}${p}`, changeFrequency: 'monthly' as const })));
}
