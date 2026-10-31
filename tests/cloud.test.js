import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudClient } from '../js/cloud.js';

const URL = 'https://example.supabase.co';
const KEY = 'sb_publishable_test';
const book = { id: '11111111-1111-4111-8111-111111111111', title: 'Ο Κόσμος', author: 'Α', updatedAt: '2026-10-31T10:00:00.000Z', revision: 0 };
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function response(data, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: key => headers[key.toLowerCase()] ?? null }, json: async () => data };
}
function client(fetchImpl, store = storage()) { return new CloudClient({ url: URL, key: KEY, storage: store, fetchImpl }); }
const auth = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: '22222222-2222-4222-8222-222222222222' } };

test('rejects unsafe endpoint and secret keys', () => {
  assert.throws(() => new CloudClient({ url: 'http://example.supabase.co', key: KEY }), /Supabase/);
  assert.throws(() => new CloudClient({ url: URL, key: 'sb_secret_abc' }), /secret|service/i);
  assert.throws(() => new CloudClient({ url: 'https://evil.example', key: KEY }), /Supabase/);
});

test('sign in stores private session and sign out clears it', async () => {
  const seen = [];
  const store = storage();
  const cloud = client(async (url, options) => { seen.push({ url, options }); return url.includes('/logout') ? response({}) : response(auth); }, store);
  await cloud.signIn('me@example.com', 'password');
  assert.equal(cloud.session.user.id, auth.user.id);
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(JSON.parse(seen[0].options.body).email, 'me@example.com');
  assert.ok(store.getItem('booktracker.supabase.session:example.supabase.co'));
  await cloud.signOut();
  assert.equal(cloud.session, null);
  assert.equal(store.getItem('booktracker.supabase.session:example.supabase.co'), null);
});

test('project sessions stay separate and credential-bearing URLs are rejected', async () => {
  assert.throws(() => new CloudClient({ url: 'https://user:pass@example.supabase.co', key: KEY }), /Supabase/);
  const store = storage();
  const first = client(async () => response(auth), store);
  await first.signIn('a@b.co', 'secret');
  const second = new CloudClient({ url: 'https://other.supabase.co', key: KEY, storage: store, fetchImpl: async () => response(auth) });
  assert.equal(await second.restoreSession(), null);
  assert.equal((await first.restoreSession()).user.id, auth.user.id);
});

test('concurrent expired requests share refresh and temporary failure retains session', async () => {
  const store = storage();
  let refreshes = 0;
  let failRefresh = true;
  const cloud = client(async (url, options) => {
    assert.ok(options.signal);
    if (url.includes('grant_type=password')) return response({ ...auth, expires_in: 1 });
    if (url.includes('grant_type=refresh_token')) {
      refreshes++;
      if (failRefresh) throw new TypeError('network offline');
      await new Promise(resolve => setTimeout(resolve, 10));
      return response(auth);
    }
    return response({ items: [], total: 0 });
  }, store);
  await cloud.signIn('a@b.co', 'secret');
  await assert.rejects(cloud.search(), /network offline/);
  assert.ok(await cloud.restoreSession().catch(() => cloud.session));
  assert.ok(store.getItem('booktracker.supabase.session:example.supabase.co'));
  failRefresh = false;
  await Promise.all([cloud.search(), cloud.search()]);
  assert.equal(refreshes, 3); // one failure, one restore retry, one shared concurrent refresh
});

test('search uses server pagination and returns total from RPC', async () => {
  let body;
  const cloud = client(async (url, options) => {
    if (url.includes('/token?')) return response(auth);
    body = JSON.parse(options.body);
    return response({ items: [{ ...book, revision: 2 }], total: 271 });
  });
  await cloud.signIn('me@example.com', 'password');
  const page = await cloud.search({ query: 'κοσμος', offset: 48, limit: 24 });
  assert.equal(body.p_offset, 48);
  assert.equal(body.p_limit, 24);
  assert.equal(page.total, 271);
  assert.equal(page.items.length, 1);
});

test('save requires confirmed revision and does not trust owner in payload', async () => {
  let body;
  const cloud = client(async (url, options) => {
    if (url.includes('/token?')) return response(auth);
    body = JSON.parse(options.body);
    return response({ ok: true, book: { ...book, revision: 1 } });
  });
  await cloud.signIn('me@example.com', 'password');
  const saved = await cloud.save({ ...book, owner_id: 'attacker' }, 0);
  assert.equal(saved.revision, 1);
  assert.equal(body.p_book.owner_id, undefined);
  assert.equal(body.p_expected_revision, 0);
});

test('save rejects missing acknowledgment and exposes remote conflict', async () => {
  let result = { ok: true };
  const cloud = client(async url => url.includes('/token?') ? response(auth) : response(result));
  await cloud.signIn('me@example.com', 'password');
  await assert.rejects(cloud.save(book), /confirmation|επιβεβαίωση/i);
  result = { ok: false, code: 'CONFLICT', remote: { ...book, revision: 3 } };
  await assert.rejects(cloud.save(book), error => error.code === 'CONFLICT' && error.remote.revision === 3);
});

test('all pages through archived and active books without a collection cap', async () => {
  const counts = [];
  const cloud = client(async (url, options) => {
    if (url.includes('/token?')) return response(auth);
    const input = JSON.parse(options.body);
    counts.push(input.p_offset);
    return response(input.p_offset === 0 ? { items: [book], total: 2 } : { items: [{ ...book, id: '33333333-3333-4333-8333-333333333333', archived: true }], total: 2 });
  });
  await cloud.signIn('me@example.com', 'password');
  const found = [];
  for await (const row of cloud.all()) found.push(row);
  assert.equal(found.length, 2);
  assert.deepEqual(counts, [0, 1]);
});

test('goals load and save return confirmed private preferences', async () => {
  const goals = { '2026': { books: 24, pages: 5000 } };
  const seen = [];
  const cloud = client(async (url, options) => {
    if (url.includes('/token?')) return response(auth);
    seen.push({ url, options });
    return url.endsWith('library_get_goals') ? response(goals) : response({ ok: true, goals });
  });
  await cloud.signIn('me@example.com', 'password');
  assert.deepEqual(await cloud.getGoals(), goals);
  assert.deepEqual(await cloud.saveGoals(goals), goals);
  assert.equal(JSON.parse(seen[1].options.body).p_goals['2026'].books, 24);
});

test('native browser fetch receives the global receiver',async()=>{
 const cloud=client(async function(url){assert.equal(this,globalThis);return response(auth);});
 await cloud.signIn('test@example.com','password');
});

test('cover recognition refreshes the saved login and sends no browser Gemini credential',async()=>{
 const seen=[],store=storage();
 const fetchImpl=async(url,options)=>{seen.push({url,options});
  if(url.includes('grant_type=password'))return response({...auth,expires_in:1});
  if(url.includes('grant_type=refresh_token'))return response({...auth,access_token:'fresh-token'});
  return response({title:'Cover title',author:'Author',summary:''});
 };
 const first=client(fetchImpl,store);await first.signIn('a@b.co','password');
 const restarted=client(fetchImpl,store);await restarted.restoreSession();
 const result=await restarted.recognizeCover('data:image/jpeg;base64,/9j/2Q==');
 assert.equal(result.title,'Cover title');const last=seen.at(-1);
 assert.equal(last.url,URL+'/functions/v1/recognize-cover');assert.equal(last.options.headers.Authorization,'Bearer fresh-token');
 assert.deepEqual(JSON.parse(last.options.body),{image:'data:image/jpeg;base64,/9j/2Q=='});
 assert.equal(seen.some(c=>c.url.includes('googleapis.com')),false);
});
test('cover recognition rejects a signed-out client and propagates a safe endpoint error',async()=>{
 const cloud=client(async url=>url.includes('/token?')?response(auth):response({message:'Χρειάζεται σύνδεση.'},401));
 await assert.rejects(cloud.recognizeCover('image'),/sign-in/);
 await cloud.signIn('a@b.co','password');await assert.rejects(cloud.recognizeCover('image'),/Χρειάζεται σύνδεση/);
});
