'use client';
export type Platform = 'android' | 'ios' | 'desktop';
export type Browserish = 'chrome-android' | 'safari-ios' | 'desktop' | 'other';

export function ua(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

export function platform(): Platform {
  const u = ua();
  if (/android/i.test(u)) return 'android';
  if (/iphone|ipad|ipod/i.test(u) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

export const isMobile = () => platform() !== 'desktop';

/** In-app browsers (Instagram, Facebook, WhatsApp, LINE, Snapchat, WeChat, LinkedIn, X) often block the camera. */
export function inAppBrowser(): string | null {
  const u = ua();
  const m = /(Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|MicroMessenger|LinkedInApp|Twitter|TikTok|musical_ly|WhatsApp|GSA\/)/i.exec(u);
  if (m) return m[1]!;
  // Android WebView (not Chrome proper)
  if (/; wv\)/.test(u) && /Android/.test(u)) return 'WebView';
  return null;
}

export function browserFamily(): Browserish {
  const p = platform();
  if (p === 'android') return 'chrome-android';
  if (p === 'ios') return 'safari-ios';
  return 'desktop';
}

export function hasGetUserMedia(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (typeof isSecureContext === 'undefined' || isSecureContext);
}

/** Android intent that opens the current page in Chrome. iOS cannot be forced into Safari. */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`;
}
