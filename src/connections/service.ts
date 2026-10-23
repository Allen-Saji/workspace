import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DomainError, idField, keys, object, textField, validateReport } from '../domain/contracts.ts';
import { ingestAuthorized } from '../domain/service.ts';
import { SqliteStorage } from '../storage/sqlite.ts';

export const SCOPES = ['reports:append', 'captures:append', 'receipts:read'] as const;
type Registration = { id: string; owner: string; workspace: string; name: string; challenge: string;
  requested: string[]; granted: string[]; status: 'pending'|'approved'|'rejected'|'active'|'revoked'; expires: number; tokenExpires?: number };
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const secret = () => randomBytes(32).toString('base64url');
function scopes(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 3 || value.some(s => !SCOPES.includes(s)) || new Set(value).size !== value.length) throw new DomainError('scope_denied');
  if (!value.includes('reports:append')) throw new DomainError('scope_denied');
  return [...value].sort() as string[];
}
function proof(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(value)) throw new DomainError('auth_required');
  return hash(value);
}
function equal(a: string, b: string) { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }

/** Isolated in-memory integration harness. No constructor accepts a file path.
 * All grants and reports disappear on process restart; production is not enabled.
 * Owner identity is a trusted server input, never an agent request parameter. */
export class TestConnections {
  private db = new DatabaseSync(':memory:');
  private store = new SqliteStorage(this.db);
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now=now;
    this.db.exec(`CREATE TABLE pairing(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,workspace TEXT NOT NULL,expires INTEGER NOT NULL,request TEXT,digest TEXT,registration TEXT);
      CREATE TABLE connections(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE tokens(hash TEXT PRIMARY KEY,connection TEXT NOT NULL);
      CREATE TABLE limits(bucket TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);`);
  }
  close() { this.store.close(); }
  private limit(bucket: string, max = 30) {
    // Separate committed transaction: failed requests also consume rate budget.
    this.store.transaction(()=>{
      const window=Math.floor(this.now()/60000);
      this.db.prepare('DELETE FROM limits WHERE window < ?').run(window-1);
      this.db.prepare(`INSERT INTO limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET
        count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window`).run(bucket,window);
    });
    const row=this.db.prepare('SELECT count FROM limits WHERE bucket=?').get(bucket)!;
    if(Number(row.count)>max) throw new DomainError('rate_limited');
  }
  private get(id: string): Registration {
    const row=this.db.prepare('SELECT body FROM connections WHERE id=?').get(id);
    if(!row) throw new DomainError('auth_required');
    return JSON.parse(String(row.body));
  }
  private put(r: Registration) { this.db.prepare('INSERT INTO connections VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(r.id,JSON.stringify(r)); }
  private owned(owner: string, workspace: string, id: string) {
    const r=this.get(idField(id));
    if(r.owner!==owner || r.workspace!==workspace) throw new DomainError('scope_denied');
    return r;
  }
  private view(r: Registration) {
    return {id:r.id,displayName:r.name,requestedScopes:r.requested,grantedScopes:r.granted,
      status: (r.status==='active' ? r.tokenExpires! : r.expires)<=this.now() && !['rejected','revoked'].includes(r.status) ? 'expired' : r.status,
      expiresAt:new Date(r.status==='active'?r.tokenExpires!:r.expires).toISOString(),identity:'unverified',isTest:true};
  }
  list(owner: string, workspace: string) {
    return this.db.prepare('SELECT body FROM connections').all().map(row=>JSON.parse(String(row.body)) as Registration)
      .filter(r=>r.owner===owner && r.workspace===workspace).map(r=>this.view(r));
  }
  pair(owner: string, workspace: string) {
    this.limit('owner:'+owner,10);
    const code=secret(), expires=this.now()+600000;
    this.store.transaction(()=>this.db.prepare('INSERT INTO pairing(hash,owner,workspace,expires) VALUES(?,?,?,?)').run(hash(code),owner,workspace,expires));
    return {pairingCode:code,expiresAt:new Date(expires).toISOString(),isTest:true};
  }
  register(input: unknown) {
    this.limit('registration',30);
    const v=object(input); keys(v,['pairingCode','requestId','displayName','requestedScopes','codeChallenge','codeChallengeMethod']);
    const code=textField(v.pairingCode,100), request=idField(v.requestId), name=textField(v.displayName,100), requested=scopes(v.requestedScopes);
    if(v.codeChallengeMethod!=='S256' || typeof v.codeChallenge!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(v.codeChallenge)) throw new DomainError('invalid_schema');
    const challenge=v.codeChallenge;
    const digest=hash(JSON.stringify({request,name,requested,challenge}));
    return this.store.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM pairing WHERE hash=?').get(hash(code));
      if(!row || Number(row.expires)<=this.now()) throw new DomainError('auth_required');
      if(row.registration) {
        if(row.request!==request || row.digest!==digest) throw new DomainError('idempotency_conflict');
        return this.view(this.get(String(row.registration)));
      }
      const r: Registration={id:randomUUID(),owner:String(row.owner),workspace:String(row.workspace),name,challenge,requested,granted:[],status:'pending',expires:Number(row.expires)};
      this.put(r);
      this.db.prepare('UPDATE pairing SET request=?,digest=?,registration=? WHERE hash=?').run(request,digest,r.id,hash(code));
      return this.view(r);
    });
  }
  decide(owner: string, workspace: string, id: string, action: 'approve'|'reject'|'revoke', granted?: unknown) {
    this.limit('owner:'+owner,30);
    return this.store.transaction(()=>{
      const r=this.owned(owner,workspace,id);
      if(action==='revoke') { r.status='revoked'; this.db.prepare('DELETE FROM tokens WHERE connection=?').run(r.id); }
      else {
        if(r.status!=='pending' || r.expires<=this.now()) throw new DomainError('registration_closed');
        if(action==='approve') {
          const chosen=scopes(granted);
          if(chosen.some(s=>!r.requested.includes(s))) throw new DomainError('scope_denied');
          r.granted=chosen; r.status='approved';
        } else if(action==='reject') r.status='rejected'; else throw new DomainError('invalid_schema');
      }
      this.put(r); return this.view(r);
    });
  }
  exchange(input: unknown) {
    this.limit('exchange',30);
    const v=object(input); keys(v,['registrationId','codeVerifier']);
    const id=idField(v.registrationId), challenge=proof(v.codeVerifier);
    return this.store.transaction(()=>{
      const r=this.get(id);
      if(!equal(challenge,r.challenge)) throw new DomainError('auth_required');
      if(r.expires<=this.now()) throw new DomainError('registration_closed');
      if(r.status==='pending') return {status:'pending',nextPollSeconds:5,isTest:true};
      if(r.status!=='approved') throw new DomainError('registration_closed');
      const token=secret(); r.status='active'; r.tokenExpires=this.now()+3600000;
      this.put(r); this.db.prepare('INSERT INTO tokens VALUES(?,?)').run(hash(token),r.id);
      // Raw token is returned once, never persisted. Lost delivery requires revoke/re-pair.
      return {status:'active',connectionId:r.id,accessToken:token,tokenType:'Bearer',grantedScopes:r.granted,expiresAt:new Date(r.tokenExpires).toISOString(),isTest:true};
    });
  }
  private authenticated(token: string, capability: string) {
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError('auth_required');
    const row=this.db.prepare('SELECT connection FROM tokens WHERE hash=?').get(hash(token));
    if(!row) throw new DomainError('auth_required');
    const r=this.get(String(row.connection));
    if(r.status!=='active' || r.tokenExpires!<=this.now()) throw new DomainError('auth_required');
    if(!r.granted.includes(capability)) throw new DomainError('scope_denied');
    return r;
  }
  ingest(token: string, input: unknown) {
    this.limit('events',120);
    return this.store.transaction(()=>{
      const r=this.authenticated(token,'reports:append');
      const report=validateReport(input);
      if(!report.isTest) throw new DomainError('test_only');
      if(report.captures.length && !r.granted.includes('captures:append')) throw new DomainError('scope_denied');
      // Append-only agents may not probe owner entity IDs through error differences.
      if(report.entityRefs.length) throw new DomainError('scope_denied');
      // Namespace capture IDs server-side, preventing cross-connection collisions.
      report.captures=report.captures.map(c=>({...c,captureId:hash(r.id+':'+c.captureId)}));
      return ingestAuthorized(this.store,{workspaceId:r.workspace,connectionId:r.id,capabilities:r.granted},report);
    });
  }
  receipt(token: string, eventId: string) {
    this.limit('receipts',120);
    return this.store.transaction(()=>{
      const r=this.authenticated(token,'receipts:read');
      return this.store.findReport(r.workspace,r.id,idField(eventId))?.receipt??null;
    });
  }
}
