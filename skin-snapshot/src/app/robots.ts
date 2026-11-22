import type { MetadataRoute } from 'next';
import { siteEnv } from '../lib/siteenv';

export default function robots(): MetadataRoute.Robots {
  const e = siteEnv();
  if (e.noindex) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/console/', '/en/case/', '/hi/case/', '/en/continue/', '/hi/continue/'] } };
}
