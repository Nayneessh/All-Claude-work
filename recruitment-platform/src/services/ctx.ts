import type { Repo } from '@/data/repo';
import { newId } from '@/data/repo';
import type { AiProvider } from '@/domain/contract';
import { can, canSeeEntity, type Action } from '@/domain/permissions';
import type { UserProfile } from '@/domain/types';

export interface Ctx {
  repo: Repo;
  ai: AiProvider;
  user: UserProfile;
  now: () => Date;
}

export class PermissionError extends Error {
  constructor(public readonly action: Action, public readonly entityId?: string) {
    super(`You do not have permission to perform this action (${action})${entityId ? ' for this business entity' : ''}.`);
    this.name = 'PermissionError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} "${id}" was not found or is not visible to you.`);
    this.name = 'NotFoundError';
  }
}

export class RuleError extends Error {
  constructor(message: string) { super(message); this.name = 'RuleError'; }
}

export function require(ctx: Ctx, action: Action, entityId?: string): void {
  if (!ctx.user.active || !can(ctx.user.role, action)) throw new PermissionError(action);
  if (entityId && !canSeeEntity(ctx.user, entityId)) throw new PermissionError(action, entityId);
}

export interface AuditInput {
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Append one immutable audit record (plan §6.6, §11.5). Failure to audit fails the operation: no silent changes. */
export async function audit(ctx: Ctx, a: AuditInput): Promise<void> {
  await ctx.repo.put('audit_logs', {
    id: newId(), at: ctx.now().toISOString(), userId: ctx.user.id, userName: ctx.user.name, ...a,
  });
}

export async function nextCode(ctx: Ctx, table: 'mandates' | 'candidates', prefix: string, width: number): Promise<string> {
  const n = (await ctx.repo.list(table)).length + 1;
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
