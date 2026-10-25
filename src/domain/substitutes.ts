import type { Exercise } from './types';
import { MUSCLES, muscleLabel } from './muscles';

type ExLite = Pick<Exercise, 'id' | 'name' | 'primary_muscles' | 'movement_pattern' | 'tracking_method' | 'equipment' | 'substitute_ids' | 'archived_at' | 'category' | 'variation_of'>;

export interface Substitute<T extends ExLite = ExLite> { exercise: T; score: number; reasons: string[] }

/**
 * Ranked substitutes for an exercise. Listed alternatives come first; otherwise the same primary muscle group
 * and movement pattern win, and a different piece of equipment is a plus (an equipment alternative).
 * Suggestions are only suggestions — a substitute is tracked as its own exercise, never as an equivalent load.
 */
export function suggestSubstitutes<T extends ExLite>(target: T, all: T[], limit = 8): Substitute<T>[] {
  const groups = new Set(target.primary_muscles.map((m) => MUSCLES[m]?.group).filter(Boolean));
  const out: Substitute<T>[] = [];
  for (const c of all) {
    if (c.id === target.id || c.archived_at) continue;
    let score = 0;
    const reasons: string[] = [];
    if (target.substitute_ids.includes(c.id)) { score += 100; reasons.push('Listed alternative'); }
    if (c.substitute_ids.includes(target.id)) { score += 20; reasons.push('Lists this exercise as an alternative'); }
    const shared = c.primary_muscles.filter((m) => groups.has(MUSCLES[m]?.group));
    if (shared.length) { score += 40; reasons.push(`Same muscle: ${muscleLabel(shared[0]!)}`); }
    if (!shared.length && !score) continue;
    if (c.movement_pattern && c.movement_pattern === target.movement_pattern) { score += 15; reasons.push('Same movement'); }
    if (c.tracking_method === target.tracking_method) score += 10;
    if (c.equipment !== target.equipment) { score += 5; reasons.push(`Uses ${c.equipment}`); }
    if (c.variation_of === target.id || target.variation_of === c.id) { score += 8; reasons.push('Variation'); }
    if (c.category === target.category) score += 3;
    out.push({ exercise: c, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name)).slice(0, limit);
}
