'use client';
import { useEffect, useState } from 'react';
type Connection={id:string;displayName:string;requestedScopes:string[];grantedScopes:string[];status:string;expiresAt:string};
export default function Connections(){
  const [enabled,setEnabled]=useState(false),[items,setItems]=useState<Connection[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[code,setCode]=useState('');
  async function read(){const r=await fetch('/api/agent/v1/control',{cache:'no-store'});if(!r.ok)throw new Error('Unable to load connections.');setItems((await r.json()).connections);}
  useEffect(()=>{let canceled=false;fetch('/api/agent/v1/capabilities',{cache:'no-store'}).then(r=>r.json()).then(v=>{if(!canceled)setEnabled(v.enabled===true);}).catch(()=>{if(!canceled)setError('Connection setup is unavailable.');});return()=>{canceled=true;};},[]);
  async function act(action:string,id?:string,scopes?:string[]){
    if(busy)return;setBusy(true);setError('');
    try{const r=await fetch('/api/agent/v1/control',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'local-ui'},body:JSON.stringify({action,id,scopes})});const v=await r.json();if(!r.ok)throw new Error(`Request declined: ${v.error?.code??r.status}`);if(v.pairingCode)setCode(v.pairingCode);await read();}
    catch(e){setError(e instanceof Error?e.message:'Connection request failed.');}finally{setBusy(false);}
  }
  return <section className="panel secondary-panel"><div className="panel-heading"><h2>Connect an agent</h2>{enabled?<button className="secondary" disabled={busy} onClick={()=>void act('pair')}>Create test pairing code</button>:null}</div>
    <p>The current assistant uses explicit owner-mediated report imports. That relay is separate from agent credentials.</p>
    {!enabled?<p className="callout">Credential issuance is disabled. Durable connection storage and rotation are implemented for local testing, but are not activated for this workspace. No external agent is connected through this setup.</p>:<>
      <p className="callout">Isolated test environment. Codes, tokens and test reports exist only until server restart. No access to your personal workspace.</p>
      {code?<div><label>One-use test pairing code<input readOnly value={code} autoComplete="off"/></label><p>Expires in 10 minutes. Do not paste into chat or logs.</p><button className="text-button" onClick={()=>setCode('')}>Hide code</button></div>:null}
      <button className="text-button" disabled={busy} onClick={()=>{setBusy(true);read().catch(()=>setError('Unable to refresh connections.')).finally(()=>setBusy(false));}}>Refresh requests</button>
      {items.length===0?<p>No test registrations received.</p>:items.map(c=><article className="registration" key={c.id}><strong>{c.displayName}</strong><p>Identity unverified · {c.status} · expires {new Date(c.expiresAt).toLocaleString()}</p><p>{(c.grantedScopes.length?c.grantedScopes:c.requestedScopes).join(', ')}</p>
        {c.status==='pending'?<form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void act('approve',c.id,form.getAll('scope') as string[]);}}>
          {c.requestedScopes.map(s=><label key={s}><input type="checkbox" name="scope" value={s} defaultChecked disabled={busy}/>{s}</label>)}
          <p>Reports append is required. Approval cannot grant context reads or task edits.</p><button className="primary" disabled={busy}>Approve test scopes</button><button type="button" className="secondary" disabled={busy} onClick={()=>void act('reject',c.id)}>Reject</button></form>:null}
        {['pending','approved','active'].includes(c.status)?<button className="secondary" disabled={busy} onClick={()=>void act('revoke',c.id)}>Revoke test connection</button>:null}
      </article>)}
    </>}{error?<p role="alert" className="error">{error}</p>:null}</section>;
}
