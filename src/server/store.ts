import { resolve } from 'node:path';
import { SqliteStorage } from '../storage/sqlite.ts';
// Separate processes (UI and relay) safely share SQLite WAL transactions.
export function openStore() { return new SqliteStorage(resolve('.data/workspace.sqlite')); }
