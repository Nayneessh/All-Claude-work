// Booking form validation and the WhatsApp hand-off message.
// The message carries ONLY the case code and the first name: never photos, health answers or
// the private case link.
import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { Lang } from './types';

export const TIME_WINDOWS = ['morning', 'afternoon', 'evening'] as const;
export const METHODS = ['whatsapp_call', 'whatsapp_video', 'chat'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];
export type Method = (typeof METHODS)[number];

const IST_OFFSET_MIN = 330;

/** Dates offered: tomorrow through seven days ahead, in India Standard Time. */
export function bookableDays(now: Date = new Date()): string[] {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const out: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function normaliseWhatsapp(input: string, defaultCountry?: 'IN'): string | null {
  const p = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!p || !p.isValid()) return null;
  return p.number; // E.164, e.g. +919876543210
}

export const bookingSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u, 'letters only'),
    whatsapp: z.string().trim().min(6).max(24),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    window: z.enum(TIME_WINDOWS),
    method: z.enum(METHODS),
    contactConsent: z.literal(true),
    note: z.string().trim().max(300).optional().default(''),
  })
  .strict();

export type BookingInput = z.infer<typeof bookingSchema>;

export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30);
}

export function buildWhatsappMessage(lang: Lang, firstName: string, caseCode: string): string {
  return lang === 'hi'
    ? `नमस्ते, मैं ${firstName} हूँ। मेरा केस कोड ${caseCode} है।`
    : `Hello, I'm ${firstName}. My case code is ${caseCode}.`;
}

export function whatsappLink(numberE164: string, message: string): string {
  const digits = numberE164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
