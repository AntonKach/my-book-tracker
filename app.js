import {CATEGORIES,STATUSES,OWNERSHIP,normalizeBook,normalizeISBN,normalizeText,duplicateOf,uid,today} from './js/domain.js';
import {LocalRepository} from './js/library-store.js';
import {CloudClient} from './js/cloud.js';
import {parseImport,CSV_HEADERS,csvRow} from './js/import-export.js';
import {resolveISBN} from './js/api.js';
import {processAndCompressImage,startBarcodeScanner,stopBarcodeScanner} from './js/scanner.js';
import {esc,options,bookCard,editorHTML,readEditor,completeReadingFields,statsHTML} from './js/ui.js';

const $=id=>document.getElementById(id);
const local=new LocalRepository();let store=local,cloud=null,cloudAccount=null,view='library',offset=0,draft=null,editing=false,duplicate=null,importData=null,syncPromise=null,conflict=null,renderToken=0,scanBusy=false;
const pageSize=24;
const readJSON=(key,fallback={})=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
// This publishable key is safe for browsers; access to books still requires a user session and RLS.
const config=readJSON('booktracker.cloud.config',{
 url:'https://vhirgklggyhlvppatwes.supabase.co',
 key:'sb_publishable_yeh5tT68bls-iCKuQGc6ng_vUeu4R5O'
});
const goalKey=()=>`booktracker.goals.${store.namespace}`;
const goals=()=>readJSON(goalKey());
function toast(message){$('toast').textContent=message;$('toast').classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),5500);}
function notice(message=''){$('notice').textContent=message;$('notice').classList.toggle('hidden',!message);}
function on(id,event,fn){$(id).addEventListener(event,e=>{if(event==='submit')e.preventDefault();Promise.resolve().then(()=>fn(e)).catch(error=>{console.error(error);toast(error.message||'Η ενέργεια δεν ολοκληρώθηκε.');});});}
function close(id){$(id).close();if(id==='scan-dialog')stopBarcodeScanner($('reader-wrapper'));}
function openSettings(){$('cloud-url').value=config.url||'';$('cloud-key').value=config.key||'';coverStatus();$('settings-dialog').showModal();}
function coverStatus(){$('cover-status').textContent=cloud?.session?'Η αναγνώριση εξωφύλλου είναι έτοιμη στον λογαριασμό σου, σε όλες τις συσκευές. Δεν χρειάζεται κλειδί Gemini.':'Συνδέσου στον λογαριασμό σου για αναγνώριση εξωφύλλου χωρίς κλειδί Gemini.';}
function openScan(){const signedIn=Boolean(cloud?.session);$('cover-start').textContent=signedIn?'Φωτογραφία εξωφύλλου':'Σύνδεση για φωτογραφία';$('cover-help').textContent=signedIn?'Αναγνώριση μέσω του λογαριασμού σου, χωρίς κλειδί στη συσκευή. Το εξώφυλλο αποστέλλεται στο Gemini· έλεγξε τα στοιχεία πριν αποθηκεύσεις.':'Για φωτογραφία εξωφύλλου συνδέσου στον λογαριασμό σου. Δεν χρειάζεται να βάλεις κλειδί Gemini.';$('scan-message').textContent='Τα στοιχεία θα εμφανιστούν για έλεγχο πριν από την αποθήκευση.';$('scan-dialog').showModal();}
function filters(){return {query:$('search').value,category:$('category-filter').value,status:$('status-filter').value,ownership:$('ownership-filter').value,archived:$('archived-filter').checked,offset,limit:pageSize};}
function activeRepository(){return cloud?.session&&navigator.onLine?cloud:store;}
function connection(){ $('connection-status').textContent=cloud?`${!cloud.session?'Απαιτείται σύνδεση':navigator.onLine?'Cloud':'Χωρίς σύνδεση'} · ${cloudAccount?.email||''}`:'Τοπική βιβλιοθήκη'; }
async function read(method,...args){
 const repo=activeRepository();
 try{return await repo[method](...args);}catch(error){if(repo!==cloud)throw error;notice('Το cloud δεν είναι διαθέσιμο. Εμφανίζονται μόνο τα βιβλία που έχουν αποθηκευτεί σε αυτή τη συσκευή.');return store[method](...args);}
}
async function refresh(){
 const token=++renderToken;connection();if(cloud&&!cloud.session)notice('Η σύνδεση έληξε. Οι αλλαγές κρατιούνται στη συσκευή και περιμένουν νέα σύνδεση στις Ρυθμίσεις.');
 if(cloud?.session&&!navigator.onLine)notice('Εκτός σύνδεσης: βλέπεις τα βιβλία που έχουν αποθηκευτεί σε αυτή τη συσκευή. Οι αλλαγές θα συγχρονιστούν όταν επιστρέψει η σύνδεση.');
 const pending=cloud?await store.pending():[];
 $('pending-panel').classList.toggle('hidden',!pending.length);
 $('pending-panel').innerHTML=pending.length?`<strong>${pending.length} αλλαγές περιμένουν επιβεβαίωση από το cloud.</strong><div>${pending.slice(0,24).map(p=>`<button class="secondary small" data-pending="${esc(p.id)}">${esc(p.book.title)}</button>`).join('')}<button id="retry-sync" class="primary small">Συγχρονισμός</button></div>`:'';
 if(view==='stats'){const year=Number($('stats-year').value);const s=await read('stats',year);if(token!==renderToken)return;$('goal').value=goals()[year]??12;$('stats-content').innerHTML=statsHTML(s,year,Number($('goal').value));return;}
 const result=await read('search',filters());if(token!==renderToken)return;
 if(offset>=result.total&&offset>0){offset=Math.max(0,Math.ceil(result.total/pageSize)-1)*pageSize;return refresh();}
 if(activeRepository()===cloud)for(const b of result.items)await store.save(b);
 if(token!==renderToken)return;
 $('book-grid').innerHTML=result.items.map(bookCard).join('');$('empty').classList.toggle('hidden',result.items.length>0);
 $('result-count').textContent=`${result.total.toLocaleString('el-GR')} βιβλία${filters().archived?' στο αρχείο':''}`;
 $('page-label').textContent=result.total?`${offset+1}–${Math.min(offset+pageSize,result.total)} από ${result.total}`:'';
 $('previous').disabled=offset===0;$('next').disabled=offset+pageSize>=result.total;
 if(view==='reading'){
  const [s,recs]=await Promise.all([read('stats',new Date().getFullYear()),read('recommendations',4)]);if(token!==renderToken)return;
  $('reading-summary').innerHTML=`<h2>Λίγες σελίδες, κάθε μέρα.</h2><p>${s.reading} βιβλία σε εξέλιξη · ${s.finished} ολοκληρωμένες αναγνώσεις φέτος</p>`;
  $('recommendation-grid').innerHTML=recs.map(bookCard).join('');
 }
}
function switchView(next){view=next;offset=0;notice();$('search').value='';$('status-filter').value=next==='reading'?'reading':'';$('category-filter').value='';$('ownership-filter').value='';$('archived-filter').checked=false;
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('collection-view').classList.toggle('hidden',view==='stats');$('stats-view').classList.toggle('hidden',view!=='stats');$('reading-summary').classList.toggle('hidden',view!=='reading');$('recommendations').classList.toggle('hidden',view!=='reading');
 $('view-title').textContent={library:'Η βιβλιοθήκη μου',reading:'Η ανάγνωσή μου',stats:'Μια χρονιά σε σελίδες'}[view];$('view-subtitle').textContent={library:'Κάθε βιβλίο στη θέση του.',reading:'Κράτα τον ρυθμό σου και όσα θέλεις να θυμάσαι.',stats:'Οι μικρές καθημερινές αναγνώσεις γίνονται μια μεγάλη διαδρομή.'}[view];return refresh();}
function renderEditor(){
 $('editor-fields').innerHTML=editorHTML(draft);$('editor-title').textContent=editing?'Το βιβλίο μου':'Νέο βιβλίο';$('archive-book').classList.toggle('hidden',!editing);$('archive-book').textContent=draft.archived?'Επαναφορά στη βιβλιοθήκη':'Αρχειοθέτηση';
}
function openEditor(book=null){editing=Boolean(book?.id);draft=book?structuredClone(book):normalizeBook({title:'Νέο βιβλίο'});if(!book)draft.title='';duplicate=null;$('duplicate-panel').classList.add('hidden');$('book-error').textContent='';renderEditor();$('book-dialog').showModal();}
async function openBook(id,preferLocal=false){
 let b;const p=(await store.pending()).find(p=>p.id===id);
 if(p)b=p.book;else if(preferLocal)b=await store.get(id);else b=await read('get',id);
 if(!b)throw new Error('Το βιβλίο δεν βρέθηκε. Ανανεώστε τη συλλογή.');openEditor(b);
}
async function findDuplicate(b){
 for await(const candidate of store.all())if(candidate.id!==b.id&&duplicateOf(b,candidate))return candidate;
 for(const q of [b.isbn,b.title].filter(Boolean)){
  let skip=0;
  do{const r=await read('search',{query:q,offset:skip,limit:100});const found=r.items.find(candidate=>duplicateOf(b,candidate));if(found)return found;skip+=r.items.length;if(skip>=r.total||!r.items.length)break;}while(true);
 }
 return null;
}
async function saveBook(input){
 const book=normalizeBook({...input,updatedAt:new Date().toISOString()});
 const saved=await store.save(book,{queue:Boolean(cloud),expectedRevision:book.revision});
 toast(cloud?'Αποθηκεύτηκε στη συσκευή. Αναμονή επιβεβαίωσης cloud.':'Το βιβλίο αποθηκεύτηκε στη συσκευή.');
 if(cloud?.session)await sync();return saved;
}
async function sync(){
 if(syncPromise)return syncPromise;if(!cloud?.session||!navigator.onLine)return;
 const client=cloud,repository=store;
 syncPromise=(async()=>{
  let confirmed=0;
  for(const entry of await repository.pending()){
   try{const remote=await client.save(entry.book,entry.expectedRevision);await repository.ack(entry.id,entry.book.updatedAt,remote);confirmed++;}
   catch(e){if(e.code==='CONFLICT'){conflict={entry,remote:e.remote,repository,client};$('conflict-text').textContent=`Το βιβλίο «${entry.book.title}» έχει ενημερωθεί και στο cloud.`;if(!$('conflict-dialog').open)$('conflict-dialog').showModal();}else notice('Η αλλαγή αποθηκεύτηκε τοπικά, αλλά δεν επιβεβαιώθηκε από το cloud: '+e.message);break;}
  }
  if(confirmed)toast(`Επιβεβαιώθηκε η αποθήκευση ${confirmed} βιβλίων στο cloud.`);
 })().finally(()=>{syncPromise=null;});return syncPromise;
}
async function activateCloud(client,account=client.session?.user){
 if(!account?.id)throw new Error('Δεν υπάρχει αποθηκευμένος λογαριασμός.');
 cloud=client;cloudAccount=account;localStorage.setItem('booktracker.cloud.active',JSON.stringify({url:client.url,user:account}));store=new LocalRepository(`cloud:${client.url}:${account.id}`);await store.init();connection();
 try{localStorage.setItem(goalKey(),JSON.stringify(await client.getGoals()));}catch{ /* Preserve cached goals while offline. */ }
 await sync();await refresh();
}
async function lookupISBN(value){
 if(scanBusy)return;scanBusy=true;$('scan-message').textContent='Αναζήτηση της συγκεκριμένης έκδοσης…';
 try{const b=await resolveISBN(value);close('scan-dialog');openEditor(normalizeBook(b));editing=false;renderEditor();toast('Έλεγξε τα στοιχεία και αποθήκευσε το βιβλίο.');}
 catch(e){$('scan-message').textContent=e.message;}finally{scanBusy=false;}
}
async function exportLibrary(format){
 const source=activeRepository(),pending=cloud?new Map((await store.pending()).map(p=>[p.id,p.book])):new Map();
 const parts=format==='json'?[`{"format":"booktracker","version":2,"exportedAt":${JSON.stringify(new Date().toISOString())},"goals":${JSON.stringify(goals())},"books":[`]:['\uFEFF'+CSV_HEADERS.join(',')+'\r\n'];
 let count=0;
 for await(const record of source.all()){const b=pending.get(record.id)||record;pending.delete(record.id);parts.push(format==='json'?(count?',':'')+JSON.stringify(b):csvRow(b)+'\r\n');count++;}
 for(const b of pending.values()){parts.push(format==='json'?(count?',':'')+JSON.stringify(b):csvRow(b)+'\r\n');count++;}
 if(format==='json')parts.push(']}');
 const url=URL.createObjectURL(new Blob(parts,{type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`booktracker-${today()}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast(`Εξήχθησαν ${count} βιβλία${source===store&&cloud?' από την προσωρινή μνήμη αυτής της συσκευής':''}.`);
}
async function importBooks(){
 if(!importData)return;const button=$('import-confirm');button.disabled=true;let added=0,skipped=0;const failed=[];
 try{
  for(const original of importData.books){
   let b=structuredClone(original);const existing=await store.get(b.id)||await read('get',b.id);const dupe=existing||await findDuplicate(b);
   if(dupe&&!$('import-duplicates').checked){skipped++;continue;}
   if(dupe)b.id=uid();b.revision=0;b.updatedAt=new Date().toISOString();
   try{await store.save(b,{queue:Boolean(cloud),expectedRevision:0});added++;}catch(e){failed.push(`${b.title}: ${e.message}`);}
  }
  if(Object.keys(importData.goals).length){localStorage.setItem(goalKey(),JSON.stringify({...goals(),...importData.goals}));if(cloud?.session&&navigator.onLine)await cloud.saveGoals(goals());}
  $('import-message').textContent=`Εισήχθησαν ${added}. Παραλείφθηκαν ${skipped} ήδη καταχωρισμένα.${failed.length?' Αποτυχίες: '+failed.join('; '):''}`;
  importData=null;await sync();await refresh();
 }finally{button.disabled=false;}
}
async function bind(){
 $('category-filter').insertAdjacentHTML('beforeend',options(Object.fromEntries(Object.keys(CATEGORIES).map(k=>[k,k]))));$('status-filter').insertAdjacentHTML('beforeend',options(STATUSES));$('ownership-filter').insertAdjacentHTML('beforeend',options(OWNERSHIP));
 const year=new Date().getFullYear();for(let y=year+1;y>=year-20;y--)$('stats-year').insertAdjacentHTML('beforeend',`<option value="${y}" ${year===y?'selected':''}>${y}</option>`);
 document.addEventListener('click',e=>{const closeButton=e.target.closest('[data-close]');if(closeButton)close(closeButton.dataset.close);const nav=e.target.closest('[data-view]');if(nav)switchView(nav.dataset.view).catch(e=>toast(e.message));const book=e.target.closest('[data-book],[data-pending]');if(book)openBook(book.dataset.book||book.dataset.pending,Boolean(book.dataset.pending)).catch(e=>toast(e.message));if(e.target.id==='retry-sync')sync().then(refresh).catch(e=>toast(e.message));});
 on('add-book','click',()=>openEditor());on('empty-add','click',()=>openEditor());
 $('add-book').setAttribute('aria-label','Νέο βιβλίο');
 on('previous','click',()=>{offset=Math.max(0,offset-pageSize);return refresh();});on('next','click',()=>{offset+=pageSize;return refresh();});
 let searchTimer;on('search','input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;refresh().catch(e=>toast(e.message));},200);});
 for(const id of ['category-filter','status-filter','ownership-filter','archived-filter'])on(id,'change',()=>{offset=0;return refresh();});
 on('refresh','click',async()=>{notice();await sync();await refresh();});on('stats-year','change',refresh);
 on('book-form','click',e=>{
  const removeCopy=e.target.closest('[data-remove-copy]'),removeReading=e.target.closest('[data-remove-reading]'),returned=e.target.closest('[data-return-copy]');
  if(['add-copy','add-reading'].includes(e.target.id)||removeCopy||removeReading||returned){draft=readEditor($('book-form'),draft);
   if(e.target.id==='add-copy')draft.copies.push({id:uid(),ownership:'owned',location:'',loanTo:'',loanDate:'',loanDue:''});
   if(e.target.id==='add-reading')draft.readings.push({id:uid(),status:'want',currentPage:0,startedAt:'',finishedAt:'',rating:0,notes:''});
   if(removeCopy)draft.copies.splice(Number(removeCopy.dataset.removeCopy),1);if(removeReading)draft.readings.splice(Number(removeReading.dataset.removeReading),1);
   if(returned){const c=draft.copies[Number(returned.dataset.returnCopy)];c.loanTo='';c.loanDate='';c.loanDue='';}renderEditor();
  }
 });
 on('book-form','change',e=>{const match=e.target.name?.match(/^r(\d+)-status$/);if(match)completeReadingFields($('book-form'),match[1]);if(e.target.name==='category')$('subcategories').innerHTML=(CATEGORIES[e.target.value]||[]).map(s=>`<option value="${esc(s)}">`).join('');});
 on('book-form','submit',async e=>{e.preventDefault();const submit=e.submitter;submit.disabled=true;$('book-error').textContent='';
  try{let b=normalizeBook(readEditor($('book-form'),draft));
   if(!editing){duplicate=await findDuplicate(b);if(duplicate){const choice=$('duplicate-choice')?.value;if(!choice){$('duplicate-panel').innerHTML=`<p>Υπάρχει ήδη το «${esc(duplicate.title)}». Τι θέλεις να κάνεις;</p><label>Ενέργεια<select id="duplicate-choice"><option value="">Επίλεξε…</option><option value="copy">Πρόσθεσε αντίτυπο στο υπάρχον βιβλίο</option><option value="separate">Κράτησε ξεχωριστή εγγραφή / έκδοση</option></select></label>`;$('duplicate-panel').classList.remove('hidden');return;}if(choice==='copy')b=normalizeBook({...duplicate,copies:[...duplicate.copies,...b.copies],readings:[...duplicate.readings,...b.readings]});}}
   await saveBook(b);close('book-dialog');await refresh();
  }catch(err){$('book-error').textContent=err.message;}finally{submit.disabled=false;}
 });
 on('archive-book','click',async()=>{const b=normalizeBook(readEditor($('book-form'),draft));await saveBook({...b,archived:!b.archived});close('book-dialog');await refresh();});
 on('settings-open','click',openSettings);
 on('export-json','click',()=>exportLibrary('json'));on('export-csv','click',()=>exportLibrary('csv'));
 on('persist-storage','click',async()=>toast(await navigator.storage?.persist?.()?'Ο browser ενέκρινε τη διατήρηση δεδομένων.':'Ο browser δεν έδωσε εγγύηση διατήρησης. Κράτησε αντίγραφο JSON.'));
 on('cloud-form','submit',async e=>{e.preventDefault();e.submitter.disabled=true;try{
   const next={url:$('cloud-url').value.trim(),key:$('cloud-key').value.trim()};const client=new CloudClient(next);await client.signIn($('cloud-email').value.trim(),$('cloud-password').value);$('cloud-password').value='';Object.assign(config,next);localStorage.setItem('booktracker.cloud.config',JSON.stringify(next));await activateCloud(client);coverStatus();$('cloud-message').textContent='Συνδέθηκε η προσωπική σου βιβλιοθήκη. Η τοπική συλλογή μπορεί να μεταφερθεί με το αντίστοιχο κουμπί.';
  }catch(error){$('cloud-message').textContent=error.message;}finally{e.submitter.disabled=false;}
 });
 on('cloud-signout','click',async()=>{if(syncPromise)await syncPromise;try{await cloud?.signOut();}catch{}cloud=null;cloudAccount=null;localStorage.removeItem('booktracker.cloud.active');store=local;notice();coverStatus();$('cloud-message').textContent='Τοπική λειτουργία. Οι βιβλιοθήκες κάθε λογαριασμού διατηρούνται χωριστά στη συσκευή.';await refresh();});
 on('upload-local','click',async e=>{if(!cloud?.session)throw new Error('Συνδέσου πρώτα στο cloud.');e.target.disabled=true;try{let count=0;for await(const b of local.all()){if(await store.get(b.id)||await cloud.get(b.id))continue;const dupe=await findDuplicate(b);if(dupe)continue;await store.save({...b,revision:0},{queue:true,expectedRevision:0});count++;}await sync();$('cloud-message').textContent=`Μεταφέρθηκαν ${count} τοπικές εγγραφές στην ουρά συγχρονισμού. Τα αρχικά αντίγραφα παραμένουν στη συσκευή.`;await refresh();}finally{e.target.disabled=false;}});
 on('goal-form','submit',async e=>{e.preventDefault();const y=$('stats-year').value;const n=Number($('goal').value);if(!Number.isInteger(n)||n<0)throw new Error('Ο στόχος πρέπει να είναι μη αρνητικός ακέραιος.');const next={...goals(),[y]:n};if(cloud){if(!cloud.session||!navigator.onLine)throw new Error('Για αλλαγή στόχου στο cloud χρειάζεται ενεργή σύνδεση.');const confirmed=await cloud.saveGoals({[y]:n});Object.assign(next,confirmed);}localStorage.setItem(goalKey(),JSON.stringify(next));toast('Ο στόχος αποθηκεύτηκε.');await refresh();});
 on('scan-open','click',openScan);
 on('cover-start','click',()=>{if(!navigator.onLine){$('scan-message').textContent='Για αναγνώριση εξωφύλλου χρειάζεται σύνδεση στο internet.';return;}if(cloud?.session){$('camera-input').click();return;}close('scan-dialog');openSettings();requestAnimationFrame(()=>{if($('settings-dialog').open)$('cloud-email').scrollIntoView({block:'center'});});});
 on('isbn-form','submit',e=>{e.preventDefault();return lookupISBN($('isbn-input').value);});
 on('barcode-start','click',async()=>{$('reader-wrapper').classList.remove('hidden');try{await startBarcodeScanner(async value=>{if(scanBusy)return;try{normalizeISBN(value);}catch{return;}await stopBarcodeScanner($('reader-wrapper'));await lookupISBN(value);},()=>{});}catch{$('scan-message').textContent='Η κάμερα δεν είναι διαθέσιμη. Δώσε άδεια πρόσβασης ή πληκτρολόγησε το ISBN.';}});
 on('barcode-stop','click',()=>stopBarcodeScanner($('reader-wrapper')));$('scan-dialog').addEventListener('close',()=>stopBarcodeScanner($('reader-wrapper')));
 on('camera-input','change',async e=>{const file=e.target.files[0];if(!file||$('cover-start').disabled)return;$('cover-start').disabled=true;$('scan-message').textContent='Ανάγνωση εξωφύλλου…';try{if(!cloud?.session)throw new Error('Συνδέσου στον λογαριασμό σου για αναγνώριση εξωφύλλου.');if(!navigator.onLine)throw new Error('Για αναγνώριση εξωφύλλου χρειάζεται σύνδεση στο internet.');const image=await processAndCompressImage(file);const b=await cloud.recognizeCover(image);try{b.isbn=normalizeISBN(b.isbn)}catch{b.isbn='';}close('scan-dialog');openEditor(normalizeBook(b));editing=false;renderEditor();}catch(error){$('scan-message').textContent=error.status===401?'Η σύνδεση έληξε. Συνδέσου ξανά στις Ρυθμίσεις.':error.message;}finally{e.target.value='';$('cover-start').disabled=false;}});
 on('import-file','change',async e=>{const file=e.target.files[0];if(!file)return;try{importData=parseImport(await file.text(),file.name);$('import-duplicates').checked=false;$('import-message').textContent='';$('import-preview').innerHTML=`<p><strong>${importData.books.length} έγκυρες εγγραφές</strong> · ${importData.errors.length} προβληματικές γραμμές</p><ul class="preview-list">${importData.books.slice(0,50).map(b=>`<li>${esc(b.title)} — ${esc(b.author)}</li>`).join('')}</ul>${importData.errors.length?`<div class="error"><p>Οι παρακάτω γραμμές δεν θα εισαχθούν:</p><ul>${importData.errors.map(e=>`<li>Γραμμή ${e.row}: ${esc(e.message)}</li>`).join('')}</ul></div>`:''}`;$('import-dialog').showModal();}finally{e.target.value='';}});
 on('import-confirm','click',importBooks);
 on('conflict-local','click',async()=>{if(!conflict)return;const c=conflict;const current=await c.repository.get(c.entry.id);const remote=await c.client.save(current,c.remote.revision);await c.repository.ack(current.id,current.updatedAt,remote);close('conflict-dialog');conflict=null;await sync();await refresh();});
 on('conflict-remote','click',async()=>{if(!conflict)return;const c=conflict;await c.repository.discardPending(c.entry.id,c.remote);close('conflict-dialog');conflict=null;await sync();await refresh();});
 window.addEventListener('online',()=>{notice();sync().then(refresh).catch(e=>toast(e.message));});window.addEventListener('offline',()=>refresh().catch(e=>toast(e.message)));
}
async function boot(){
 try{sessionStorage.removeItem('booktracker.gemini');localStorage.removeItem('booktracker.gemini');}catch{}
 await local.init();await bind();try{const count=await local.migrateLegacy();if(count)toast(`Ανακτήθηκαν ${count} παλιές εκκρεμείς εγγραφές στη συσκευή.`);}catch(e){notice('Η παλιά ουρά διατηρήθηκε, αλλά χρειάζεται έλεγχο πριν από εισαγωγή: '+e.message);}
 if(config.url&&config.key){
  const client=new CloudClient(config);const active=readJSON('booktracker.cloud.active');
  try{if(await client.restoreSession())await activateCloud(client);else if(active.url===client.url&&active.user)await activateCloud(client,active.user);}
  catch{if(active.url===client.url&&active.user)await activateCloud(client,active.user);notice('Το cloud δεν είναι διαθέσιμο. Οι αλλαγές στην αποθηκευμένη βιβλιοθήκη κρατιούνται στη συσκευή μέχρι να συνδεθείς ξανά.');}
 }
 await refresh();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
boot().catch(error=>{notice('Η εφαρμογή δεν μπόρεσε να ανοίξει την αποθήκευση: '+error.message);console.error(error);});
