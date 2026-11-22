// Values that static pages need at build/render time. Read directly from the environment, never validated here.
export function siteEnv() {
  const appEnv = process.env.APP_ENV ?? (process.env.VERCEL ? 'staging' : process.env.NODE_ENV === 'production' ? 'production' : 'development');
  return {
    appEnv,
    testBanner: process.env.TEST_BANNER === '1' || appEnv === 'staging',
    noindex: process.env.NOINDEX === '1' || appEnv === 'staging',
    unbookedHours: Number(process.env.RETENTION_UNBOOKED_HOURS ?? (appEnv === 'staging' ? 24 : 72)),
    closedDays: Number(process.env.RETENTION_CLOSED_DAYS ?? 90),
    servicePromise: 'first reply within one business day',
    contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
    contactLocation: process.env.NEXT_PUBLIC_CONTACT_LOCATION || '',
    contactWhatsapp: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || '',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  };
}
