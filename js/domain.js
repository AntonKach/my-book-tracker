export const CATEGORIES = {
  'Λογοτεχνία': ['Μυθιστόρημα', 'Διήγημα', 'Ποίηση', 'Θέατρο', 'Κόμικς', 'Παιδική'],
  'Φιλοσοφία': ['Ηθική', 'Γνωσιολογία', 'Δοκίμιο'],
  'Ιστορία': ['Ελληνική', 'Παγκόσμια', 'Βιογραφία'],
  'Επιστήμη': ['Μαθηματικά', 'Φυσική', 'Νευροεπιστήμη', 'Πληροφορική'],
  'Μουσική': ['Αρμονία', 'Ενορχήστρωση', 'Πιάνο', 'Παρτιτούρες', 'Λεξικά', 'Ιστορία'],
  'Τέχνη': ['Ζωγραφική', 'Αρχιτεκτονική', 'Φωτογραφία'],
  'Δίκαιο': ['Αστικό', 'Ποινικό', 'Δικονομία', 'Δημόσιο'],
  'Πρακτικά & προσωπική ανάπτυξη': ['Ψυχολογία', 'Επιχειρήσεις', 'Εκπαίδευση'],
  'Άλλο': []
};
export const STATUSES = {want:'Θέλω να διαβάσω',reading:'Διαβάζω',paused:'Σε παύση',finished:'Ολοκληρώθηκε',abandoned:'Δεν ολοκληρώθηκε'};
export const OWNERSHIP = {owned:'Δικό μου',borrowed:'Δανεικό',wishlist:'Λίστα επιθυμιών'};
const text = value => String(value ?? '').trim();
export const normalizeText = value => text(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/ς/g,'σ');
export const uid = () => crypto.randomUUID();
export const today = () => new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function normalizeISBN(value) {
  const s=text(value).replace(/[\s-]/g,'').toUpperCase();
  if (!s) return '';
  if (/^\d{9}[\dX]$/.test(s) && [...s].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0)%11===0) {
    const base='978'+s.slice(0,9); return base+String((10-[...base].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)%10);
  }
  if (/^97[89]\d{10}$/.test(s) && [...s].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10===0) return s;
  throw new Error('Το ISBN δεν είναι έγκυρο. Ελέγξτε τα ψηφία ή αφήστε το κενό.');
}
export function classify(category, subcategory='') {
  const aliases={fiction:['Λογοτεχνία','Μυθιστόρημα'],poetry:['Λογοτεχνία','Ποίηση'],philosophy:['Φιλοσοφία',''],history:['Ιστορία',''],biography:['Ιστορία','Βιογραφία'],science:['Επιστήμη',''],art:['Τέχνη',''],business:['Πρακτικά & προσωπική ανάπτυξη','Επιχειρήσεις'],'self-help':['Πρακτικά & προσωπική ανάπτυξη','Ψυχολογία'],'music theory / orchestration':['Μουσική','Ενορχήστρωση'],'music reference':['Μουσική','Λεξικά'],'μεταμοντερνα λογοτεχνια':['Λογοτεχνία','Μυθιστόρημα']};
  const pair=aliases[normalizeText(category)] || [text(category)||'Άλλο',''];
  return {category:pair[0],subcategory:text(subcategory)||pair[1]};
}
function integer(value,label,max=10000000) {
  const n=Number(value||0);
  if (!Number.isInteger(n)||n<0||n>max) throw new Error(`Μη έγκυρη τιμή: ${label}.`);
  return n;
}
function date(value) {
  const s=text(value); if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s) throw new Error('Μη έγκυρη ημερομηνία.');
  return s;
}
export function safeImage(value) {
  const s=text(value); if (!s) return '';
  try {const u=new URL(s);return u.protocol==='https:'?u.href:'';} catch {return '';}
}
function timestamp(value, fallback) {
  if(value===undefined||value===null||value==='')return fallback;
  if(typeof value!=='string'||Number.isNaN(Date.parse(value)))throw new Error('Μη έγκυρη χρονική σήμανση εγγραφής.');
  return new Date(value).toISOString();
}
export function normalizeBook(input={}) {
  const title=text(input.title); if (!title) throw new Error('Συμπληρώστε τον τίτλο του βιβλίου.');
  const now=new Date().toISOString();
  const pageCount=integer(input.pageCount,'σύνολο σελίδων');
  const readings=(input.readings||[]).map(r=>{
    if (!STATUSES[r.status]) throw new Error('Μη έγκυρη κατάσταση ανάγνωσης.');
    const currentPage=integer(r.currentPage,'τρέχουσα σελίδα');
    if(pageCount && currentPage>pageCount) throw new Error('Η τρέχουσα σελίδα υπερβαίνει το σύνολο σελίδων.');
    const startedAt=date(r.startedAt), finishedAt=date(r.finishedAt);
    if(startedAt&&finishedAt&&finishedAt<startedAt) throw new Error('Η ημερομηνία ολοκλήρωσης προηγείται της έναρξης.');
    return {id:text(r.id)||uid(),status:r.status,currentPage,startedAt,finishedAt,rating:integer(r.rating,'βαθμολογία',5),notes:text(r.notes)};
  });
  const copies=(input.copies ?? [{ownership:'owned'}]).map(c=>{
    const ownership=c.ownership||'owned'; if(!OWNERSHIP[ownership]) throw new Error('Μη έγκυρη κατοχή βιβλίου.');
    const loanDate=date(c.loanDate),loanDue=date(c.loanDue);
    if(loanDate&&loanDue&&loanDue<loanDate) throw new Error('Η ημερομηνία επιστροφής προηγείται του δανεισμού.');
    return {id:text(c.id)||uid(),ownership,location:text(c.location),loanTo:text(c.loanTo),loanDate,loanDue};
  });
  return {
    id:text(input.id)||uid(),title,author:text(input.author),isbn:normalizeISBN(input.isbn),
    ...classify(input.category,input.subcategory),tags:[...new Set((Array.isArray(input.tags)?input.tags:text(input.tags).split(',')).map(text).filter(Boolean))],
    summary:text(input.summary),coverUrl:safeImage(input.coverUrl||input.coverThumbnail),publisher:text(input.publisher),year:text(input.year),language:text(input.language),pageCount,copies,readings,
    sources:(input.sources||[]).filter(s=>s&&typeof s==='object').map(s=>({name:text(s.name),url:text(s.url),fetchedAt:text(s.fetchedAt)})),
    createdAt:timestamp(input.createdAt,now),updatedAt:timestamp(input.updatedAt,now),archived:input.archived===true,revision:integer(input.revision,'έκδοση εγγραφής')
  };
}
export function currentReading(book) { return book.readings?.findLast(r=>r.status==='reading'||r.status==='paused') || book.readings?.at(-1) || null; }
export function matchesBook(book,{query='',category='',status='',ownership='',archived=false}={}) {
  if(Boolean(book.archived)!==archived) return false;
  if(category&&book.category!==category) return false;
  if(status&&currentReading(book)?.status!==status) return false;
  if(ownership&&!book.copies.some(c=>c.ownership===ownership)) return false;
  const hay=normalizeText([book.title,book.author,book.isbn,book.category,book.subcategory,...book.tags,...book.copies.map(c=>c.location)].join(' '));
  return normalizeText(query).split(/\s+/).every(word=>hay.includes(word));
}
export function duplicateOf(a,b) {
  return a.id!==b.id && ((a.isbn&&b.isbn&&a.isbn===b.isbn) || (normalizeText(a.title)===normalizeText(b.title)&&normalizeText(a.author)===normalizeText(b.author)));
}
