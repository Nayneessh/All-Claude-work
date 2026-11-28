/** All deployment-specific configuration comes from environment variables (see .env.example). No secrets here: only public values. */
export const ENV = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '',
  timezone: (import.meta.env.VITE_TIMEZONE as string | undefined) || 'Asia/Kolkata',
  appVersion: '1.0.0',
};
export const isConfigured = Boolean(ENV.supabaseUrl && ENV.supabaseKey);
