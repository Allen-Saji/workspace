import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
import {validateJournal} from '../src/journal/contracts.ts';
import {handleJournal} from '../src/journal/http.ts';
const root=new URL('../public/skills/workspace-reporting/',import.meta.url);
test('distributable skill frontmatter/references and contract examples are usable',()=>{
 const skill=readFileSync(new URL('SKILL.md',root),'utf8').replace(/^\uFEFF/,'');assert.ok(skill.startsWith('---\n')||skill.startsWith('---\r\n'));
 const frontmatter=skill.split(/\r?\n---\r?\n/)[0];assert.match(frontmatter,/name: workspace-reporting/);assert.match(frontmatter,/description: .{30,}/);
 for(const match of skill.matchAll(/\]\((references\/[^)]+)\)/g))assert.ok(existsSync(new URL(match[1],root)));
 const contract=readFileSync(new URL('references/contract.md',root),'utf8');const examples=[...contract.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m=>JSON.parse(m[1]));assert.equal(examples.length,2);
 for(const example of examples)assert.equal(validateJournal(example,Date.parse('2026-10-25T00:00:00Z')).isTest,true);
});
test('v2 remains disabled and rejects spoofed hosts without touching storage',async()=>{
 const response=await handleJournal(new Request('http://127.0.0.1:3210/api/agent/v2/journal',{headers:{host:'127.0.0.1:3210'}}),'journal');assert.equal(response.status,503);
 const spoof=await handleJournal(new Request('http://127.0.0.1:3210/api/agent/v2/journal',{headers:{host:'evil.example'}}),'journal');assert.equal(spoof.status,403);
});
