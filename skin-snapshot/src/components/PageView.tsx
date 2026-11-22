'use client';
import { useEffect } from 'react';
import { track } from '../lib/analytics';
import { useLang } from './LangProvider';
import { isMobile } from '../lib/device';

export function PageView() {
  const { lang } = useLang();
  useEffect(() => {
    try {
      if (sessionStorage.getItem('ss_pv')) return;
      sessionStorage.setItem('ss_pv', '1');
    } catch {
      /* count it anyway */
    }
    track('page_view', { lang, device: isMobile() ? 'mobile' : 'desktop' });
  }, [lang]);
  return null;
}
