// Generate a standalone Playwright initialization function for the built local UI.
// Run: node tests/support/browser-prepare.js /tmp/kupala-browser-init.js
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const output = process.argv[2];
if (!output) throw new Error('Expected output filename');
const assets = {};
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else assets['/' + relative('dist', path)] = (await readFile(path)).toString('base64');
  }
}
await walk('dist');
const code = `async (page) => {
  await page.unrouteAll({behavior:'ignoreErrors'});
  page.__qaPending = [];
  page.__qaErrors = [];
  page.__qaFailures = [];
  page.on('pageerror', e => page.__qaErrors.push(String(e)));
  const files = ${JSON.stringify(assets)};
  await page.route('http://kupala-app.test/**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) return new Promise(resolve => {
      const id = String(Date.now()) + '-' + Math.random();
      page.__qaPending.push({id, route, resolve, request:{method:req.method(),url:url.pathname+url.search,headers:req.headers(),payload:req.postData()||undefined}});
    });
    const key = url.pathname==='/' ? '/index.html' : url.pathname;
    const asset = files[key];
    const types = {'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml'};
    const ext = key.slice(key.lastIndexOf('.'));
    return route.fulfill({status:asset?200:404,body:asset?Buffer.from(asset,'base64'):'Not found',contentType:types[ext]||'text/html; charset=utf-8'});
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://kupala-app.test/',{waitUntil:'domcontentloaded'});
  return {title:await page.title(),pending:page.__qaPending.length};
}`;
await writeFile(output, code, { mode: 0o600 });
console.log('Browser initialization prepared from dist.');
