import { normalizeBook, matchesBook, currentReading } from './domain.js';

const DB_VERSION = 1;
const BATCH = 100;
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const completed = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
});
const cursorBatch = (source, range, direction, size = BATCH) => new Promise((resolve, reject) => {
  const rows = [];
  const req = source.openCursor(range, direction);
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor || rows.length >= size) return resolve(rows);
    rows.push({ key: cursor.key, value: cursor.value });
    cursor.continue();
  };
});
const stampAfter = previous => {
  const now = Date.now();
  const prior = Date.parse(previous || '') || 0;
  return new Date(Math.max(now, prior + 1)).toISOString();
};

export class LocalRepository {
  constructor(namespace = 'local', indexedDBImpl = globalThis.indexedDB) {
    if (!indexedDBImpl) throw new Error('IndexedDB is unavailable');
    this.namespace = String(namespace);
    this.indexedDB = indexedDBImpl;
    this.database = null;
    this.opening = null;
  }

  async init() {
    if (this.database) return this;
    if (!this.opening) this.opening = new Promise((resolve, reject) => {
      const req = this.indexedDB.open(`my-book-tracker:${this.namespace}`, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('created', ['createdAt', 'id']);
        }
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        this.database = req.result;
        this.database.onversionchange = () => { this.database.close(); this.database = null; };
        resolve(this);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    }).catch(error => { this.opening = null; throw error; });
    return this.opening;
  }

  async get(id) {
    await this.init();
    const tx = this.database.transaction('books', 'readonly');
    const done = completed(tx);
    const result = await request(tx.objectStore('books').get(id));
    await done;
    return result;
  }

  async save(input, { queue = false, expectedRevision = input?.revision || 0 } = {}) {
    const normalized = normalizeBook(input);
    await this.init();
    const tx = this.database.transaction(['books', 'outbox'], 'readwrite');
    const done = completed(tx);
    try {
      const books = tx.objectStore('books');
      const outbox = tx.objectStore('outbox');
      const [existing, pending] = await Promise.all([
        request(books.get(normalized.id)), request(outbox.get(normalized.id))
      ]);
      if (!queue && pending) { await done; return existing; }
      const book = queue ? { ...normalized, updatedAt: stampAfter(existing?.updatedAt || normalized.updatedAt) } : normalized;
      books.put(book);
      if (queue) outbox.put({ id: book.id, book, expectedRevision: pending?.expectedRevision ?? expectedRevision });
      await done;
      return book;
    } catch (error) {
      tx.abort();
      await done.catch(() => {});
      throw error;
    }
  }

  async *all() {
    await this.init();
    let last;
    while (true) {
      const tx = this.database.transaction('books', 'readonly');
      const done = completed(tx);
      const index = tx.objectStore('books').index('created');
      const range = last === undefined ? undefined : IDBKeyRange.upperBound(last, true);
      const rows = await cursorBatch(index, range, 'prev');
      await done;
      if (!rows.length) return;
      last = rows.at(-1).key;
      for (const row of rows) yield row.value;
    }
  }

  async search({ query = '', category = '', status = '', ownership = '', offset = 0, limit = 24, archived = false } = {}) {
    const skip = Math.max(0, Math.floor(Number(offset) || 0));
    const take = Math.max(0, Math.min(500, Math.floor(Number(limit) || 0)));
    const items = [];
    let total = 0;
    for await (const book of this.all()) {
      if (!matchesBook(book, { query, category, status, ownership, archived })) continue;
      if (total >= skip && items.length < take) items.push(book);
      total++;
    }
    return { items, total };
  }

  async pending() {
    await this.init();
    const rows = [];
    let last;
    while (true) {
      const tx = this.database.transaction('outbox', 'readonly');
      const done = completed(tx);
      const range = last === undefined ? undefined : IDBKeyRange.lowerBound(last, true);
      const batch = await cursorBatch(tx.objectStore('outbox'), range, 'next');
      await done;
      if (!batch.length) break;
      last = batch.at(-1).key;
      rows.push(...batch.map(item => item.value));
    }
    return rows;
  }

  async ack(id, sentUpdatedAt, remoteBook) {
    const remote = normalizeBook(remoteBook);
    if (remote.id !== id) throw new Error('Acknowledgment book ID mismatch');
    await this.init();
    const tx = this.database.transaction(['books', 'outbox'], 'readwrite');
    const done = completed(tx);
    try {
      const books = tx.objectStore('books');
      const outbox = tx.objectStore('outbox');
      const pending = await request(outbox.get(id));
      if (!pending) { await done; return false; }
      if (pending.book.updatedAt === sentUpdatedAt) {
        books.put(remote);
        outbox.delete(id);
      } else {
        pending.expectedRevision = remote.revision;
        outbox.put(pending);
      }
      await done;
      return true;
    } catch (error) {
      tx.abort(); await done.catch(() => {}); throw error;
    }
  }

  async discardPending(id, remoteBook) {
    const remote = normalizeBook(remoteBook);
    if (remote.id !== id) throw new Error('Remote book ID mismatch');
    await this.init();
    const tx = this.database.transaction(['books', 'outbox'], 'readwrite');
    const done = completed(tx);
    tx.objectStore('books').put(remote);
    tx.objectStore('outbox').delete(id);
    await done;
    return remote;
  }

  async stats(year = new Date().getFullYear()) {
    const result = { total: 0, reading: 0, finished: 0, owned: 0, loaned: 0, pages: 0, categories: [], monthly: Array(12).fill(0) };
    const categories = new Map();
    for await (const book of this.all()) {
      if (book.archived) continue;
      result.total++;
      if (currentReading(book)?.status === 'reading') result.reading++;
      if (book.copies.some(copy => copy.ownership === 'owned')) result.owned++;
      result.loaned += book.copies.filter(copy => copy.loanTo).length;
      categories.set(book.category, (categories.get(book.category) || 0) + 1);
      for (const session of book.readings) {
        if (session.status !== 'finished' || !session.finishedAt?.startsWith(`${year}-`)) continue;
        result.finished++;
        result.pages += book.pageCount;
        result.monthly[Number(session.finishedAt.slice(5, 7)) - 1]++;
      }
    }
    result.categories = [...categories].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'el'));
    return result;
  }

  async recommendations(limit = 6) {
    const take = Math.max(0, Math.floor(Number(limit) || 0));
    if (take === 0) return [];
    const ranked = [];
    const compare = (a, b) => Number(b.hasWant) - Number(a.hasWant)
      || a.book.createdAt.localeCompare(b.book.createdAt)
      || a.book.id.localeCompare(b.book.id);
    for await (const book of this.all()) {
      if (book.archived || !book.copies.some(copy => copy.ownership === 'owned') || book.readings.some(reading => reading.status !== 'want' || reading.currentPage > 0)) continue;
      const candidate = { book, hasWant: book.readings.some(reading => reading.status === 'want') };
      const index = ranked.findIndex(item => compare(candidate, item) < 0);
      if (index < 0) ranked.push(candidate);
      else ranked.splice(index, 0, candidate);
      if (ranked.length > take) ranked.pop();
    }
    return ranked.map(item => item.book);
  }

  async migrateLegacy(storage = globalThis.localStorage) {
    const key = 'my_book_tracker_offline_queue';
    const raw = storage?.getItem(key);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) throw new Error('Legacy queue must be an array');
    const prepared = [];
    for (let index = 0; index < queue.length; index++) {
      const legacy = queue[index];
      if (!legacy || typeof legacy !== 'object') throw new Error(`Malformed legacy book at row ${index + 1}`);
      const hashInput = new TextEncoder().encode(`${index}:${legacy.id || ''}:${JSON.stringify(legacy)}`);
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', hashInput));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      prepared.push(normalizeBook({ ...legacy, id, sources: [...(legacy.sources || []), ...(legacy.addedAt ? [{name: `Παλιά καταχώριση · ${legacy.addedAt}`, url: '', fetchedAt: ''}] : [])] }));
    }
    for (const book of prepared) await this.save(book);
    storage.removeItem(key);
    return prepared.length;
  }
}
