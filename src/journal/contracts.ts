import {DomainError,idField,keys,object,oneOf,textField} from '../domain/contracts.ts';
export type Evidence={label:string;url:string};
type Common={schemaVersion:'2';eventId:string;observedAt:string;sentAt:string;isTest:boolean;summary:string;evidence:Evidence[]};
export type Diary=Common&{kind:'diary';localDate:string;timezone:string;expectedRevision:number;results:string[];blockers:string[];nextSteps:string[]};
export type Status=Common&{kind:'status';state:'working'|'completed'|'blocked'|'offline'};
export type JournalInput=Diary|Status;
export type JournalReceipt={eventId:string;receiptId:string;payloadDigest:string;receivedAt:string;connectionId:string;kind:'diary'|'status';localDate?:string;revision?:number;status:'saved'|'duplicate'};
export type DiaryEntry={connectionId:string;localDate:string;timezone:string;revision:number;receivedAt:string;report:Diary};
export type StatusEntry={connectionId:string;receivedAt:string;report:Status};
export type JournalSnapshot={diaries:DiaryEntry[];statuses:StatusEntry[]};
export function timezone(value:unknown){const name=textField(value,100);try{new Intl.DateTimeFormat('en-US',{timeZone:name}).format(0);}catch{throw new DomainError('invalid_timezone');}if(name!=='UTC'&&!name.includes('/'))throw new DomainError('invalid_timezone');return name;}
export function localDateAt(instant:string|number,zone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone(zone),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));const pick=(type:string)=>parts.find(p=>p.type===type)!.value;return `${pick('year')}-${pick('month')}-${pick('day')}`;}
function timestamp(value:unknown,now:number){const text=textField(value,30);const date=new Date(text);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(text)||!Number.isFinite(date.getTime())||date.toISOString()!==text.replace(/Z$/,text.includes('.')?'Z':'.000Z')||date.getTime()>now+300000)throw new DomainError('invalid_timestamp');return date.toISOString();}
function list(value:unknown){if(!Array.isArray(value)||value.length>20)throw new DomainError('invalid_schema');return value.map(x=>textField(x,1000));}
export function validateJournal(input:unknown,now=Date.now()):JournalInput{
 if(new TextEncoder().encode(JSON.stringify(input)??'').length>32768)throw new DomainError('payload_too_large');
 const v=object(input);const kind=oneOf(v.kind,['diary','status'] as const);
 keys(v,['schemaVersion','kind','eventId','observedAt','sentAt','isTest','summary','evidence',...(kind==='diary'?['localDate','timezone','expectedRevision','results','blockers','nextSteps']:['state'])]);
 const observedAt=timestamp(v.observedAt,now),sentAt=timestamp(v.sentAt,now);if(Date.parse(observedAt)>Date.parse(sentAt))throw new DomainError('invalid_timestamp');
 if(typeof v.isTest!=='boolean'||!Array.isArray(v.evidence)||v.evidence.length>10)throw new DomainError('invalid_schema');
 const evidence=v.evidence.map(item=>{const e=object(item);keys(e,['label','url']);const url=textField(e.url,1000);let parsed:URL;try{parsed=new URL(url);}catch{throw new DomainError('invalid_evidence');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^?#\s]*)?$/.test(url))throw new DomainError('invalid_evidence');return {label:textField(e.label,200),url};});
 const common:Common={schemaVersion:oneOf(v.schemaVersion,['2'] as const),eventId:idField(v.eventId),observedAt,sentAt,isTest:v.isTest,summary:textField(v.summary,2000),evidence};
 if(kind==='status')return {...common,kind,state:oneOf(v.state,['working','completed','blocked','offline'] as const)};
 const zone=timezone(v.timezone),date=textField(v.localDate,10);if(date!==localDateAt(observedAt,zone)||date>localDateAt(now,zone))throw new DomainError('invalid_local_date');
 if(!Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<0||Number(v.expectedRevision)>=Number.MAX_SAFE_INTEGER)throw new DomainError('invalid_revision');
 return {...common,kind,localDate:date,timezone:zone,expectedRevision:Number(v.expectedRevision),results:list(v.results),blockers:list(v.blockers),nextSteps:list(v.nextSteps)};
}
export function statusLabel(status:StatusEntry|undefined,now:number,activeCadenceHours=3){
 if(!status)return 'Unknown — no status received';
 if(now-Date.parse(status.report.observedAt)>(activeCadenceHours+1)*3600000)return 'Stale — current activity unknown';
 return `Agent-reported ${status.report.state} — not independently verified`;
}
export function reportingPreferences(zone:unknown,endOfDay:unknown,cadence:unknown){
 const tz=timezone(zone);if(typeof endOfDay!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endOfDay)||typeof cadence!=='number'||cadence<1||cadence>24)throw new DomainError('invalid_preferences');
 return {timezone:tz,endOfDay,activeCadenceHours:cadence};
}
