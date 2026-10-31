import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBook} from '../js/domain.js';
let exchange;try{exchange=await import('../js/import-export.js')}catch{}
test('legacy Sheet CSV handles Greek headers, multiline quotes and unnamed ISBN column',()=>{
 assert.ok(exchange,'exchange module implemented');
 const csv='\ufeffΗμερομηνία,Τίτλος,Συγγραφέας,Κατηγορία,Περίληψη,\r\n"22/05/2026 9:21:25 π.μ.","Βιβλίο, Α",Συγγραφέας,Poetry,"Μία\nδύο",9780306406157';
 const result=exchange.parseImport(csv,'library.csv');assert.equal(result.errors.length,0);assert.equal(result.books.length,1);assert.equal(result.books[0].summary,'Μία\nδύο');assert.equal(result.books[0].isbn,'9780306406157');assert.equal(result.books[0].subcategory,'Ποίηση');
});
test('malformed rows are reported, never silently imported with wrong columns',()=>{
 const r=exchange.parseImport('Τίτλος;Συγγραφέας;ISBN\nΑ;Β;123\n;Γ;\nΔ;Ε;9780306406157','a.csv');
 assert.equal(r.books.length,1);assert.equal(r.errors.length,2);
 assert.throws(()=>exchange.parseImport('title,author\n"oops','a.csv'),/CSV/);
});
test('JSON backup retains independent copies, reading history and ids but strips cloud revision',()=>{
 const b=normalizeBook({title:'A',copies:[{location:'Shelf',loanTo:'B'}],readings:[{status:'finished',finishedAt:'2026-01-02',rating:5,notes:'test'}],revision:8});
 const result=exchange.parseImport(exchange.backupJSON([b],{2026:12}),'a.json');
 assert.equal(result.books[0].id,b.id);assert.deepEqual(result.books[0].readings,b.readings);assert.deepEqual(result.books[0].copies,b.copies);assert.equal(result.books[0].revision,0);assert.equal(result.goals[2026],12);
});
test('CSV export escapes spreadsheet formulas and quoted cells',()=>{
 const b=normalizeBook({title:'=SUM(1,2)',author:'A "B"'});const csv=exchange.exportCSV([b]);
 assert.match(csv,/'=SUM/);assert.match(csv,/A ""B""/);
});

test('invalid imported timestamps are reported instead of creating unindexed hidden records',()=>{
 const result=exchange.parseImport('[{"title":"Hidden","createdAt":{"bad":true}}]','backup.json');
 assert.equal(result.books.length,0);assert.equal(result.errors.length,1);
});
