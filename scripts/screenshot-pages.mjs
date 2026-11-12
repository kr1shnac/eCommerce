#!/usr/bin/env node
/**
 * Screenshot every page of the app, at phone size, in light and dark.
 *
 * WHY THIS EXISTS
 *
 * No device has ever run this app (register C4), and Expo Go is a dead end on
 * SDK 57 â€” see CHANGELOG 2026-11-11. Until a development build exists, the
 * **web export** is the only way to look at the UI, and `--screenshot` alone
 * cannot do it properly: it cannot emulate a phone viewport, and it cannot set
 * `prefers-color-scheme`, so it would produce desktop-width light-mode pictures
 * of an app that ships both themes.
 *
 * This drives real Chrome over the DevTools Protocol, so it can do all three:
 * phone metrics, mobile emulation, and both colour schemes. Node 22+ has a
 * global WebSocket, so there is no dependency to add.
 *
 * WHAT IT PRODUCES
 *
 *   apps/mobile/screenshots/<route>/light.png
 *   apps/mobile/screenshots/<route>/dark.png
 *
 * WHAT IT CANNOT SEE â€” stated plainly
 *
 *   Only the SIGNED-OUT app. The web build stores its session in a memory shim
 *   (see src/lib/storage.ts: `typeof window` means there is no device store), so
 *   a session cannot be injected into a fresh page. Cart, orders, checkout,
 *   the order screen and every admin/rider face redirect to login. That is a
 *   limitation of the capture, not of the app.
 *
 * Usage:
 *   npm run export:web                       # build the static export first
 *   node scripts/screenshot-pages.mjs        # then this
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DIST = resolve(import.meta.dirname, '..', 'apps', 'mobile', 'dist');
const OUT = resolve(import.meta.dirname, '..', 'apps', 'mobile', 'screenshots');
const PORT = 8177;
const CDP = 9222;

const PHONE = { width: 412, height: 915, deviceScaleFactor: 2, mobile: true };

// Every route the export built, with the label the folder should use.
const ROUTES = [
  ['/', 'home'],
  ['/login', 'login'],
  ['/cart', 'cart'],
  ['/orders', 'orders'],
  ['/account', 'account'],
  ['/addresses', 'addresses'],
  ['/address', 'address'],
  ['/checkout', 'checkout'],
  ['/privacy', 'privacy'],
  ['/admin', 'admin-dashboard'],
  ['/admin/today', 'admin-today'],
  ['/admin/shelf', 'admin-shelf'],
  ['/admin/coupons', 'admin-coupons'],
  ['/admin/team', 'admin-team'],
  ['/admin/photos', 'admin-photos'],
  ['/rider', 'rider'],
];

// Kannada is the app's default (`DEFAULT_LANGUAGE` in src/i18n/index.ts) and the
// web build cannot persist a choice â€” `src/lib/storage.ts` falls back to a memory
// shim whenever `window` exists, so every fresh page load is back in Kannada.
// Getting English therefore means TAPPING the toggle, which is only possible on
// routes that have one. The header toggle's `accessibilityLabel` becomes
// `aria-label` under React Native Web, and in Kannada mode it reads
// "à²†à²ªà³ à²­à²¾à²·à³†: English" â€” a stable hook that does not depend on layout.
const LANGS = ['kn', 'en'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

// ---- a static server that understands Expo's clean URLs -------------------

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = [
    join(DIST, clean),
    join(DIST, clean + '.html'),
    join(DIST, clean, 'index.html'),
  ];
  for (const c of candidates) {
    try {
      const s = await stat(c);
      if (s.isFile()) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const file = await resolveFile(req.url || '/');
      if (!file) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((done) => server.listen(PORT, '127.0.0.1', () => done(server)));
}

// ---- Chrome over CDP -------------------------------------------------------

async function cdpJson(path) {
  const res = await fetch(`http://127.0.0.1:${CDP}${path}`);
  return res.json();
}

async function main() {
  if (!existsSync(DIST)) {
    console.error(`No export at ${DIST}. Run \`npm run export:web\` first.`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const server = await startServer();
  console.log(`serving ${DIST} on http://127.0.0.1:${PORT}`);

  const { spawn } = await import('node:child_process');
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    `--remote-debugging-port=${CDP}`,
    'about:blank',
  ], { stdio: 'ignore' });

  // Wait for the debugger.
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) {
    try {
      const list = await cdpJson('/json/list');
      targets = list.find((t) => t.type === 'page');
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!targets) {
    console.error('Chrome did not expose a CDP page target.');
    chrome.kill();
    server.close();
    process.exit(1);
  }

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.addEventListener('open', done);
    ws.addEventListener('error', () => fail(new Error('ws failed')));
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { done, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message));
      else done(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++seq;
      pending.set(id, { done, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const page = await cdpJson('/json/list').then((l) => l.find((t) => t.type === 'page'));
  await send('Page.enable');
  await send('Runtime.enable');

  /**
   * Poll until the app has painted something, so the language-control probe
   * never runs against an empty document. Two conditions, because either alone
   * is not proof: there is real text, AND there is at least one labelled
   * control (this app is a tree of them). Times out at 20s and carries on â€” a
   * slow route should not hang the whole run.
   */
  const waitForRender = async (send) => {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await send('Runtime.evaluate', {
          expression: `JSON.stringify({
            text: (document.body.innerText || '').trim().length,
            controls: document.querySelectorAll('[aria-label]').length
          })`,
          returnByValue: true,
        });
        const s = JSON.parse(r.result.value);
        if (s.text > 60 && s.controls >= 2) return true;
      } catch {
        /* not ready */
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    return false;
  };

  /**
   * Open a brand-new tab. This is the ONLY reliable way to reset the app's
   * state, and it took three attempts to learn why.
   *
   * `language-store.ts` keeps the current language in a MODULE-LEVEL variable.
   * So the language survives anything that is not a fresh JavaScript context,
   * and in a client-routed app that includes:
   *
   *   * `Page.navigate` to a different query string â€” expo-router intercepts it,
   *     no reload happens, so a cache-busting `?_cb=` changed nothing;
   *   * `Page.navigate` to `about:blank` and back â€” CDP resolves `navigate` when
   *     the navigation is *initiated*, not committed, so two back-to-back
   *     navigations collapse into one.
   *
   * A new tab is a new renderer process context: guaranteed clean. 16 tabs for
   * 16 routes, each reused for light and dark via `Page.reload`.
   */
  const openTab = async (url) => {
    // Chrome deprecated GET on /json/new; it must be a PUT now.
    const created = await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    }).then((r) => r.json());
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      ws.addEventListener('open', done);
      ws.addEventListener('error', () => fail(new Error('tab ws failed')));
    });
    let seq = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.fail(new Error(msg.error.message));
        else p.done(msg.result);
        return;
      }
      // Anything without an id is an event; hand it to the one-shot waiters.
      // Each waiter is REMOVED as it fires, or the second scheme's reload would
      // be answered by the first scheme's listener and hang forever.
      for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i].method === msg.method) {
          const l = listeners.splice(i, 1)[0];
          l.fn(msg.params);
          return;
        }
      }
    });
    const call = (method, params = {}) =>
      new Promise((done, fail) => {
        const id = ++seq;
        pending.set(id, { done, fail });
        ws.send(JSON.stringify({ id, method, params }));
      });
    /**
     * Resolve when the document has actually finished loading.
     *
     * `call('Page.reload')` returns when the reload is INITIATED, and the old
     * document is still live and visible until the new one commits. Probing in
     * that window reads the previous state — which is how a route that plainly
     * has a language control ended up reported as having none.
     */
    const onceLoaded = () =>
      new Promise((done) => listeners.push({ method: 'Page.loadEventFired', fn: () => done() }));
    await call('Page.enable');
    await call('Runtime.enable');
    return { call, onceLoaded, close: () => ws.close() };
  };

  let shot = 0;
  const noToggle = [];
  for (const [route, label] of ROUTES) {
    const dir = join(OUT, label);
    await mkdir(dir, { recursive: true });

    // One fresh tab per route: a new renderer context, so the app starts in
    // Kannada every time regardless of what the previous route left behind.
    const tab = await openTab(`http://127.0.0.1:${PORT}${route}`);
    const call = tab.call;

    for (const scheme of ['light', 'dark']) {
      // `Page.reload` IS a real document reload (unlike navigate within an SPA),
      // so it is the right tool for switching theme without losing isolation.
      await call('Emulation.setDeviceMetricsOverride', {
        width: PHONE.width,
        height: PHONE.height,
        deviceScaleFactor: PHONE.deviceScaleFactor,
        mobile: PHONE.mobile,
      });
      await call('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      });
      // Arm the waiter BEFORE issuing the reload, then wait for the real load
      // event. Without this the probe runs against the previous document.
      const loaded = tab.onceLoaded();
      await call('Page.reload', { ignoreCache: true });
      await loaded;
      await waitForRender(call);

      for (const lang of LANGS) {
        const file = join(dir, `${lang}-${scheme}.png`);

        // Which language is on screen right now, read from the control itself
        // rather than assumed.
        //
        // Two shapes, both ASCII-detectable:
        //   header toggle : aria-label = "<lang label>: English" while in
        //                   Kannada, and "App language: <kannada>" once in
        //                   English. So the word "English" appearing in the
        //                   label means "you are in Kannada; tapping goes to
        //                   English".
        //   account screen: a segmented control whose two radios are labelled
        //                   plainly "English" and the Kannada word. "English"
        //                   is present in both modes there, so tapping it when
        //                   English is already active is a harmless no-op.
        const state = await call('Runtime.evaluate', {
          expression: `(() => {
            const el = [...document.querySelectorAll('[aria-label]')]
              .find(e => (e.getAttribute('role') === 'button'
                       || e.getAttribute('role') === 'radio')
                       && /English/.test(e.getAttribute('aria-label') || ''));
            if (!el) return JSON.stringify({ control: false });
            return JSON.stringify({
              control: true,
              inEnglish: /App language/.test(el.getAttribute('aria-label') || ''),
              label: el.getAttribute('aria-label') || '',
            });
          })()`,
          returnByValue: true,
        });
        const current = JSON.parse(state.result.value);

        if (!current.control) {
          if (!noToggle.includes(label)) noToggle.push(label);
          if (lang === 'kn') {
            const { data } = await call('Page.captureScreenshot', { format: 'png' });
            await writeFile(file, Buffer.from(data, 'base64'));
            shot++;
            console.log(`  ${label}/kn-${scheme}.png   (no language control: Kannada only)`);
          }
          continue;
        }

        if (lang === 'en' && !current.inEnglish) {
          // A raw `element.click()` does NOT switch a React Native Web
          // Pressable: its onPress is driven by the responder system
          // (pointerdown -> pointerup), which a synthetic click never reaches.
          // The first attempt produced Kannada pictures filed as English. So:
          // read the control's box and send a real mouse press through CDP.
          const box = await call('Runtime.evaluate', {
            expression: `(() => {
              const el = [...document.querySelectorAll('[aria-label]')]
                .find(e => (e.getAttribute('role') === 'button'
                         || e.getAttribute('role') === 'radio')
                         && /English/.test(e.getAttribute('aria-label') || ''));
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            })()`,
            returnByValue: true,
          });

          if (box.result.value) {
            const { x, y } = box.result.value;
            await call('Input.dispatchMouseEvent', {
              type: 'mousePressed', x, y, button: 'left', clickCount: 1,
            });
            await call('Input.dispatchMouseEvent', {
              type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
            });
            // i18next is synchronous with bundled resources, but the whole tree
            // re-renders; give it a beat before the shutter.
            await new Promise((r) => setTimeout(r, 1400));
          }
        }

        const { data } = await call('Page.captureScreenshot', { format: 'png' });
        await writeFile(file, Buffer.from(data, 'base64'));
        shot++;
        console.log(`  ${label}/${lang}-${scheme}.png`);
      }
    }

    tab.close();
  }

  ws.close();
  chrome.kill();
  server.close();
  console.log(`\n${shot} screenshots in ${OUT}`);
  if (noToggle.length) {
    console.log(`\nNo language toggle on: ${noToggle.join(', ')}`);
    console.log('Those routes are captured in Kannada only (the app default).');
  }
  console.log('\nNote: these are the SIGNED-OUT screens. Cart, orders, checkout,');
  console.log('the order screen and the admin/rider faces need a session, and the');
  console.log('web build cannot hold one between page loads.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});