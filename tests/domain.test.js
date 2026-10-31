import test from 'node:test';
import assert from 'node:assert/strict';
let domain; try { domain = await import('../js/domain.js'); } catch {}
test('Greek search ignores accents, case and final sigma', () => {
  assert.ok(domain, 'domain module implemented');
  assert.equal(domain.normalizeText('ΜΟΥΣΙΚΉ — κόσμος'), domain.normalizeText('μουσικη — κοσμοσ'));
});
test('ISBN checksums normalize ISBN10 and ISBN13 but reject unrelated barcodes', () => {
  assert.equal(domain.normalizeISBN('0-306-40615-2'), '9780306406157');
  assert.equal(domain.normalizeISBN('9780306406157'), '9780306406157');
  assert.throws(()=>domain.normalizeISBN('1234567890123'), /ISBN/);
});
test('classification maps legacy genres and preserves meaningful subgenres', () => {
  const b=domain.normalizeBook({title:'Αρμονία',category:'Music Theory / Orchestration'});
  assert.equal(b.category,'Μουσική'); assert.equal(b.subcategory,'Ενορχήστρωση');
  assert.equal(b.copies.length,1); assert.equal(b.readings.length,0);
});
test('a copy loan is independent of reading progress; history survives edits', () => {
  const b=domain.normalizeBook({title:'Μουσική',pageCount:100,copies:[{ownership:'owned',loanTo:'Α',location:'Ράφι'}],readings:[{status:'finished',currentPage:100,startedAt:'2025-01-01',finishedAt:'2025-02-01',notes:'Σημείωση',rating:4},{status:'reading',currentPage:20,startedAt:'2026-10-01'}]});
  assert.equal(b.readings.length,2); assert.equal(b.copies[0].loanTo,'Α');
  assert.equal(domain.matchesBook(b,{query:'μουσικη',status:'reading'}),true);
  assert.equal(domain.matchesBook(b,{ownership:'wishlist'}),false);
});
test('validation refuses impossible progress and empty title', () => {
  assert.throws(()=>domain.normalizeBook({title:'  '}),/τίτλο/);
  assert.throws(()=>domain.normalizeBook({title:'Α',pageCount:50,readings:[{status:'reading',currentPage:51}]}),/σελίδ/);
  assert.throws(()=>domain.normalizeBook({title:'Α',readings:[{status:'finished',startedAt:'2026-02-01',finishedAt:'2026-01-01'}]}),/ημερομην/);
});
