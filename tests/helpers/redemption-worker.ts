import { parentPort, workerData } from 'node:worker_threads';
import { SqliteConnections } from '../../src/connections/service.ts';
const db=new SqliteConnections(workerData.path);
parentPort!.postMessage({ready:true});
parentPort!.once('message',()=>{
  try { parentPort!.postMessage({ok:true,id:db.register(workerData.request).id}); }
  catch(e) { parentPort!.postMessage({ok:false,code:(e as Error).message}); }
  finally { db.close(); }
});
