'use client';
import { useState } from 'react';
import type { Receipt } from '../domain/contracts';
import { Modal } from './primitives';
export default function ReportImport({onClose,onImport}:{onClose:()=>void;onImport:(payload:unknown)=>Promise<Receipt>}) {
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  return <Modal title="Import an explicit report" onClose={()=>{if(!busy)onClose();}}><form className="editor" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');setReceipt(null);try{setReceipt(await onImport(JSON.parse(text)));}catch(e){setError(e instanceof SyntaxError?'This is not valid JSON. Check the report and try again.':e instanceof Error?e.message:'Import failed.');}finally{setBusy(false);}}}>
    <p>Paste a bounded, authorized checkpoint. Reports are stored as content and cannot run commands or grant permissions.</p><label>Report JSON<textarea className="code-input" value={text} onChange={e=>setText(e.target.value)} required maxLength={65536} autoFocus spellCheck={false}/></label>
    <p className="muted">64 KiB maximum · stable event ID · no credentials or full transcripts</p>
    {error?<p role="alert" className="error">{error}</p>:null}{receipt?<div role="status" className="callout"><strong>{receipt.status==='duplicate'?'Already saved — original receipt returned.':'Saved in this workspace.'}</strong><p>Receipt: {receipt.receiptId}</p><p>Committed: {receipt.committedAt}</p><p>Remote acknowledgement: not verified.</p></div>:null}
    <footer className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button><button className="primary" disabled={busy}>{busy?'Importing…':'Import report'}</button></footer>
  </form></Modal>;
}
