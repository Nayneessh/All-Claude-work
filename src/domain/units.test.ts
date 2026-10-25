import { describe, expect, it } from 'vitest';
import { formatDuration, formatVolume, formatWeight, fromDisplayWeight, kgToLb, lbToKg, parseNumber, toDisplayWeight } from './units';

describe('units', () => {
  it('converts kg↔lb consistently', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(135)).toBeCloseTo(61.235, 3);
    expect(lbToKg(kgToLb(72.5))).toBeCloseTo(72.5, 9);
  });
  it('stores what a lb user typed and shows it back unchanged', () => {
    for (const lb of [45, 95, 135, 185, 225, 315, 102.5]) {
      const kg = fromDisplayWeight(lb, 'lb');
      expect(toDisplayWeight(kg, 'lb')).toBeCloseTo(lb, 1);
    }
  });
  it('formats weights and never shows missing as zero', () => {
    expect(formatWeight(62.5, 'kg')).toBe('62.5 kg');
    expect(formatWeight(60, 'kg')).toBe('60 kg');
    expect(formatWeight(null, 'kg')).toBe('—');
    expect(formatWeight(undefined, 'lb')).toBe('—');
    expect(formatWeight(0, 'kg')).toBe('0 kg'); // an actual zero is a value
    expect(formatVolume(null, 'kg')).toBe('—');
    expect(formatVolume(12500, 'kg')).toBe('12.5k kg');
  });
  it('parses user input, accepting decimal commas and rejecting junk', () => {
    expect(parseNumber('62,5')).toBe(62.5);
    expect(parseNumber(' 80 ')).toBe(80);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
  it('formats durations', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('—');
  });
});
