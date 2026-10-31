import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

test('a deployed script replaces a fresh HTTP cache entry and remains available offline',async({page,context})=>{
 const worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');
 let version='first';
 const server=createServer((req,res)=>{
  res.setHeader('Cache-Control',req.url==='/app.js'?'public, max-age=3600':'no-store');
  if(req.url==='/sw.js'){res.setHeader('Content-Type','text/javascript');res.end(worker);}
  else if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(`document.querySelector('#version').textContent=${JSON.stringify(version)};`);}
  else if(req.url==='/'||req.url==='/index.html'){res.setHeader('Content-Type','text/html');res.end('<p id="version"></p><script src="app.js"></script><script>navigator.serviceWorker.register("sw.js")</script>');}
  else res.end('');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('#version')).toHaveText('first');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  version='second';
  await page.reload();
  await expect(page.locator('#version')).toHaveText('second');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#version')).toHaveText('second');
 }finally{
  await context.setOffline(false);
  await new Promise(resolve=>server.close(resolve));
 }
});
