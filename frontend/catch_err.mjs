import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:5190/e-applications?type=special&special=hot_work', { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => errors.push('NAV: ' + e.message));
await new Promise(r => setTimeout(r, 4000));
const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 900) : 'NO BODY');
console.log('=== BODY ===');
console.log(body);
console.log('=== ERRORS ===');
console.log(errors.slice(0, 15).join('\n') || 'none');
await browser.close();
