import test from 'node:test';
import assert from 'node:assert/strict';
import {brandMetadata} from '../src/server/metadata.ts';
test('metadata does not invent a deployment origin or globally block public indexing',()=>{
 const m=brandMetadata({});assert.equal(m.metadataBase,undefined);assert.equal(m.alternates,undefined);assert.equal(m.robots,undefined);assert.ok(m.twitter && 'card' in m.twitter && m.twitter.card==='summary_large_image');
 assert.equal(String(brandMetadata({WORKSPACE_ORIGIN:'http://127.0.0.1:3218'}).metadataBase),'http://127.0.0.1:3218/');
 assert.equal(String(brandMetadata({WORKSPACE_PUBLIC_ORIGIN:'https://example.test'}).metadataBase),'https://example.test/');
 assert.throws(()=>brandMetadata({WORKSPACE_PUBLIC_ORIGIN:'https://example.test/path'}));
});

