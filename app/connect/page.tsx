'use client';
import {useState} from 'react';
import Link from 'next/link';
type RequestView={displayName:string;requestedScopes:string[];status:string;expiresAt:string};
export default function DeviceApproval(){
 const [view,setView]=useState<RequestView|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[scopes,setScopes]=useState<string[]>([]);
 async function act(action:string){
  if(busy)return;setBusy(true);setMessage('');
  try{
   const id=location.hash.slice(1);if(!/^[a-f0-9-]{36}$/.test(id))throw Error('This approval link is incomplete.');
   const r=await fetch('/api/agent/device/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'local-ui'},signal:AbortSignal.timeout(15000),body:JSON.stringify({id,...(action==='approve'?{scopes}:{})})});
   const data=await r.json();
   if(!r.ok)throw Error(data.error==='setup_pending'?'Device onboarding is implemented but not activated. No access was granted.':'Unable to complete this request. Sign in, check expiry, then refresh its status before retrying.');
   if(action==='inspect'){setView(data);setScopes(data.requestedScopes);}
   else{setView(null);setMessage(action==='approve'?'Approved. The agent must prove its request to receive access. Manage revocation on Agents.':'Request denied. No credential issued.');}
  }catch(e){setMessage(e instanceof Error?e.message:'Request unavailable.');}finally{setBusy(false);}
 }
 return <main className="panel" style={{maxWidth:680,margin:'40px auto',padding:24}}>
  <h1>Connect your agent</h1><p>This link does not grant access. Sign in to Workspace, then review only a request you initiated. Never approve an unexpected link.</p>
  <Link href="/login">Sign in</Link> · <Link href="/#agents">Back to Agents</Link>
  <p><button className="secondary" disabled={busy} onClick={()=>void act('inspect')}>Review request</button></p>
  {view&&<section><h2>{view.displayName}</h2><p>Self-reported identity — not verified. Status: {view.status}. Expires {new Date(view.expiresAt).toLocaleString()}.</p><p>Approval connects this agent to your own private workspace. It cannot read context or edit tasks.</p>
  {view.requestedScopes.map(s=><label key={s} style={{display:'block'}}><input type="checkbox" checked={scopes.includes(s)} disabled={busy||s==='reports:append'} onChange={e=>setScopes(v=>e.target.checked?[...v,s]:v.filter(x=>x!==s))}/>{s}</label>)}
  <button className="secondary" disabled={busy||view.status!=='pending'} onClick={()=>void act('approve')}>Approve selected access</button>
  <button className="secondary" disabled={busy||view.status!=='pending'} onClick={()=>void act('deny')}>Deny request</button>
  <button className="secondary" disabled={busy} onClick={()=>{setView(null);setMessage('Cancelled review. No decision was sent.');}}>Cancel</button></section>}
  {message&&<p role="status">{message}</p>}
 </main>;
}


