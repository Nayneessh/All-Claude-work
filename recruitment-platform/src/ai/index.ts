import type { AiProvider } from '@/domain/contract';
import { createClaudeProvider } from './claude';
import { createHeuristicProvider } from './heuristic';

export type AiMode = 'heuristic' | 'claude';
const KEY = 'rip.ai';

export function getAiMode(cloud: boolean): AiMode {
  try { const v = localStorage.getItem(KEY); if (v === 'claude' && cloud) return 'claude'; } catch { /* storage unavailable: default */ }
  return 'heuristic';
}
export function saveAiMode(m: AiMode): void {
  try { localStorage.setItem(KEY, m); } catch { /* storage unavailable: the choice lasts for this session only */ }
}

/** One stable provider object that routes to the engine currently selected, so switching never needs a reload. */
export function createSwitchableProvider(getMode: () => AiMode, getToken: () => Promise<string | undefined>): AiProvider {
  const heuristic = createHeuristicProvider();
  const claude = createClaudeProvider({ getToken });
  const cur = (): AiProvider => (getMode() === 'claude' ? claude : heuristic);
  return {
    get info() { return cur().info; },
    generateRubric: (r) => cur().generateRubric(r),
    extractProfile: (r) => cur().extractProfile(r),
    assessCandidate: (r) => cur().assessCandidate(r),
  };
}
