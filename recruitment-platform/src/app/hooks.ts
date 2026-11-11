import { useMemo } from 'react';
import { latestAssessments, type LatestRow } from '@/services/analytics';
import type { Ctx } from '@/services/ctx';
import { useRuntime } from './runtime';
import type { World } from './world';

export function useCtx(): Ctx {
  const { ctx } = useRuntime();
  if (!ctx) throw new Error('Not signed in');
  return ctx;
}

export function useWorld(): World & { rows: LatestRow[]; loading: boolean } {
  const { world, loading } = useRuntime();
  const rows = useMemo(
    () => latestAssessments({ assessments: world.assessments, candidates: world.candidates, mandates: world.mandates, decisions: world.decisions }),
    [world.assessments, world.candidates, world.mandates, world.decisions],
  );
  return { ...world, rows, loading };
}

export const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((x) => [x.id, x]));
