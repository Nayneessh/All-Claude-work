// Single place where environment variables are read. Everything else receives a Config.
import type { AiConfig } from '../ai/providers';
import type { S3Config } from '../storage';

export type AppEnv = 'development' | 'test' | 'staging' | 'production';

export interface Config {
  env: AppEnv;
  isProd: boolean;
  databaseUrl?: string;
  pgliteDir?: string;
  signingSecret: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  authProvider: 'supabase' | 'dev';
  ai: AiConfig;
  s3?: S3Config;
  botcheck: { kind: 'pow' | 'turnstile' | 'off'; turnstileSecret?: string; difficulty: number };
  cronSecret?: string;
  whatsappNumber?: string;
  retentionUnbookedHours?: number;
  retentionClosedDays?: number;
  /** Multiplies every rate limit. 1 in normal use; raised for load and browser tests. */
  rateLimitScale: number;
  noindex: boolean;
  testBanner: boolean;
}

const num = (v: string | undefined) => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const appEnv = (env.APP_ENV as AppEnv | undefined) ?? (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development');
  const isProd = appEnv === 'production' || appEnv === 'staging';
  const aiProvider = (env.AI_PROVIDER as AiConfig['provider'] | undefined) ?? (isProd ? 'openai-compatible' : 'mock');
  if (isProd && aiProvider === 'mock' && env.ALLOW_MOCK_AI !== '1') {
    throw new Error('AI_PROVIDER=mock is refused in staging/production. Set ALLOW_MOCK_AI=1 only for a deliberate demo.');
  }
  const authProvider = (env.AUTH_PROVIDER as 'supabase' | 'dev' | undefined) ?? (isProd ? 'supabase' : 'dev');
  if (isProd && authProvider === 'dev') throw new Error('AUTH_PROVIDER=dev is refused in staging/production.');
  const s3 =
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { endpoint: env.S3_ENDPOINT, region: env.S3_REGION ?? 'auto', bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
      : undefined;
  return {
    env: appEnv,
    isProd,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || undefined,
    signingSecret: env.SIGNING_SECRET ?? (isProd ? '' : 'dev-only-signing-secret-change-me'),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || undefined,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || undefined,
    authProvider,
    ai: {
      provider: aiProvider,
      model: env.AI_MODEL ?? (aiProvider === 'anthropic' ? 'claude-sonnet-5-5' : aiProvider === 'mock' ? 'mock-v1' : 'anthropic/claude-sonnet-5.5'),
      apiKey: env.AI_API_KEY || undefined,
      baseUrl: env.AI_BASE_URL || undefined,
      auth: (env.AI_AUTH as 'bearer' | 'vercel-oidc' | undefined) ?? (env.AI_API_KEY ? 'bearer' : 'vercel-oidc'),
      timeoutMs: num(env.AI_TIMEOUT_MS) ?? 50_000,
      passes: Math.max(1, Math.min(3, num(env.AI_PASSES) ?? 2)),
    },
    s3,
    botcheck: {
      kind: (env.BOTCHECK as 'pow' | 'turnstile' | 'off' | undefined) ?? (appEnv === 'test' ? 'off' : 'pow'),
      turnstileSecret: env.TURNSTILE_SECRET_KEY || undefined,
      difficulty: num(env.BOTCHECK_DIFFICULTY) ?? 14,
    },
    cronSecret: env.CRON_SECRET || undefined,
    whatsappNumber: env.WHATSAPP_NUMBER || undefined,
    retentionUnbookedHours: num(env.RETENTION_UNBOOKED_HOURS),
    retentionClosedDays: num(env.RETENTION_CLOSED_DAYS),
    rateLimitScale: num(env.RATE_LIMIT_SCALE) ?? 1,
    noindex: env.NOINDEX === '1' || appEnv === 'staging',
    testBanner: env.TEST_BANNER === '1' || appEnv === 'staging',
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
