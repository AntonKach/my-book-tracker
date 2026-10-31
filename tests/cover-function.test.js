import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoverHandler} from '../supabase/functions/recognize-cover/index.js';

const origin='https://antonkach.github.io', image='data:image/jpeg;base64,/9j/2Q==';
const settings={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test',BOOKTRACKER_OWNER_ID:'owner',GEMINI_API_KEY:'private-test-key'};
function setup({user={id:'owner'},authStatus=200,providerStatus=200,providerValue={title:'Title',author:'Author',category:'Άλλο',summary:'Invented'},omit=[],fail=false}={}) {
 const calls=[];
 const handler=createCoverHandler({env:name=>omit.includes(name)?undefined:settings[name],fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/auth/v1/user'))return Response.json(user,{status:authStatus});
  if(fail)throw new DOMException('secret upstream details','TimeoutError');
  return Response.json(providerStatus===200?{candidates:[{content:{parts:[{text:JSON.stringify(providerValue)}]}}]}:{error:{message:settings.GEMINI_API_KEY}},{status:providerStatus});
 }});
 return {handler,calls};
}
function request({token='user-token',body={image},method='POST',requestOrigin=origin,contentType='application/json'}={}) {
 return new Request('https://example.supabase.co/functions/v1/recognize-cover',{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(requestOrigin?{Origin:requestOrigin}:{}),'Content-Type':contentType},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
test('owner gets only reviewed bibliographic fields and Gemini key stays server-side',async()=>{
 const {handler,calls}=setup({providerValue:{title:'Title',author:'Author',category:'unknown',summary:'Invented',owner_id:'attacker',secret:'bad'}});
 const result=await handler(request());assert.equal(result.status,200);
 const book=await result.json();assert.equal(book.title,'Title');assert.equal(book.category,'Άλλο');assert.equal(book.summary,'');assert.equal(book.owner_id,undefined);assert.equal(book.secret,undefined);
 assert.equal(calls.length,2);assert.equal(calls[0].options.headers.Authorization,'Bearer user-token');
 assert.equal(calls[1].options.headers['x-goog-api-key'],settings.GEMINI_API_KEY);
 assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(result.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal(JSON.stringify(book).includes(settings.GEMINI_API_KEY),false);
});
test('missing, invalid, service-key and different-user credentials never call Gemini',async()=>{
 for(const options of [{token:''},{authStatus:401,user:{}},{user:{}},{user:{id:'other'}},{user:{id:'owner',is_anonymous:true}}]){
  const {handler,calls}=setup(options);const result=await handler(request(options));
  assert.ok([401,403].includes(result.status));assert.ok(calls.every(c=>c.url.endsWith('/auth/v1/user')));
 }
});
test('origin, method and preflight checks run before provider access',async()=>{
 const {handler,calls}=setup();
 assert.equal((await handler(request({requestOrigin:'https://evil.example'}))).status,403);
 assert.equal((await handler(request({method:'GET'}))).status,405);
 const options=await handler(request({method:'OPTIONS',token:''}));assert.equal(options.status,204);
 assert.match(options.headers.get('Access-Control-Allow-Headers'),/authorization/);assert.equal(calls.length,0);
});
test('malformed, non-JPEG and oversized bodies never reach Gemini',async()=>{
 for(const input of [{body:'{'},{body:{image:'data:text/html;base64,abcd'}},{body:{image:'data:image/jpeg;base64,!!!!'}},{body:{image:'data:image/jpeg;base64,YWJjZA=='}},{body:{image:'x'.repeat(2_000_001)}},{contentType:'text/plain'}]){
  const {handler,calls}=setup();const result=await handler(request(input));
  assert.ok([400,413,415].includes(result.status));assert.ok(calls.every(c=>c.url.endsWith('/auth/v1/user')));
 }
});
test('missing server configuration fails closed',async()=>{
 for(const name of Object.keys(settings)){
  const {handler,calls}=setup({omit:[name]});assert.equal((await handler(request())).status,503);assert.equal(calls.length,0);
 }
});
test('provider rate limits, authorization failures and timeout use safe errors',async()=>{
 for(const options of [{providerStatus:429},{providerStatus:403},{fail:true}]){
  const {handler}=setup(options),result=await handler(request());assert.ok([429,503,504].includes(result.status));
  const text=await result.text();assert.equal(text.includes(settings.GEMINI_API_KEY),false);assert.equal(text.includes('secret upstream'),false);
 }
});
test('missing title is not a successful recognition',async()=>{
 const {handler}=setup({providerValue:{author:'Author'}});assert.equal((await handler(request())).status,422);
});
