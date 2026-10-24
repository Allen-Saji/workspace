'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {reportingPreferences,statusLabel} from '../journal/contracts';
import type {JournalSnapshot} from '../journal/contracts';
import {useReportClock} from './report-clock';
import {Modal,stamp} from './primitives';
const empty:JournalSnapshot={diaries:[],statuses:[]};
function subscribePreferences(callback:()=>void){window.addEventListener('storage',callback);return()=>window.removeEventListener('storage',callback);}
function storedPreferences(){return localStorage.getItem('workspace-reporting-draft-v1')??'';}
function browserZone(){return Intl.DateTimeFormat().resolvedOptions().timeZone;}
function noSubscription(){return()=>{};}
async function readJournal(){
 const cap=await fetch('/api/agent/v1/capabilities',{cache:'no-store'});if(!cap.ok)throw new Error('Reporting availability could not be checked.');const active=(await cap.json()).journalEnabled===true;
 if(!active)return {active,journal:empty,names:{} as Record<string,string>};
 const [data,connections]=await Promise.all([fetch('/api/agent/v2/journal',{cache:'no-store'}),fetch('/api/agent/v1/control',{cache:'no-store'})]);
 if(!data.ok||!connections.ok)throw new Error('Unable to refresh the diary. Previously displayed entries may be stale.');
 return {active,journal:await data.json() as JournalSnapshot,names:Object.fromEntries((await connections.json()).connections.map((c:{id:string;displayName:string})=>[c.id,c.displayName])) as Record<string,string>};
}
export default function AgentJournal(){
 const now=useReportClock();const [journal,setJournal]=useState(empty),[names,setNames]=useState<Record<string,string>>({}),[active,setActive]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sync,setSync]=useState(false),[notice,setNotice]=useState('');
 const stored=useSyncExternalStore(subscribePreferences,storedPreferences,()=>'');const localZone=useSyncExternalStore(noSubscription,browserZone,()=>'');
 let preferences={timezone:localZone,endOfDay:'18:00',activeCadenceHours:3};try{if(stored){const v=JSON.parse(stored);preferences=reportingPreferences(v.timezone,v.endOfDay,v.activeCadenceHours);}}catch{/* Invalid drafts never configure a host. */}
 const [draft,setDraft]=useState<{zone:string;endOfDay:string;cadence:number}|null>(null),[agent,setAgent]=useState('all');
 const fields=draft??{zone:preferences.timezone,endOfDay:preferences.endOfDay,cadence:preferences.activeCadenceHours};const {zone,endOfDay,cadence}=fields;
 async function load(){setBusy(true);setError('');try{const data=await readJournal();setActive(data.active);setJournal(data.journal);setNames(data.names);}catch(e){setError(e instanceof Error?e.message:'Unable to read diary.');}finally{setBusy(false);}}
 useEffect(()=>{let stopped=false;readJournal().then(data=>{if(!stopped){setActive(data.active);setJournal(data.journal);setNames(data.names);}}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};},[]);
 const syncText=`Use the Workspace integration skill for this approved project. Send a current status report, then create or revise the single diary entry for the relevant local date in ${zone||'the configured IANA timezone'}. Keep original observation times for backfills. Recover receipts before retrying unknown outcomes. Share only approved work summaries, results, blockers, next steps and intentional evidence links; no credentials or internal reasoning. This request does not grant new access.`;
 const title=(id:string)=>names[id]??`Agent ${id.slice(0,8)}`;
 return <section className="panel secondary-panel"><div className="panel-heading"><h2>Agent diary</h2><button className="text-button" disabled={busy} onClick={()=>{setBusy(true);void load();}}>Refresh diary</button></div>
 <p>One entry per agent per local day, revised as work becomes clearer. Status updates stay separate.</p>
 {!active?<p className="callout">Hosted reporting is not activated. No diary or status feed is connected here. The integration skill is ready for review.</p>:null}
 <div className="panel-heading"><a href="/skills/workspace-reporting/SKILL.md" target="_blank" rel="noreferrer">Read the integration skill</a><button className="secondary" onClick={()=>setSync(true)}>Sync now instructions</button></div>
 <details><summary>Reporting preferences draft</summary><form onSubmit={e=>{e.preventDefault();try{const p=reportingPreferences(zone,endOfDay,cadence);localStorage.setItem('workspace-reporting-draft-v1',JSON.stringify(p));setNotice('Draft saved in this browser. Apply it in your agent host to enable scheduling.');}catch{setNotice('Use a valid IANA timezone, local time and cadence between 1 and 24 hours.');}}}>
 <label>IANA timezone<input value={zone} onChange={e=>setDraft({...fields,zone:e.target.value})} placeholder="Asia/Kolkata" required/></label><label>End of day (local time)<input type="time" value={endOfDay} onChange={e=>setDraft({...fields,endOfDay:e.target.value})} required/></label><label>Active-work status interval (hours)<input type="number" min="1" max="24" value={cadence} onChange={e=>setDraft({...fields,cadence:Number(e.target.value)})}/></label><button className="secondary">Save reporting draft</button><p>No job is scheduled here. A host scheduler or lifecycle hook must run the agent. Suggested starting draft: 18:00 local and every 3 hours while actively working.</p><p role="status">{notice}</p></form></details>
 {active?<><label htmlFor="journal-agent">Agent</label><select id="journal-agent" value={agent} onChange={e=>setAgent(e.target.value)}><option value="all">All agents</option>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name} (self-reported)</option>)}</select>
 <h3>Latest reported status</h3>{journal.statuses.filter(s=>agent==='all'||s.connectionId===agent).map(s=><article className="registration" key={s.connectionId}><strong>{title(s.connectionId)}</strong><p>{statusLabel(s,now,cadence)}</p><p>{s.report.summary}</p><small>Observed {stamp(s.report.observedAt)} · Sent {stamp(s.report.sentAt)} · Received {stamp(s.receivedAt)}</small></article>)}{journal.statuses.length===0?<p>No status received. Current activity is unknown; this does not mean offline.</p>:null}
 <h3>Daily entries</h3>{journal.diaries.filter(d=>agent==='all'||d.connectionId===agent).map(d=><article className="registration" key={`${d.connectionId}:${d.localDate}`}><h4>{d.localDate} · {title(d.connectionId)}</h4><p className="muted">{d.timezone} · revision {d.revision} · agent-reported{d.report.isTest?' · synthetic test':''}</p><p>{d.report.summary}</p>{(['results','blockers','nextSteps'] as const).map(field=><div key={field}><strong>{field==='nextSteps'?'Next steps':field==='results'?'Results':'Blockers'}</strong>{d.report[field].length?<ul>{d.report[field].map((item,i)=><li key={i}>{item}</li>)}</ul>:<p>None reported.</p>}</div>)}{d.report.evidence.length?<ul>{d.report.evidence.map((e,i)=><li key={i}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.label}</a> · supplied by agent; not verified</li>)}</ul>:<p>No evidence links supplied.</p>}<small>Observed {stamp(d.report.observedAt)} · Sent {stamp(d.report.sentAt)} · Received {stamp(d.receivedAt)}</small></article>)}{journal.diaries.length===0?<p>No daily entries received. Missed days can be backfilled without inventing work.</p>:null}</>:null}
 {error?<p role="alert" className="error">{error}</p>:null}
 {sync?<Modal title="Ask your agent to sync now" onClose={()=>setSync(false)}><p>Workspace cannot wake or command an arbitrary external agent. Send this instruction through your chosen agent host after its connection is authorized.</p><label>Sync request<textarea rows={7} readOnly value={syncText}/></label><p>Use the host’s secure credential store. Never paste a pairing code or token into this instruction.</p><button className="secondary" onClick={()=>setSync(false)}>Close</button></Modal>:null}
 </section>;
}
