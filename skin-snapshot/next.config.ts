import type { NextConfig } from 'next';

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const isDev = process.env.NODE_ENV !== 'production';
const turnstile = process.env.BOTCHECK === 'turnstile' ? ' https://challenges.cloudflare.com' : '';

// Content-Security-Policy. 'unsafe-inline' is needed for Next's inline bootstrap scripts; 'wasm-unsafe-eval'
// for the on-device face model. Nothing loads from third-party origins except the staff sign-in service.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}${turnstile}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${supabase ? ' ' + supabase : ''}${isDev ? ' ws:' : ''}${turnstile}`,
  "worker-src 'self' blob:",
  `frame-src ${turnstile ? turnstile.trim() : "'none'"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const noindexPaths = ['/:lang(en|hi)/case/:path*', '/:lang(en|hi)/continue/:path*', '/console/:path*', '/:lang(en|hi)/test/:path*'];

const config: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['sharp', '@electric-sql/pglite', 'postgres'],
  // The temporary in-memory database (staging without DATABASE_URL) reads the migration files and PGlite's
  // WebAssembly bundle at runtime; make sure the hosted build ships them with the API function.
  outputFileTracingIncludes: {
    '/api/**': ['./supabase/migrations/**/*', './node_modules/@electric-sql/pglite/dist/**/*'],
  },
  async headers() {
    const common = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    ];
    return [
      { source: '/:path*', headers: common },
      ...noindexPaths.map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'Cache-Control', value: 'no-store' }] })),
      ...(process.env.NOINDEX === '1' || (process.env.APP_ENV ?? (process.env.VERCEL ? 'staging' : '')) === 'staging' ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] : []),
      { source: '/vision/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default config;
