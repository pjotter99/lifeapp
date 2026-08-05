import { dirname, resolve } from 'node:path';

/** server/src -> server -> Repo-Wurzel */
export const repoRoot = resolve(dirname(dirname(import.meta.dirname)));

export const dataDir = resolve(repoRoot, 'data');
export const dbFile = resolve(dataDir, 'app.db');
export const migrationsDir = resolve(repoRoot, 'migrations');
