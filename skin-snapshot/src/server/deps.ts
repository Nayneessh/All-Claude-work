// Dependency container. Built once per server instance; tests build their own with fakes.
import { buildProvider, type AiConfig } from '../ai/providers';
import type { VisionProvider } from '../ai/types';
import { postgresDb, pgliteDb, type Db } from '../data/db';
import * as repo from '../data/repo';
import { DEFAULT_RETENTION } from '../core/retention';
import type { AssessedConfidence } from '../core/types';
import { PostgresStore, S3Store, type ObjectStore } from '../storage';
import { DevAuth, SupabaseAuth, UnconfiguredAuth, type AuthProvider } from './auth';
import { OffBotCheck, PowBotCheck, TurnstileBotCheck, type BotCheck } from './botcheck';
import { ConfigError, loadConfig, type Config } from './config';

export interface Settings {
  allowSampleRoutines: boolean;
  gateBMinConfidence: AssessedConfidence;
  retentionUnbookedHours: number;
  retentionClosedDays: number;
  servicePromise: string;
  whatsappNumber: string | null;
  maintenanceMode: boolean;
  aiMockScenario: string | undefined;
}

export interface Deps {
  config: Config;
  db: Db;
  store: ObjectStore;
  ai: VisionProvider;
  auth: AuthProvider;
  botcheck: BotCheck;
  now(): Date;
  settings(): Promise<Settings>;
}

export function makeSettingsReader(config: Config, db: Db, ttlMs = 10_000) {
  let cache: { at: number; value: Settings } | null = null;
  return async (): Promise<Settings> => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.value;
    const raw = await repo.getSettings(db);
    const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
    const value: Settings = {
      allowSampleRoutines: raw.allow_sample_routines === true,
      gateBMinConfidence: (['clear', 'likely', 'not_sure'].includes(str('gate_b_min_confidence') ?? '') ? str('gate_b_min_confidence') : 'not_sure') as AssessedConfidence,
      retentionUnbookedHours: config.retentionUnbookedHours ?? (typeof raw.retention_unbooked_hours === 'number' ? raw.retention_unbooked_hours : DEFAULT_RETENTION.unbookedHours),
      retentionClosedDays: config.retentionClosedDays ?? (typeof raw.retention_closed_days === 'number' ? raw.retention_closed_days : DEFAULT_RETENTION.closedDays),
      servicePromise: str('service_promise') ?? 'first reply within one business day',
      whatsappNumber: str('whatsapp_number') ?? config.whatsappNumber ?? null,
      maintenanceMode: raw.maintenance_mode === true,
      aiMockScenario: config.ai.provider === 'mock' ? str('ai_mock_scenario') : undefined,
    };
    cache = { at: Date.now(), value };
    return value;
  };
}

export async function buildDeps(config: Config, overrides: Partial<Deps> = {}): Promise<Deps> {
  let db = overrides.db;
  if (!db) {
    if (config.databaseUrl) db = postgresDb(config.databaseUrl);
    else if (!config.isProd) db = await pgliteDb(config.env === 'test' ? undefined : config.pgliteDir ?? '.data/pglite');
    else if (config.demoStore) db = await pgliteDb(); // staging without a database: temporary, in memory
    else throw new ConfigError('DATABASE_URL is not set');
  }
  const store = overrides.store ?? (config.s3 ? new S3Store(config.s3) : new PostgresStore(db));
  const botcheck =
    overrides.botcheck ??
    (config.botcheck.kind === 'turnstile' && config.botcheck.turnstileSecret
      ? new TurnstileBotCheck(config.botcheck.turnstileSecret)
      : config.botcheck.kind === 'pow'
        ? new PowBotCheck(config.signingSecret, config.botcheck.difficulty, () => db!)
        : new OffBotCheck());
  // Staff sign-in that is not configured must not stop the public flow: only console calls report it.
  const auth =
    overrides.auth ??
    (config.authProvider === 'dev'
      ? new DevAuth(config.signingSecret)
      : config.supabaseUrl && config.supabaseAnonKey
        ? new SupabaseAuth(config.supabaseUrl, config.supabaseAnonKey)
        : new UnconfiguredAuth());
  return {
    config,
    db,
    store,
    ai: overrides.ai ?? buildProvider(config.ai as AiConfig),
    auth,
    botcheck,
    now: overrides.now ?? (() => new Date()),
    settings: overrides.settings ?? makeSettingsReader(config, db),
  };
}

const g = globalThis as unknown as { __ssDeps?: Promise<Deps> };

/** Lazily builds and caches the shared dependency container. */
export function getDeps(): Promise<Deps> {
  if (!g.__ssDeps) {
    g.__ssDeps = (async () => {
      const config = loadConfig();
      if (config.isProd && !config.signingSecret) throw new ConfigError('SIGNING_SECRET is not set');
      return buildDeps(config);
    })();
    g.__ssDeps.catch(() => {
      g.__ssDeps = undefined;
    });
  }
  return g.__ssDeps;
}
