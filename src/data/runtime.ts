import { v4 as uuidv4 } from 'uuid';

/**
 * Injectable clock / id source / identity so the data layer is deterministic under test.
 * `userId` is null until the user signs in; rows created before that are claimed at first sign-in.
 */
export interface Runtime {
  now: () => string;
  newId: () => string;
  userId: string | null;
  deviceId: string;
}

export const runtime: Runtime = {
  now: () => new Date().toISOString(),
  newId: () => uuidv4(),
  userId: null,
  deviceId: 'device-unset',
};

export function configureRuntime(partial: Partial<Runtime>): void {
  Object.assign(runtime, partial);
}

export const nowIso = (): string => runtime.now();
export const newId = (): string => runtime.newId();
