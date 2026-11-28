import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data/api';
import { addDays, type DateStr } from '../../lib/time';
import { useToday } from '../../data/hooks';

export const SLATE_KEYS = [['slate']] as const;
/** Tasks (all), plus completions and per-occurrence overrides for a window that always covers today ± a generous margin. */
export function useSlateData(viewFrom?: DateStr, viewTo?: DateStr) {
  const today = useToday();
  const from = useMemo(() => { const a = addDays(today, -60); return viewFrom && viewFrom < a ? addDays(viewFrom, -7) : a; }, [today, viewFrom]);
  const to = useMemo(() => { const a = addDays(today, 90); return viewTo && viewTo > a ? addDays(viewTo, 7) : a; }, [today, viewTo]);
  const tasks = useQuery({ queryKey: ['slate', 'tasks'], queryFn: api.tasks, staleTime: 10_000 });
  const done = useQuery({ queryKey: ['slate', 'done', from, to], queryFn: () => api.done(from, to), staleTime: 10_000 });
  const ov = useQuery({ queryKey: ['slate', 'ov', from, to], queryFn: () => api.overrides(from, to), staleTime: 10_000 });
  return { today, tasks: tasks.data ?? [], done: done.data ?? [], overrides: ov.data ?? [], loading: tasks.isLoading || done.isLoading || ov.isLoading, error: tasks.error ?? done.error ?? ov.error, doneKey: ['slate', 'done', from, to] as const, ovKey: ['slate', 'ov', from, to] as const, refetch: () => { tasks.refetch(); done.refetch(); ov.refetch(); } };
}
export const DIFF_COLOR: Record<string, { bg: string; bar: string }> = {
  easy: { bg: '#176A47', bar: '#3CC585' }, moderate: { bg: '#1D4E8F', bar: '#6FA8FF' }, focus: { bg: '#8A5A12', bar: '#E8A93A' }, extra_focus: { bg: '#7B1E2E', bar: '#E5604F' },
};
