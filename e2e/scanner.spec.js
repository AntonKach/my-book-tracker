import {test,expect} from '@playwright/test';
// WebKit routes do not intercept requests forwarded through a service worker.
// Offline and update behavior are exercised separately in library/updates specs.
test.use({serviceWorkers:'block'});

test('mobile scanner keeps readable inputs and every action inside the dialog',async({page})=>{
 for(const width of [320,390,428]){
  await page.setViewportSize({width,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();
  await page.getByLabel('ISBN',{exact:true}).focus();
  const fieldSize=await page.getByLabel('ISBN',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  // Sub-16px inputs trigger automatic focus zoom on iOS, clipping the modal.
  expect(fieldSize).toBeGreaterThanOrEqual(16);
  const bounds=await page.locator('#scan-dialog').evaluate(dialog=>{
   const r=dialog.getBoundingClientRect();
   return {left:r.left,right:r.right,overflow:dialog.scrollWidth-dialog.clientWidth,
    actions:[...dialog.querySelectorAll('button,input:not([type=file])')].filter(el=>el.offsetParent).map(el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right};})};
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(width);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
  for(const action of bounds.actions){expect(action.left).toBeGreaterThanOrEqual(bounds.left);expect(action.right).toBeLessThanOrEqual(bounds.right);}
  await page.getByRole('button',{name:'Κλείσιμο σάρωσης',exact:true}).click();
  await expect(page.locator('#scan-dialog')).not.toBeVisible();
 }
});

test('signed-out cover scan opens login without asking for an API key',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();
 let picked=false;page.on('filechooser',()=>{picked=true;});
 await page.getByRole('button',{name:'Σύνδεση για φωτογραφία',exact:true}).click();
 await expect(page.locator('#settings-dialog')).toBeVisible();
 await expect(page.getByLabel('Email',{exact:true})).toBeInViewport();
 await expect(page.locator('#gemini-key')).toHaveCount(0);expect(picked).toBe(false);
});

async function mockCoverCloud(page){
 const seen=[];
 await page.route('https://example.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const data=path.includes('recognize-cover')?{title:'Δοκιμή εξωφύλλου',author:'Δοκιμή',summary:''}:path.includes('library_search')?{items:[],total:0}:{};
  if(path.includes('recognize-cover'))seen.push(route.request());
  await route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:data});
 });return seen;
}
test('saved login recognizes covers after a mobile restart with no Gemini key',async({page,browser,context})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  localStorage.setItem('booktracker.cloud.config',JSON.stringify({url:'https://example.supabase.co',key:'sb_publishable_test'}));
  localStorage.setItem('booktracker.supabase.session:example.supabase.co',JSON.stringify({access_token:'user-token',refresh_token:'refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner',email:'test@example.com'}}));
  sessionStorage.setItem('booktracker.gemini','old-session-key');
 });
 await mockCoverCloud(page);await page.goto('/');await expect(page.locator('#connection-status')).toContainText('Cloud');
 expect(await page.evaluate(()=>sessionStorage.getItem('booktracker.gemini'))).toBeNull();
 const restarted=await browser.newContext({storageState:await context.storageState(),viewport:{width:390,height:844},serviceWorkers:'block'});
 try{
  const next=await restarted.newPage(),seen=await mockCoverCloud(next);let direct=false;
  await next.route('https://generativelanguage.googleapis.com/**',route=>{direct=true;return route.abort();});
  await next.goto('http://127.0.0.1:8080/');await expect(next.locator('#connection-status')).toContainText('Cloud');
  await next.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();
  await expect(next.locator('#cover-help')).toContainText('χωρίς κλειδί');
  const picker=next.waitForEvent('filechooser');await next.getByRole('button',{name:'Φωτογραφία εξωφύλλου',exact:true}).click();
  await (await picker).setFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')});
  await expect(next.getByLabel('Τίτλος',{exact:true})).toHaveValue('Δοκιμή εξωφύλλου');
  expect(seen.length).toBe(1);expect(seen[0].headers().authorization).toBe('Bearer user-token');
  expect(Object.keys(seen[0].postDataJSON())).toEqual(['image']);expect(direct).toBe(false);
  await next.getByRole('button',{name:'Ακύρωση',exact:true}).click();
  await next.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();await restarted.setOffline(true);
  let picked=false;next.on('filechooser',()=>{picked=true;});await next.getByRole('button',{name:'Φωτογραφία εξωφύλλου',exact:true}).click();
  await expect(next.locator('#scan-message')).toContainText('internet');expect(picked).toBe(false);
 }finally{await restarted.close();}
});

test('ISBN lookup opens a book for review without a Gemini key',async({page})=>{
 await page.route('https://www.googleapis.com/books/v1/volumes?*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{items:[{volumeInfo:{title:'ISBN χωρίς AI',authors:['Δοκιμή'],industryIdentifiers:[{identifier:'9780306406157'}]}}]}}));
 await page.route('https://openlibrary.org/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{}}));
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();
 await page.getByLabel('ISBN',{exact:true}).fill('9780306406157');
 await page.getByRole('button',{name:'Αναζήτηση ISBN',exact:true}).click();
 await expect(page.getByLabel('Τίτλος',{exact:true})).toHaveValue('ISBN χωρίς AI');
 await expect(page.locator('#scan-dialog')).not.toBeVisible();
 await expect(page.locator('.book-card')).toHaveCount(0);
});
