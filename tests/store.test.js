import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
const indexedDB = globalThis.indexedDB;
import { LocalRepository } from '../js/library-store.js';

let sequence = 0;
const repository = async () => {
  const repo = new LocalRepository(`test-${++sequence}`, indexedDB);
  await repo.init();
  return repo;
};

function book(id, overrides = {}) {
  return {
    id, title: `Book ${id}`, author: 'Author', isbn: '', category: 'Ιστορία',
    subcategory: '', tags: [], summary: '', coverUrl: '', publisher: '',
    year: null, language: 'el', pageCount: 240,
    copies: [{ id: `${id}-copy`, ownership: 'owned', location: '', loanTo: '', loanDate: '', loanDue: '' }],
    readings: [], sources: [], createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', archived: false, revision: 0,
    ...overrides
  };
}

test('queued save is durable across repository instances and isolated by namespace', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const first = await repository();
  await first.save(book(id), { queue: true });
  const reopened = new LocalRepository(first.namespace, indexedDB);
  assert.equal((await reopened.get(id)).title, `Book ${id}`);
  assert.equal((await reopened.pending()).length, 1);
  const other = await repository();
  assert.equal(await other.get(id), undefined);
});

test('search counts all matches but returns a stable bounded page', async () => {
  const repo = await repository();
  const ids = [1, 2, 3].map(n => `${n}1111111-1111-4111-8111-111111111111`);
  for (const id of ids) await repo.save(book(id, { title: 'Σύνοψη' }));
  const page = await repo.search({ query: 'συνοψη', offset: 1, limit: 1 });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, ids[1]);
});

test('ack keeps a newer queued edit and advances its remote base revision', async () => {
  const repo = await repository();
  const id = '22222222-2222-4222-8222-222222222222';
  const first = await repo.save(book(id), { queue: true });
  await repo.save({ ...first, title: 'New edit' }, { queue: true });
  await repo.ack(id, first.updatedAt, { ...first, revision: 1 });
  assert.equal((await repo.get(id)).title, 'New edit');
  const pending = await repo.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].expectedRevision, 1);
});

test('statistics count finished sessions in selected year and distinct active books', async () => {
  const repo = await repository();
  const id = '33333333-3333-4333-8333-333333333333';
  await repo.save(book(id, { readings: [
    { id: 'a', status: 'finished', currentPage: 240, startedAt: '2026-01-01', finishedAt: '2026-03-02', rating: 5, notes: '' },
    { id: 'b', status: 'finished', currentPage: 240, startedAt: '2026-04-01', finishedAt: '2026-05-02', rating: 5, notes: '' },
    { id: 'c', status: 'finished', currentPage: 240, startedAt: '2025-01-01', finishedAt: '2025-03-02', rating: 5, notes: '' }
  ] }));
  const stats = await repo.stats(2026);
  assert.equal(stats.total, 1);
  assert.equal(stats.finished, 2);
  assert.equal(stats.pages, 480);
  assert.equal(stats.monthly[2], 1);
  assert.equal(stats.monthly[4], 1);
});

test('remote save cannot overwrite an unsent local edit', async () => {
  const repo = await repository();
  const id = '44444444-4444-4444-8444-444444444444';
  await repo.save(book(id, { title: 'Local' }), { queue: true });
  await repo.save(book(id, { title: 'Remote', revision: 4 }));
  assert.equal((await repo.get(id)).title, 'Local');
  assert.equal((await repo.pending()).length, 1);
  await repo.discardPending(id, book(id, { title: 'Remote', revision: 4 }));
  assert.equal((await repo.get(id)).title, 'Remote');
  assert.equal((await repo.pending()).length, 0);
});

test('malformed legacy queue remains available for repair', async () => {
  const repo = await repository();
  const storage = {
    value: JSON.stringify([{ id: 'old-1', title: 'Good' }, { id: 'old-2' }]),
    getItem() { return this.value; },
    removeItem() { this.value = null; }
  };
  await assert.rejects(repo.migrateLegacy(storage));
  assert.ok(storage.value);
  assert.equal((await repo.search()).total, 0);
});

test('legacy queue gets deterministic UUIDs and is removed after durable import', async () => {
  const repo = await repository();
  const storage = {
    value: JSON.stringify([{ id: 'book_123', title: 'Legacy' }]),
    getItem() { return this.value; },
    removeItem() { this.value = null; }
  };
  assert.equal(await repo.migrateLegacy(storage), 1);
  assert.equal(storage.value, null);
  const [record] = (await repo.search()).items;
  assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(record.title, 'Legacy');
  assert.equal((await repo.pending()).length, 0);
  await repo.save({ ...record, title: 'Edited locally' });
  assert.equal((await repo.get(record.id)).title, 'Edited locally');
});

test('recommendation limit zero returns no books', async () => {
  const repo = await repository();
  await repo.save(book('55555555-5555-4555-8555-555555555555'));
  assert.deepEqual(await repo.recommendations(0), []);
});

test('recommendations exclude books with reading progress', async () => {
  const repo = await repository();
  const id = '66666666-6666-4666-8666-666666666666';
  await repo.save(book(id, { readings: [
    { id: 'reading', status: 'reading', currentPage: 30, startedAt: '2026-02-01', finishedAt: '', rating: 0, notes: '' }
  ] }));
  assert.deepEqual(await repo.recommendations(), []);
});

test('recommendations prioritize want sessions then oldest eligible owned books', async () => {
  const repo = await repository();
  const ids = [7, 8, 9, 10].map(n => `${String(n).padStart(8, '0')}-7777-4777-8777-777777777777`);
  const want = { id: 'want', status: 'want', currentPage: 0, startedAt: '', finishedAt: '', rating: 0, notes: '' };
  await repo.save(book(ids[0], { createdAt: '2024-01-01T00:00:00.000Z' }));
  await repo.save(book(ids[1], { createdAt: '2023-01-01T00:00:00.000Z', readings: [want] }));
  await repo.save(book(ids[2], { createdAt: '2025-01-01T00:00:00.000Z', readings: [want] }));
  await repo.save(book(ids[3], { createdAt: '2022-01-01T00:00:00.000Z' }));
  assert.deepEqual((await repo.recommendations(3)).map(item => item.id), [ids[1], ids[2], ids[3]]);
});

test('legacy capture date survives migration in source notes',async()=>{
 const repo=await repository();const storage={value:JSON.stringify([{title:'Old',addedAt:'22 Μαΐου 2026'}]),getItem(){return this.value},removeItem(){this.value=null}};
 await repo.migrateLegacy(storage);const b=(await repo.search()).items[0];assert.ok(b.sources.some(s=>s.name.includes('22 Μαΐου 2026')));
});
