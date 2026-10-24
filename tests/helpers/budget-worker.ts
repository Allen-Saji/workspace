import {parentPort,workerData} from 'node:worker_threads';
import {TestBudget} from '../../src/server/test-budget.ts';
const ledger=new TestBudget(workerData.path);parentPort!.postMessage('ready');parentPort!.once('message',()=>{try{ledger.reserve(workerData.id,'a'.repeat(64),Date.parse('2026-10-24T00:00:00Z'));parentPort!.postMessage(true);}catch{parentPort!.postMessage(false);}finally{ledger.close();}});
