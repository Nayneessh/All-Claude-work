import { createHeuristicProvider } from '@/ai/heuristic';
import { createLocalRepo, type LocalRepo } from '@/data/local';
import { DEMO_USERS, ensureBaseData } from '@/data/demo';
import type { AiProvider } from '@/domain/contract';
import type { Ctx } from '@/services/ctx';
import type { UserProfile } from '@/domain/types';

export const NOW = new Date(Date.UTC(2026, 10, 11, 9, 0, 0));
let n = 0;

export async function makeCtx(over: { user?: UserProfile; ai?: AiProvider; repo?: LocalRepo } = {}): Promise<Ctx & { repo: LocalRepo }> {
  const repo = over.repo ?? createLocalRepo(`svc-${++n}-${Math.random()}`);
  await ensureBaseData(repo);
  return { repo, ai: over.ai ?? createHeuristicProvider({ now: () => NOW }), user: over.user ?? DEMO_USERS[0], now: () => NOW };
}
export const asUser = (ctx: Ctx, user: UserProfile): Ctx => ({ ...ctx, user });
