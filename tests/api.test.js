import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveISBN} from '../js/api.js';
test('ISBN lookup uses canonical metadata without AI and retries Open Library before any scraping',async()=>{
 const original=globalThis.fetch;const urls=[];
 globalThis.fetch=async u=>{urls.push(String(u));return urls.length===1?new Response('{"items":[]}'):new Response(JSON.stringify({'ISBN:9780306406157':{title:'Canonical',authors:[{name:'Author'}],number_of_pages:123,publishers:[{name:'Press'}],publish_date:'2000',cover:{medium:'https://example.org/cover.jpg'}}}));};
 try{const b=await resolveISBN('0-306-40615-2');assert.equal(b.title,'Canonical');assert.equal(b.pageCount,123);assert.equal(b.isbn,'9780306406157');assert.match(urls[1],/openlibrary.org/);assert.equal(b.sources[0].name,'Open Library');}finally{globalThis.fetch=original;}
});
