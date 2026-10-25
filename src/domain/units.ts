import type { Unit } from './types';

export const KG_PER_LB = 0.45359237;

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

export function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/** Canonical storage is kilograms rounded to grams; display converts and rounds sensibly. */
export function toDisplayWeight(kg: number, unit: Unit): number {
  return unit === 'kg' ? roundTo(kg, 0.01) : roundTo(kgToLb(kg), 0.1);
}

/** Convert what the user typed (in their unit) to canonical kg (3 decimals). */
export function fromDisplayWeight(value: number, unit: Unit): number {
  const kg = unit === 'kg' ? value : lbToKg(value);
  return Math.round(kg * 1000) / 1000;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Missing values render as an em dash — never as 0. */
export function formatWeight(kg: number | null | undefined, unit: Unit, withUnit = true): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return '—';
  const v = trim(toDisplayWeight(kg, unit));
  return withUnit ? `${v} ${unit}` : v;
}

export function formatVolume(kg: number | null | undefined, unit: Unit): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return '—';
  const v = unit === 'kg' ? kg : kgToLb(kg);
  if (Math.abs(v) >= 10000) return `${trim(Math.round(v / 100) / 10)}k ${unit}`;
  return `${Math.round(v).toLocaleString('en-US')} ${unit}`;
}

/** Accepts "62,5" and "62.5". Returns null for empty/invalid input (never 0). */
export function parseNumber(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().replace(',', '.');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const cmToIn = (cm: number): number => cm / 2.54;
export const inToCm = (inch: number): number => inch * 2.54;

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return '—';
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatPace(durationS: number, distanceM: number): string {
  if (distanceM <= 0) return '—';
  const perKm = durationS / (distanceM / 1000);
  return `${formatDuration(perKm)} /km`;
}
