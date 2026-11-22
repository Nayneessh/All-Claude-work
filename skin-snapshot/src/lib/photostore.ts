'use client';
// In-memory holding area for photos that have not been uploaded. It lives only in this browser tab:
// leaving the page discards it, and nothing reaches the server until the visitor confirms.
import { useSyncExternalStore } from 'react';
import type { PhotoSlot } from '../core/types';

export interface HeldPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  checks: Record<string, string | number | boolean | null>;
}

type Listener = () => void;
const held = new Map<PhotoSlot, HeldPhoto>();
let snapshot: Partial<Record<PhotoSlot, HeldPhoto>> = {};
const listeners = new Set<Listener>();

function emit() {
  snapshot = Object.fromEntries(held);
  listeners.forEach((l) => l());
}

export const photoStore = {
  set(slot: PhotoSlot, p: Omit<HeldPhoto, 'url'>) {
    const prev = held.get(slot);
    if (prev) URL.revokeObjectURL(prev.url);
    held.set(slot, { ...p, url: URL.createObjectURL(p.blob) });
    emit();
  },
  remove(slot: PhotoSlot) {
    const prev = held.get(slot);
    if (prev) URL.revokeObjectURL(prev.url);
    held.delete(slot);
    emit();
  },
  clear() {
    held.forEach((p) => URL.revokeObjectURL(p.url));
    held.clear();
    emit();
  },
  get: (slot: PhotoSlot) => held.get(slot),
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snapshot,
};

const EMPTY: Partial<Record<PhotoSlot, HeldPhoto>> = {};
export function useHeldPhotos(): Partial<Record<PhotoSlot, HeldPhoto>> {
  return useSyncExternalStore(photoStore.subscribe, photoStore.getSnapshot, () => EMPTY);
}
