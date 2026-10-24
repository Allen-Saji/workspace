import test from 'node:test';import assert from 'node:assert/strict';
import {openAIProvider,OPENAI_RESPONSES_URL} from '../src/server/openai-interpretation.ts';
import {interpret} from '../src/server/interpretation.ts';
const input={requestId:'synthetic-openai',text:'SYNTHETIC task draft',mode:'ai',timezone:'Asia/Kolkata'};
const answer=(value:unknown)=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('OpenAI adapter is disabled by default and uses configurable Responses structured output with no tools/store',async()=>{
 let calls=0;assert.throws(()=>openAIProvider({model:'gpt-6-luna'},async()=>{calls++;return answer({});}),/disabled/);assert.equal(calls,0);
 const provider=openAIProvider({model:'gpt-6-luna',enabled:true},async(url,body)=>{calls++;assert.equal(url,OPENAI_RESPONSES_URL);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.max_output_tokens,2048);assert.equal(body.tools,undefined);assert.equal(body.previous_response_id,undefined);assert.ok(JSON.stringify(body.text).includes('additionalProperties'));return answer({clarification:null,actions:[{kind:'task',data:{title:'SYNTHETIC'}}]});});
 const result=await interpret(input,provider);assert.equal(result.source,'ai');assert.ok(result.proposal);assert.equal(calls,1);
});
test('OpenAI mocked transport rejects refusal, truncation, malformed output, rate limits and oversized body without retry',async()=>{
 const responses=[()=>Response.json({status:'incomplete',output:[]}),()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]}),()=>new Response('secret',{status:429}),()=>new Response('x'.repeat(65537)),()=>answer({clarification:null,actions:[{kind:'delete',data:{}}]}),()=>answer({clarification:'ambiguous',actions:[{kind:'task',data:{title:'x'}}]})];
 for(const response of responses){let calls=0;const r=await interpret(input,openAIProvider({model:'synthetic-test-model',enabled:true},async()=>{calls++;return response();}));assert.equal(r.source,'unavailable');assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes('secret'));}
 const clarification=await interpret(input,openAIProvider({model:'synthetic-test-model',enabled:true},async()=>answer({clarification:'Which date?',actions:[]})));assert.equal(clarification.clarification,'Which date?');
});
