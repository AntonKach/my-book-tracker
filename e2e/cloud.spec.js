import {test,expect} from '@playwright/test';
const project='https://example.supabase.co',user='22222222-2222-4222-8222-222222222222';
async function mockCloud(page,{expire=false}={}){
 const state={books:new Map(),expire,failSave:false};
 await page.route(project+'/**',async route=>{
  const url=route.request().url();let body={};try{body=route.request().postDataJSON()||{}}catch{}
  let data={},status=200;
  if(url.includes('grant_type=password'))data={access_token:'test',refresh_token:'refresh',expires_in:state.expire?1:3600,user:{id:user,email:'test@example.com'}};
  else if(url.includes('grant_type=refresh_token')){status=400;data={message:'Refresh expired'};}
  else if(url.includes('/library_books?'))data=[...state.books.values()].filter(b=>url.includes(b.id)).map(document=>({document,revision:document.revision}));
  else if(url.includes('library_search')){const items=[...state.books.values()].filter(b=>!body.p_query||b.title.includes(body.p_query)||b.isbn===body.p_query);data={items,total:items.length};}
  else if(url.includes('library_save_goals'))data={ok:true,goals:body.p_goals};
  else if(url.includes('library_save')){if(state.failSave){status=503;data={message:'Unavailable'};}else{const b={...body.p_book,revision:(state.books.get(body.p_book.id)?.revision||0)+1};state.books.set(b.id,b);data={ok:true,book:b};}}
  await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });return state;
}
async function signIn(page){
 await page.getByRole('button',{name:'Ρυθμίσεις',exact:true}).click();await page.locator('#cloud-url').fill(project);await page.locator('#cloud-key').fill('sb_publishable_test');await page.locator('#cloud-email').fill('test@example.com');await page.locator('#cloud-password').fill('password');await page.getByRole('button',{name:'Σύνδεση',exact:true}).click();await expect(page.locator('#cloud-message')).toContainText('Συνδέθηκε');await page.getByRole('button',{name:'Κλείσιμο ρυθμίσεων'}).click();
}
async function add(page,title){await page.getByRole('button',{name:'Νέο βιβλίο',exact:true}).click();await page.getByLabel('Τίτλος',{exact:true}).fill(title);await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();await expect(page.locator('#book-dialog')).not.toBeVisible();}
test('cloud-bound edits remain queued after refresh credentials expire',async({page})=>{
 const state=await mockCloud(page,{expire:true});await page.goto('/');await signIn(page);await add(page,'Κρατημένη αλλαγή');
 const pending=await page.evaluate(async({project,user})=>{const {LocalRepository}=await import('/js/library-store.js');return (await new LocalRepository(`cloud:${project}:${user}`).pending()).map(p=>p.book.title)},{project,user});
 expect(pending).toEqual(['Κρατημένη αλλαγή']);state.expire=false;await signIn(page);await expect.poll(()=>state.books.size).toBe(1);expect([...state.books.values()][0].title).toBe('Κρατημένη αλλαγή');
});
test('cloud CSV import checks duplicates against the unsent import batch',async({page})=>{
 const state=await mockCloud(page);await page.goto('/');await signIn(page);await page.getByRole('button',{name:'Ρυθμίσεις',exact:true}).click();await page.locator('#import-file').setInputFiles({name:'books.csv',mimeType:'text/csv',buffer:Buffer.from('Τίτλος,Συγγραφέας\nΈνα βιβλίο,Α\nΈνα βιβλίο,Α')});await page.getByRole('button',{name:'Εισαγωγή έγκυρων εγγραφών'}).click();await expect(page.locator('#import-message')).toContainText('Εισήχθησαν 1. Παραλείφθηκαν 1');await expect.poll(()=>state.books.size).toBe(1);
});
test('retrying local transfer preserves newer queued cloud edits',async({page})=>{
 const state=await mockCloud(page);await page.goto('/');await add(page,'Αρχικό');await signIn(page);state.failSave=true;
 await page.getByRole('button',{name:'Ρυθμίσεις',exact:true}).click();await page.getByRole('button',{name:'Μεταφορά τοπικής συλλογής στο cloud'}).click();await expect(page.locator('#cloud-message')).toContainText('Μεταφέρθηκαν 1');await page.getByRole('button',{name:'Κλείσιμο ρυθμίσεων'}).click();
 await page.locator('[data-pending]').click();await page.getByLabel('Τίτλος',{exact:true}).fill('Νεότερο');await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();await expect(page.locator('#book-dialog')).not.toBeVisible();
 await page.getByRole('button',{name:'Ρυθμίσεις',exact:true}).click();await page.getByRole('button',{name:'Μεταφορά τοπικής συλλογής στο cloud'}).click();await expect(page.locator('#cloud-message')).toContainText('Μεταφέρθηκαν 0');
 const pending=await page.evaluate(async({project,user})=>{const {LocalRepository}=await import('/js/library-store.js');return (await new LocalRepository(`cloud:${project}:${user}`).pending()).map(p=>p.book.title)},{project,user});expect(pending).toEqual(['Νεότερο']);
});
