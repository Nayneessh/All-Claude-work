'use client';
import { createContext, useContext } from 'react';
import type { Lang } from '../core/types';
import type { Dict } from '../i18n';

interface Ctx {
  lang: Lang;
  dict: Dict;
  hours: number;
  days: number;
}
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ lang, dict, hours, days, children }: Ctx & { children: React.ReactNode }) {
  return <LangCtx.Provider value={{ lang, dict, hours, days }}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useLang outside LangProvider');
  return c;
}
