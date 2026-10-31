import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const bookId = '33333333-3333-4333-8333-333333333333';
async function database() {
  const db = new PGlite();
  await db.exec(`create schema auth; create role authenticated nologin; create role anon nologin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const sql = await readFile(new URL('../supabase/migrations/202610310001_library.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  return db;
}
async function as(db, user, sql, params = []) {
  await db.exec(`set request.jwt.claim.sub = '${user}'; set role authenticated;`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role;'); }
}
const base = { id: bookId, title: 'Ο Κόσμος', author: 'Νίκος', category: 'Φιλοσοφία', pageCount: 100, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-31T10:00:00Z', copies: [{ id: 'a', ownership: 'owned', loanTo: 'Μαρία' }], readings: [{ id: 'b', status: 'finished', finishedAt: '2026-05-03', currentPage: 100 }], archived: false };

test('migration enforces owner isolation and revision conflicts', async () => {
  const db = await database();
  try {
    const save = async (user, document, rev) => (await as(db, user, 'select public.library_save($1::jsonb,$2::integer) as value', [JSON.stringify(document), rev])).rows[0].value;
    const first = await save(ids[0], base, 0);
    assert.equal(first.book.revision, 1);
    assert.equal((await as(db, ids[1], 'select count(*)::int as n from public.library_books')).rows[0].n, 0);
    const conflict = await save(ids[0], { ...base, title: 'Αλλαγή', updatedAt: '2026-11-01T00:00:00Z' }, 0);
    assert.equal(conflict.code, 'CONFLICT');
    assert.equal(conflict.remote.title, 'Ο Κόσμος');
    const replay = await save(ids[0], base, 0);
    assert.equal(replay.book.revision, 1);
    const denied = await as(db, ids[1], 'update public.library_books set document = $1 where id = $2', [JSON.stringify({ ...base, title: 'Κλοπή' }), bookId]);
    assert.equal(denied.affectedRows, 0);
    assert.equal((await as(db, ids[0], 'select document->>\'title\' as title from public.library_books')).rows[0].title, 'Ο Κόσμος');
  } finally { await db.close(); }
});

test('search folds Greek accents and final sigma, stats count sessions', async () => {
  const db = await database();
  try {
    await as(db, ids[0], 'select public.library_save($1::jsonb,0)', [JSON.stringify(base)]);
    const search = (await as(db, ids[0], "select public.library_search('κοσμοσ','', '', '', 0, 24, false) as value")).rows[0].value;
    assert.equal(search.total, 1);
    const stats = (await as(db, ids[0], 'select public.library_stats(2026) as value')).rows[0].value;
    assert.equal(stats.finished, 1);
    assert.equal(stats.pages, 100);
    assert.equal(stats.loaned, 1);
    assert.equal(stats.monthly[4], 1);
  } finally { await db.close(); }
});

test('status filter follows current reading and recommendations exclude active reading', async () => {
  const db = await database();
  try {
    const reread = { ...base, readings: [
      { id: 'old', status: 'reading', currentPage: 10 },
      { id: 'new', status: 'finished', finishedAt: '2026-05-03' }
    ] };
    await as(db, ids[0], 'select public.library_save($1::jsonb,0)', [JSON.stringify(reread)]);
    const finished = (await as(db, ids[0], "select public.library_search('', '', 'finished', '', 0, 24, false) as value")).rows[0].value;
    const reading = (await as(db, ids[0], "select public.library_search('', '', 'reading', '', 0, 24, false) as value")).rows[0].value;
    assert.equal(finished.total, 0); // An older reading remains the current active session.
    assert.equal(reading.total, 1);
    const picks = (await as(db, ids[0], 'select public.library_recommendations(6) as value')).rows[0].value;
    assert.deepEqual(picks, []);
    const stats = (await as(db, ids[0], 'select public.library_stats(2026) as value')).rows[0].value;
    assert.equal(stats.reading, 1);
    assert.equal(stats.finished, 1);
  } finally { await db.close(); }
});

test('yearly goals are private to each authenticated owner', async () => {
  const db = await database();
  try {
    const saved = (await as(db, ids[0], "select public.library_save_goals('{\"2026\":{\"books\":24,\"pages\":5000}}'::jsonb) as value")).rows[0].value;
    assert.equal(saved.goals['2026'].books, 24);
    const other = (await as(db, ids[1], 'select public.library_get_goals() as value')).rows[0].value;
    assert.deepEqual(other, {});
    assert.equal((await as(db, ids[1], 'select count(*)::int as n from public.library_goals')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('search uses only public book fields and no implicit want status', async () => {
  const db = await database();
  try {
    await as(db, ids[0], 'select public.library_save($1::jsonb,0)', [JSON.stringify({ ...base, readings: [], tags: ['Ελληνικά'] })]);
    const lookup = async (query, status = '') => (await as(db, ids[0], 'select public.library_search($1,\'\',$2,\'\',0,24,false) as value', [query, status])).rows[0].value.total;
    assert.equal(await lookup('ελληνικα'), 1);
    assert.equal(await lookup('μαρια'), 0);
    assert.equal(await lookup('', 'want'), 0);
  } finally { await db.close(); }
});

test('reading statistics use the latest active session', async () => {
  const db = await database();
  try {
    await as(db, ids[0], 'select public.library_save($1::jsonb,0)', [JSON.stringify({ ...base, readings: [
      { id: 'old', status: 'reading' }, { id: 'new', status: 'paused' }
    ] })]);
    const stats = (await as(db, ids[0], 'select public.library_stats(2026) as value')).rows[0].value;
    assert.equal(stats.reading, 0);
  } finally { await db.close(); }
});

test('saving one yearly goal preserves other years from another device', async()=>{
 const db=await database();try{
  await as(db,ids[0],`select public.library_save_goals('{"2026":12}')`);
  const saved=(await as(db,ids[0],`select public.library_save_goals('{"2027":20}') as value`)).rows[0].value;
  assert.deepEqual(saved.goals,{'2026':12,'2027':20});
 }finally{await db.close();}
});
