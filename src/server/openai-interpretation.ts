// Server-only preparation. No default network transport, credentials or environment lookup.
import {Buffer} from 'node:buffer';
import {object,keys} from '../domain/contracts.ts';
import type {InterpretationProvider} from './interpretation.ts';
export const OPENAI_RESPONSES_URL='https://api.openai.com/v1/responses';
const string={type:'string'};
function variant(kind:string,fields:string[]){return {type:'object',properties:{kind:{type:'string',enum:[kind]},data:{type:'object',properties:Object.fromEntries(fields.map(f=>[f,string])),required:fields,additionalProperties:false}},required:['kind','data'],additionalProperties:false};}
export const commandOutputSchema={type:'object',properties:{clarification:{type:['string','null']},actions:{type:'array',items:{anyOf:[variant('task',['title']),variant('note',['title','content']),variant('meeting',['title','start','end'])]}}},required:['clarification','actions'],additionalProperties:false};
export type OpenAITransport=(url:string,body:Record<string,unknown>,signal:AbortSignal)=>Promise<Response>;
export function openAIProvider(config:{model:string;enabled?:boolean},transport:OpenAITransport):InterpretationProvider{
 if(config.enabled!==true)throw new Error('openai_disabled');
 if(!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(config.model))throw new Error('model_id_required');
 return {async interpret(input,signal){
  const response=await transport(OPENAI_RESPONSES_URL,{model:config.model,service_tier:'default',store:false,stream:false,max_output_tokens:2048,
   instructions:input.instructions+' OpenAI schema envelope: clarification is null with one or more actions, or a clarification string with actions empty.',
   input:[{role:'user',content:[{type:'input_text',text:input.text}]}],
   text:{format:{type:'json_schema',name:'workspace_proposal',strict:true,schema:commandOutputSchema}}},signal);
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===429?'provider_rate_limited':'provider_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new Error('invalid_provider_response');
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){if(signal.aborted)throw new Error('provider_aborted');const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new Error('provider_response_too_large');chunks.push(value);}}finally{await reader.cancel();}
  const result=object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if(result.status!=='completed'||!Array.isArray(result.output))throw new Error('provider_incomplete');
  const texts:string[]=[];
  for(const raw of result.output){const item=object(raw);if(item.type==='reasoning')continue;
   if(item.type!=='message'||item.role!=='assistant'||!Array.isArray(item.content))throw new Error('unexpected_provider_output');
   for(const rawPart of item.content){const part=object(rawPart);if(part.type!=='output_text'||typeof part.text!=='string')throw new Error('provider_refusal_or_invalid');texts.push(part.text);}
  }
  if(texts.length!==1||Buffer.byteLength(texts[0])>32768)throw new Error('invalid_provider_output');
  const envelope=object(JSON.parse(texts[0]));keys(envelope,['clarification','actions']);if(!Array.isArray(envelope.actions))throw new Error('invalid_provider_output');
  if(typeof envelope.clarification==='string'&&envelope.actions.length===0)return JSON.stringify({clarification:envelope.clarification});
  if(envelope.clarification!==null||envelope.actions.length===0)throw new Error('ambiguous_provider_output');
  // The provider-neutral interpreter performs strict action/date/field validation next.
  return JSON.stringify({actions:envelope.actions});
 }};
}
