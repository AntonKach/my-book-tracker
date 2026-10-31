import {normalizeBook,normalizeText,uid} from './domain.js';

export function parseCSV(source) {
  const s=source.replace(/^\uFEFF/,'');
  const firstLine=s.split(/\r?\n/)[0];
  const delimiter=(firstLine.match(/;/g)||[]).length>(firstLine.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<s.length;i++) {
    const c=s[i];
    if(quoted) {if(c==='"'){if(s[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'&&!cell&&!closed){quoted=true;continue;}
    if(c===delimiter){row.push(cell);cell='';closed=false;continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false;continue;}
    if(closed&&!/\s/.test(c))throw new Error('Μη έγκυρο CSV: χαρακτήρας μετά από εισαγωγικά.');
    cell+=c;
  }
  if(quoted)throw new Error('Μη έγκυρο CSV: δεν έκλεισαν τα εισαγωγικά.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
const fields={title:['title','τιτλοσ'],author:['author','συγγραφεασ'],category:['category','κατηγορια'],subcategory:['subcategory','υποκατηγορια'],summary:['summary','περιληψη'],isbn:['isbn'],tags:['tags','ετικετεσ'],publisher:['publisher','εκδοτησ'],year:['year','ετοσ'],language:['language','γλωσσα'],pageCount:['pagecount','σελιδεσ'],coverUrl:['coverurl','εξωφυλλο'],location:['location','θεση'],ownership:['ownership','κατοχη']};
export function parseImport(source,filename='') {
  const errors=[],warnings=[];let records=[],goals={};
  if(filename.toLowerCase().endsWith('.json')||/^[\s]*[\[{]/.test(source)) {
    const data=JSON.parse(source);
    if(Array.isArray(data))records=data;
    else if(data?.format==='booktracker'&&data.version===2&&Array.isArray(data.books)){records=data.books;goals=data.goals||{};}
    else throw new Error('Μη υποστηριζόμενο αρχείο αντιγράφου.');
  } else {
    const [headers,...rows]=parseCSV(source);if(!headers)throw new Error('Το αρχείο είναι κενό.');
    const normalized=headers.map(normalizeText);const mapping={};
    for(const [field,aliases] of Object.entries(fields))mapping[field]=normalized.findIndex(h=>aliases.includes(h));
    if(mapping.title<0)throw new Error('Το CSV χρειάζεται στήλη Τίτλος ή title.');
    records=rows.map((row,index)=>{
      if(row.length>headers.length&&!(headers.length===5&&row.length===6)){errors.push({row:index+2,message:'Περισσότερα πεδία από τις επικεφαλίδες.'});return null;}
      const obj=Object.fromEntries(Object.entries(mapping).filter(([,i])=>i>=0).map(([key,i])=>[key,row[i]||'']));
      if(mapping.isbn<0&&row[5]&&(!headers[5]||headers.length===5))obj.isbn=row[5];
      if(obj.location||obj.ownership)obj.copies=[{location:obj.location,ownership:obj.ownership||'owned'}];
      // Keep the original capture date without inventing a timezone for legacy timestamps.
      const stamp=row[normalized.findIndex(h=>h==='ημερομηνια')];
      if(stamp)obj.sources=[{name:`Εισαγωγή CSV · ${stamp}`,url:'',fetchedAt:new Date().toISOString()}];
      return obj;
    });
  }
  const books=[];
  records.forEach((r,i)=>{
    if(!r)return;
    try {
      const id=typeof r.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id)?r.id:uid();
      books.push(normalizeBook({...r,id,revision:0}));
    }catch(e){errors.push({row:i+2,message:e.message});}
  });
  const safeGoals={};for(const [y,n]of Object.entries(goals))if(/^\d{4}$/.test(y)&&Number.isInteger(n)&&n>=0)safeGoals[y]=n;
  return {books,errors,warnings,goals:safeGoals};
}
export function backupJSON(books,goals={}) {return JSON.stringify({format:'booktracker',version:2,exportedAt:new Date().toISOString(),goals,books},null,2);}
function cell(value){const s=String(value??'');const safe=/^[\s]*[=+@-]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';}
export const CSV_HEADERS=['Τίτλος','Συγγραφέας','ISBN','Κατηγορία','Υποκατηγορία','Ετικέτες','Εκδότης','Έτος','Γλώσσα','Σελίδες','Περίληψη','Εξώφυλλο','Θέση','Κατοχή'];
export function csvRow(b){return [b.title,b.author,b.isbn,b.category,b.subcategory,b.tags.join(', '),b.publisher,b.year,b.language,b.pageCount,b.summary,b.coverUrl,b.copies[0]?.location,b.copies[0]?.ownership].map(cell).join(',');}
export function exportCSV(books){return '\uFEFF'+CSV_HEADERS.map(cell).join(',')+'\r\n'+books.map(csvRow).join('\r\n');}
