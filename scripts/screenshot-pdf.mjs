#!/usr/bin/env node
/**
 * Turn the captured screenshots into one PDF, two themes per page.
 *
 * WHY A SCRIPT AND NOT "print the contact sheet"
 *
 * Chrome's `--print-to-pdf` prints the SCREEN stylesheet unless the page carries
 * its own `@media print` rules, and the contact sheet is laid out for scrolling
 * on a monitor: full-height images, a lead paragraph, a warning box. Printed
 * as-is it spills across pages and crops. So this generates a second HTML built
 * for paper — A4 landscape, two phone screens per page, page breaks between
 * routes — and converts that.
 *
 * WHY TWO PER PAGE
 *
 * A phone screen at 412 × 915 is a tall, narrow thing. One per A4 portrait page
 * wastes most of the sheet; two side by side on A4 landscape fills it and puts
 * light and dark next to each other, which is the comparison worth making.
 *
 * Usage:
 *   node scripts/screenshot-pdf.mjs
 * Produces:
 *   apps/mobile/screenshots/kunigal-bazaar-screens.pdf
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REPO = resolve(import.meta.dirname, '..');
const OUT = resolve(REPO, 'apps', 'mobile', 'screenshots');
const PRINT_HTML = join(OUT, 'print.html');
const PDF = join(OUT, 'kunigal-bazaar-screens.pdf');
const PORT = 8179;

// Kannada only. English captures were attempted and abandoned: the app cannot
// persist a language on web (the store is a memory shim), so it means TAPPING
// the toggle per capture — and React Native Web's Pressable needs a real CDP
// mouse press, `Page.reload` keeps the previous document live until the load
// event fires, and one shared CDP connection is not enough to isolate the
// per-route state. It is a real tooling gap, recorded in CHANGELOG 2026-11-12;
// the device run is the honest way to see the English app.
const LANG = 'kn';
const DISTINCT = ['home', 'login', 'cart', 'orders', 'account', 'addresses', 'address', 'checkout', 'privacy'];
const DUPLICATE = ['admin-dashboard', 'admin-today', 'admin-shelf', 'admin-coupons', 'admin-team', 'admin-photos', 'rider'];
const LABELS = {
  home: 'Home — the shelf, search, categories, deals',
  login: 'Sign in — phone number',
  cart: 'Cart — empty state',
  orders: 'Orders',
  account: 'Account',
  addresses: 'Addresses',
  address: 'Address + door pin',
  checkout: 'Checkout',
  privacy: 'Privacy notice',
  'admin-dashboard': 'Admin · dashboard',
  'admin-today': 'Admin · Today (takings)',
  'admin-shelf': 'Admin · Shelf',
  'admin-coupons': 'Admin · Coupons',
  'admin-team': 'Admin · Team',
  'admin-photos': 'Admin · Photos',
  rider: 'Rider · pool',
};

// ---- build the print layout ------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

let pages = '';
let count = 0;

// One page per route: light and dark side by side. A phone screen is tall and
// narrow, so two across an A4 landscape sheet is the readable maximum.
for (const name of DISTINCT.concat(DUPLICATE)) {
  const dir = join(OUT, name);
  if (!existsSync(join(dir, `${LANG}-light.png`))) continue;
  count++;
  const dup = DUPLICATE.includes(name);
  pages += `
<div class="page${dup ? ' dup' : ''}">
  <div class="head">
    <span class="route">${esc(name)}</span>
    <span class="label">${esc(LABELS[name] ?? name)}</span>
    ${dup ? '<span class="tag">role-gated → customer home</span>' : ''}
  </div>
  <div class="shots">
    <figure><img src="${name}/${LANG}-light.png"><figcaption>light</figcaption></figure>
    <figure><img src="${name}/${LANG}-dark.png"><figcaption>dark</figcaption></figure>
  </div>
</div>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kunigal Bazaar — screens</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 11px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1f1f1f;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 5mm; }
  .route { font-size: 15px; font-weight: 700; }
  .label { font-size: 12px; color: #555; flex: 1; }
  .tag {
    font-size: 10px; background: #fdecea; color: #a33;
    border: 1px solid #f0c6c0; border-radius: 20px; padding: 2px 8px;
  }
  .shots { display: flex; gap: 8mm; justify-content: center; }
  figure { margin: 0; text-align: center; }
  img { height: 165mm; width: auto; border: 1px solid #d8d3c8; border-radius: 6px; }
  figcaption { font-size: 10px; color: #777; margin-top: 2mm; }
  .dup img { opacity: .4; }

  /* Cover */
  .cover { padding: 30mm 6mm; }
  .cover h1 { font-size: 30px; margin: 0 0 4mm; letter-spacing: -.4px; }
  .cover .sub { font-size: 14px; color: #555; margin: 0 0 14mm; }
  .cover .box {
    border: 1px solid #ddd6c6; background: #faf7ef; border-radius: 8px;
    padding: 6mm 7mm; margin: 0 0 6mm; font-size: 12px; line-height: 1.6;
  }
  .cover .box b { display: block; margin-bottom: 2mm; font-size: 13px; }
  .cover table { border-collapse: collapse; font-size: 11px; margin-top: 4mm; }
  .cover td, .cover th { border-bottom: 1px solid #e3ddd0; padding: 2mm 6mm 2mm 0; text-align: left; }
  .cover th { color: #777; font-weight: 600; }
</style></head><body>

<div class="page cover">
  <h1>Kunigal Bazaar — every screen</h1>
  <p class="sub">Phone size (412 × 915, mobile emulation), light and dark, captured
  from the static web export in real Chrome. ${count} routes.</p>

  <div class="box">
    <b>What this is, honestly</b>
    These are the <b>signed-out</b> screens. A session cannot be injected into the
    web build (it keeps its session in a memory shim, so nothing survives a page
    load), so cart, orders, checkout and account show their empty states — and every
    role-gated route, all seven admin screens and the rider pool, collapses to the
    customer home screen, because a visitor with no <code>profiles.role</code> is
    routed to the customer face. Those pages are greyed and tagged.
  </div>

  <div class="box">
    <b>Not a device</b>
    No phone or emulator has ever run this app. These are React Native Web
    renderings: correct for layout, colour, type and copy, not for gesture,
    scroll physics, or anything native (the map, GPS, the camera). The EAS
    development build is the next step and it is not built yet.
  </div>

  <table>
    <tr><th>Route</th><th>What it shows</th></tr>
    ${DISTINCT.concat(DUPLICATE).map((n) =>
      `<tr><td><code>${esc(n)}</code></td><td>${esc(LABELS[n] ?? n)}${
        DUPLICATE.includes(n) ? ' <i>(customer home)</i>' : ''
      }</td></tr>`).join('')}
  </table>
</div>

${pages}
</body></html>`;

await writeFile(PRINT_HTML, html);
console.log(`print layout: ${PRINT_HTML}`);

// ---- serve it, because --print-to-pdf needs a URL --------------------------

const MIME = { '.html': 'text/html', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = join(OUT, rel === '' ? 'print.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise((d) => server.listen(PORT, '127.0.0.1', d));
console.log(`serving on http://127.0.0.1:${PORT}/`);

// ---- print to PDF ----------------------------------------------------------

await new Promise((done, fail) => {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--virtual-time-budget=20000',
    `--print-to-pdf=${PDF}`,
    `http://127.0.0.1:${PORT}/`,
  ], { stdio: 'ignore' });
  chrome.on('exit', (code) => (code === 0 ? done() : fail(new Error('chrome exit ' + code))));
});

server.close();
const size = (await stat(PDF)).size;
console.log(`\nPDF: ${PDF}`);
console.log(`     ${count} routes x 2 themes + cover = ${count + 1} pages`);
console.log(`     ${(size / 1024 / 1024).toFixed(2)} MB`);
