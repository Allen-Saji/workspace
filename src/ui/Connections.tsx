'use client';
import { useEffect, useRef, useState } from 'react';
import type {ConnectionView} from '../connections/hosted';
import {Modal} from './primitives';
import {reportedState,useReportClock} from './report-clock';
export default function Connections(){
  const now=useReportClock();
  const [mode,setMode]=useState('disabled'),[items,setItems]=useState<ConnectionView[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[code,setCode]=useState(''),[expires,setExpires]=useState('');
  const [confirmation,setConfirmation]=useState<{action:string;id?:string;scopes?:string[]}|null>(null);
  const inFlight=useRef(false);const active=mode!=='disabled',test=mode==='ephemeral-test';
  async function read(){const r=await fetch('/api/agent/v1/control',{cache:'no-store'});if(!r.ok)throw new Error('Unable to load connections. Refresh before retrying any change.');setItems((await r.json()).connections);}
  useEffect(()=>{const controller=new AbortController();fetch('/api/agent/v1/capabilities',{cache:'no-store',signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(async v=>{if(controller.signal.aborted)return;setMode(v.enabled===true?v.mode:'disabled');if(v.enabled===true)await read();}).catch(()=>{if(!controller.signal.aborted)setError('Connection setup is unavailable.');});return()=>controller.abort();},[]);
  async function act(action:string,id?:string,scopes?:string[]){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setConfirmation(null);
    try{const r=await fetch('/api/agent/v1/control',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'local-ui'},body:JSON.stringify({action,id,scopes})});const v=await r.json();if(!r.ok)throw new Error(`Request declined: ${v.error?.code??r.status}. Refresh before retrying.`);if(v.pairingCode){setCode(v.pairingCode);setExpires(v.expiresAt);}await read();}
    catch(e){setError(e instanceof TypeError?'Connection lost. Outcome is unknown; refresh requests before retrying.':e instanceof Error?e.message:'Connection request failed.');}finally{inFlight.current=false;setBusy(false);}
  }
  return <section className="panel secondary-panel"><div className="panel-heading"><h2>Connect an agent</h2>{active?<button className="secondary" disabled={busy} onClick={()=>setConfirmation({action:'pair'})}>Create {test?'test ':''}pairing code</button>:null}</div>
    <p>The current assistant uses explicit owner-mediated report imports. That relay is separate from agent credentials.</p>
    {!active?<p className="callout">Hosted connection implementation is awaiting security activation. Credential issuance is disabled. No external agent has access through this setup.</p>:<>
      <p className="callout">{test?'Isolated test environment. Codes, tokens and reports disappear on server restart. No access to your personal workspace.':'Connections can append only the reports and captures you approve. They cannot read your context or edit tasks. Names are self-reported, not verified identities.'}</p>
      {code?<div><label>One-use {test?'test ':''}pairing code<input readOnly value={code} autoComplete="off" spellCheck={false}/></label><p>Expires {new Date(expires).toLocaleString()}. Share only through your chosen agent’s secure setup. Do not paste into chat or logs.</p><button className="text-button" onClick={()=>{setCode('');setExpires('');}}>Hide code</button></div>:null}
      <button className="text-button" disabled={busy} onClick={()=>{setBusy(true);read().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Refresh requests</button>
      {items.length===0?<p>No registrations received. A pairing code alone does not authorize an agent.</p>:items.map(c=><article className="registration" key={c.id}><strong>{c.displayName}</strong><p>Identity unverified · {c.status} · expires {new Date(c.expiresAt).toLocaleString()}</p><p>{reportedState(c.lastReportedAt,now)}</p>{c.lastReportedAt?<p>Reported: {new Date(c.lastReportedAt).toLocaleString()}<br/>Received here: {c.lastReceivedAt?new Date(c.lastReceivedAt).toLocaleString():'Unknown'}</p>:null}<p>{(c.grantedScopes.length?c.grantedScopes:c.requestedScopes).join(', ')}</p>
        {c.status==='pending'?<form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);setConfirmation({action:'approve',id:c.id,scopes:form.getAll('scope') as string[]});}}>
          {c.requestedScopes.map(s=><label key={s}><input type="checkbox" name="scope" value={s} defaultChecked disabled={busy}/>{s}</label>)}
          <p>Reports append is required. Approval cannot grant context reads or task edits.</p><button className="primary" disabled={busy}>Review approval</button><button type="button" className="secondary" disabled={busy} onClick={()=>setConfirmation({action:'reject',id:c.id})}>Reject</button></form>:null}
        {['pending','approved','active','expired'].includes(c.status)?<button className="secondary" disabled={busy} onClick={()=>setConfirmation({action:'revoke',id:c.id})}>Revoke {test?'test ':''}connection</button>:null}
      </article>)}
    </>}{error?<p role="alert" className="error">{error}</p>:null}
    {confirmation?<Modal title={confirmation.action==='pair'?'Create a pairing code':confirmation.action==='approve'?'Approve requested access':confirmation.action==='revoke'?'Revoke connection':'Reject request'} onClose={()=>setConfirmation(null)}><p>{confirmation.action==='pair'?'This code starts one registration and expires in ten minutes. You must separately approve its requested scopes.':confirmation.action==='approve'?`Allow only: ${confirmation.scopes?.join(', ')||'no scopes selected'}. The agent must prove its setup challenge before receiving a one-hour credential.`:confirmation.action==='revoke'?'This immediately blocks new reports and receipt reads. Previously saved reports remain in your history.':'The request will close without issuing a credential.'}</p><button className="secondary" onClick={()=>setConfirmation(null)}>Cancel</button><button className="primary" disabled={busy||(confirmation.action==='approve'&&!confirmation.scopes?.includes('reports:append'))} onClick={()=>void act(confirmation.action,confirmation.id,confirmation.scopes)}>Confirm {confirmation.action}</button></Modal>:null}
  </section>;
}
