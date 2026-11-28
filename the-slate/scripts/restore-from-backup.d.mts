/** Builds one self-contained SQL script that restores a THE SLATE backup (see scripts/restore-from-backup.mjs). */
export function buildRestoreSql(raw: Buffer, mapUsers?: [string, string][]): string;
