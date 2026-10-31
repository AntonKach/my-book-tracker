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

test('cover setup opens settings before requesting a photo when no Gemini key exists',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();
 let picked=false;page.on('filechooser',()=>{picked=true;});
 await page.getByRole('button',{name:'Ρύθμιση φωτογραφίας',exact:true}).click();
 await expect(page.locator('#settings-dialog')).toBeVisible();
 await expect(page.getByLabel('Προσωπικό Gemini API key')).toBeInViewport();
 expect(picked).toBe(false);
 await page.getByLabel('Προσωπικό Gemini API key').fill('test-session-key');
 await page.getByRole('button',{name:'Αποθήκευση για τη συνεδρία',exact:true}).click();
 await page.getByRole('button',{name:'Κλείσιμο ρυθμίσεων',exact:true}).click();
 await page.getByRole('button',{name:'Σάρωση / ISBN',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Φωτογραφία εξωφύλλου',exact:true}).click();await chooser;
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
