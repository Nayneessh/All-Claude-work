/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build edition. 'friends' ships without the author's own routine; anything else is the owner edition. */
  readonly VITE_EDITION?: 'owner' | 'friends';
}
