import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCAL_RELAY } from '../src/domain/contracts.ts';
import { ingest, receipt } from '../src/domain/service.ts';
import { SqliteStorage } from '../src/storage/sqlite.ts';
const [action, argument] = process.argv.slice(2);
if (!argument || !['import','receipt'].includes(action)) {
  console.error('Usage: node scripts/report.ts import <report.json> | receipt <eventId>'); process.exit(1);
}
const storage = new SqliteStorage(resolve('.data/workspace.sqlite'));
try {
  if (action === 'import') {
    if (statSync(argument).size > 65536) throw new Error('payload_too_large');
    console.log(JSON.stringify(ingest(storage,LOCAL_RELAY,JSON.parse(readFileSync(argument,'utf8').replace(/^\uFEFF/,''))),null,2));
  } else { console.log(JSON.stringify(receipt(storage,LOCAL_RELAY,argument),null,2)); }
} catch (error) { console.error(error instanceof Error ? error.message : 'import_failed'); process.exitCode = 1; }
finally { storage.close(); }
