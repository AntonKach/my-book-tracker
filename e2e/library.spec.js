import {test,expect} from '@playwright/test';
test('library, ownership, reading history, search and backup survive reload',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:'Νέο βιβλίο',exact:true}).click();
 await page.getByLabel('Τίτλος', {exact:true}).fill('Η τέχνη της μουσικής');
 await page.getByLabel('Συγγραφέας', {exact:true}).fill('Δοκιμή');
 await page.getByLabel('Σύνολο σελίδων').fill('240');
 await page.getByLabel('Κατηγορία', {exact:true}).selectOption('Μουσική');
 await page.getByLabel('Θέση / ράφι').fill('Γραφείο · 2');
 await page.getByRole('button',{name:'Νέα ανάγνωση',exact:true}).click();
 await page.getByLabel('Κατάσταση ανάγνωσης').selectOption('reading');
 await page.getByLabel('Τρέχουσα σελίδα').fill('85');
 await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();
 await expect(page.locator('.book-card')).toHaveCount(1);await page.reload();
 await expect(page.locator('.book-card')).toContainText('Η τέχνη της μουσικής');
 await page.getByLabel('Αναζήτηση βιβλίων').fill('ΤΕΧΝΗ ΜΟΥΣΙΚΗΣ');
 await expect(page.locator('.book-card')).toHaveCount(1);
 await page.locator('.book-card').click();await expect(page.getByLabel('Τρέχουσα σελίδα')).toHaveValue('85');
 await page.getByLabel('Κατάσταση ανάγνωσης').selectOption('finished');
 await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();
 await page.getByRole('button',{name:'Στατιστικά',exact:true}).click();
 await expect(page.locator('#stats-content')).toContainText('Ολοκληρωμένες αναγνώσεις');
 await page.getByRole('button',{name:'Ρυθμίσεις',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Πλήρες αντίγραφο JSON',exact:true}).click();
 expect((await download).suggestedFilename()).toMatch(/booktracker.*json/);expect(errors).toEqual([]);
});
test('mobile fits viewport and accepts manual books with no API key',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'Νέο βιβλίο',exact:true}).click();await page.getByLabel('Τίτλος',{exact:true}).fill('Χωρίς κλειδί');
 await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();await expect(page.locator('.book-card')).toHaveCount(1);
});
test('full offline reload retains book and permits editing',async({page,context})=>{
 await page.goto('/');await page.getByRole('button',{name:'Νέο βιβλίο',exact:true}).click();await page.getByLabel('Τίτλος',{exact:true}).fill('Εκτός σύνδεσης');await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();await expect(page.locator('.book-card')).toHaveCount(1);
 await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
 await context.setOffline(true);await page.reload();await expect(page.locator('.book-card')).toContainText('Εκτός σύνδεσης');await page.locator('.book-card').click();await page.getByLabel('Τίτλος',{exact:true}).fill('Αποθηκεύτηκε offline');await page.getByRole('button',{name:'Αποθήκευση βιβλίου',exact:true}).click();await expect(page.locator('.book-card')).toContainText('Αποθηκεύτηκε offline');
});
