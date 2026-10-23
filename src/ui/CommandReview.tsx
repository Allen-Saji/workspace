'use client';
import { useEffect,useState } from 'react';
import type { WorkspaceRecord } from '../domain/contracts';
import type { Proposal,CommandReceipt,Operation } from '../domain/commands';
import { deterministicInterpreter } from '../domain/interpreter';
import { Modal } from './primitives';
const key='workspace-local-command-draft-v1';
type Draft={text:string;proposal:Proposal|null;receipt:CommandReceipt|null;attempted:boolean};
function load():Draft{try{const s=sessionStorage.getItem(key);if(s)return JSON.parse(s);}catch{}return {text:'',proposal:null,receipt:null,attempted:false};}
export default function CommandReview({records,onClose,onChanged}:{records:WorkspaceRecord[];onClose:()=>void;onChanged:()=>Promise<void>}){
  const [draft,setDraft]=useState<Draft>(load),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{/* Server receipts remain authoritative if browser storage is unavailable. */}},[draft]);
  function edit(index:number,change:Partial<Operation>){setDraft(d=>({...d,proposal:{...d.proposal!,operations:d.proposal!.operations.map((op,i)=>i===index?{...op,...change}:op)}}));}
  function target(index:number,id:string){const op=draft.proposal!.operations[index],record=records.find(r=>r.id===id);
    if(!record){edit(index,{id:crypto.randomUUID(),expectedRevision:0});return;}
    const names=op.kind==='task'?['title','status','dueDate']:op.kind==='meeting'?['title','start','end']:['title','content'];
    edit(index,{id:record.id,expectedRevision:record.revision,data:Object.fromEntries(names.map(k=>[k,record.data[k]]))});
  }
  async function action(action:'apply'|'undo'|'receipt'){
    if(busy||!draft.proposal)return;setBusy(true);setError('');setDraft(d=>({...d,attempted:true}));
    try{
      const response=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'local-ui'},body:JSON.stringify({action,...(action==='apply'?{proposal:draft.proposal}:{commandId:draft.proposal.commandId})})});
      const result=await response.json();
      if(action==='receipt'&&response.status===404){setDraft(d=>({...d,attempted:false}));setError('No committed receipt found. You can edit or retry this proposal.');return;}
      if(!response.ok){if(response.status<500)setDraft(d=>({...d,attempted:false}));throw new Error(result.error?.code==='revision_conflict'?'A record changed. Refresh and review its latest revision; nothing was changed by this request.':`Request declined: ${result.error?.code??response.status}. Your draft is preserved.`);}
      setDraft(d=>({...d,receipt:result.receipt}));await onChanged();
    }catch(e){setError(e instanceof TypeError?'Connection lost: outcome unknown. Check the receipt before retrying.':e instanceof Error?e.message:'Unable to complete request.');}finally{setBusy(false);}
  }
  const locked=busy||draft.attempted||!!draft.receipt;
  return <Modal title="Plan from text" onClose={()=>{if(!busy)onClose();}}><div className="editor">
    <p className="callout">Limited command formats, not general AI. Type or use your own dictation tool, then review. No microphone or paid provider is connected. Local SQLite only.</p>
    {!draft.proposal?<><label>Your draft<textarea value={draft.text} maxLength={12000} rows={5} onChange={e=>setDraft(d=>({...d,text:e.target.value}))}/></label>
      <p>One action per line:</p><pre style={{whiteSpace:'pre-wrap'}}>task: Buy milk{'\n'}note: Weekend | Visit the library{'\n'}meeting: Practice | 2026-10-25 09:00 | 2026-10-25 09:30</pre>
      <p>Meeting dates use 24-hour time in Asia/Kolkata (IST). Relative dates, ambiguous names and deletion commands are not interpreted.</p>
      <button className="primary" onClick={()=>{try{const proposal=deterministicInterpreter.propose(draft.text);setDraft(d=>({...d,proposal}));setError('');}catch(e){setError((e as Error).message);}}}>Review proposal</button></>:<>
      <p>Nothing is applied until you choose Apply. Updates require selecting an exact existing record. Times below use explicit offsets; the displayed review is in IST.</p>
      {draft.proposal.operations.map((op,i)=><fieldset key={i} disabled={locked} style={{border:'1px solid #ddd',borderRadius:12,padding:16}}><legend>{i+1}. {op.kind}</legend>
        <label>Target {i+1}<select value={op.expectedRevision?op.id:''} onChange={e=>target(i,e.target.value)}><option value="">Create new {op.kind}</option>{records.filter(r=>r.kind===op.kind).map(r=><option key={r.id} value={r.id}>{String(r.data.title)} · revision {r.revision} · {r.id.slice(0,8)}</option>)}</select></label>
        {Object.entries(op.data).map(([name,value])=><label key={name}>{name} {i+1}<input value={String(value??'')} onChange={e=>edit(i,{data:{...op.data,[name]:e.target.value}})}/></label>)}
        {op.kind==='meeting'?<p>{['start','end'].map(k=>{const n=Date.parse(String(op.data[k]));return Number.isFinite(n)?new Date(n).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Invalid time';}).join(' → ')} IST</p>:null}
        <small>{op.expectedRevision?`Update revision ${op.expectedRevision}`:'Create new record'}</small>
      </fieldset>)}
      <p>Command ID: <code>{draft.proposal.commandId}</code></p>
      {!draft.receipt?<div className="form-actions"><button className="secondary" disabled={locked} onClick={()=>{setDraft(d=>({...d,proposal:null}));setError('');}}>Back to draft</button><button className="primary" disabled={busy||draft.attempted} onClick={()=>void action('apply')}>Apply all {draft.proposal.operations.length} actions</button><button className="secondary" disabled={busy} onClick={()=>void action('receipt')}>Check receipt</button></div>:<div role="status" className="callout"><strong>{draft.receipt.undo?'Undone in workspace':'Saved in workspace'}</strong><p>Receipt {draft.receipt.undo?.receiptId??draft.receipt.receiptId}</p><p>{draft.receipt.changes.length} records · {draft.receipt.undo?.committedAt??draft.receipt.committedAt}</p>{!draft.receipt.undo?<button className="secondary" disabled={busy} onClick={()=>void action('undo')}>Undo this command</button>:null}</div>}
    </>}
    {error?<p role="alert" className="error">{error}</p>:null}
    <div className="form-actions"><button className="secondary" disabled={busy} onClick={onClose}>Close · keep draft</button><button className="text-button" disabled={busy||(draft.attempted&&!draft.receipt)} onClick={()=>{sessionStorage.removeItem(key);setDraft({text:'',proposal:null,receipt:null,attempted:false});setError('');}}>Clear draft</button></div>
    <p className="muted">Draft is retained in this browser tab until cleared or the tab closes. Undo is available for seven days and refuses intervening edits. It does not undo external actions; none are performed here.</p>
  </div></Modal>;
}
