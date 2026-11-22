'use client';
// First-party analytics: step names and timings only. No photos, answers or contact details,
// and no third-party scripts.
import type { Lang, PathId } from '../core/types';

export function sessionId(): string {
  try {
    let id = sessionStorage.getItem('ss_sid');
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('ss_sid', id);
    }
    return id;
  } catch {
    return 'nostorage' + Math.random().toString(36).slice(2, 12);
  }
}

export type EventName = 'page_view' | 'path_selected' | 'assessment_started' | 'camera_started' | 'booking_started' | 'whatsapp_opened' | 'snapshot_viewed' | 'upload_fallback_used' | 'camera_blocked' | 'inapp_browser_detected' | 'retake';

export function track(name: EventName, extra: { path?: PathId; lang?: Lang; ms?: number; reason?: 'denied' | 'no_camera' | 'in_app' | 'load_failed' | 'blur' | 'light' | 'angle' | 'other'; device?: 'mobile' | 'desktop' } = {}): void {
  try {
    const body = JSON.stringify({ name, sessionId: sessionId(), ...extra });
    const blob = new Blob([body], { type: 'application/json' });
    if (!navigator.sendBeacon?.('/api/events', blob)) void fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
  } catch {
    /* never block the UI */
  }
}
