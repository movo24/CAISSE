/**
 * Real packaged-context connectivity check (NOT a Node/CI-only test).
 *
 * Boots Electron, serves a page from the SAME `app://app` origin the packaged
 * register uses, and — from that renderer — does the two real requests the login
 * screen makes against Backend B: `GET /api/health` and
 * `POST /api/auth/login/pin { WESLEY01, 5678 }`. This reproduces the exact
 * Chromium CORS behaviour of the installed .exe (a plain Node request would not).
 *
 * Prints `CONNECTIVITY_RESULT <json>` and exits 0 only if health=200 AND
 * login=200 AND a token came back. Run twice in CI:
 *   POS_CORS_SHIM=off  → reproduces the v1.0.2 failure (CORS-blocked, login≠200)
 *   POS_CORS_SHIM=on   → proves the fix (login=200, token=true)
 *
 * Usage: xvfb-run -a electron dist/main/connectivity-check.js
 */
import { app, protocol, BrowserWindow, session } from 'electron';

const API = process.env.POS_API_URL || 'https://caisse-backend-production.up.railway.app';
const STORE = process.env.STORE_CODE || 'WESLEY01';
const PIN = process.env.CASHIER_PIN || '5678';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Same shim as production main (kept in sync intentionally). Skipped when
// POS_CORS_SHIM=off so the check can demonstrate the CORS cause.
function installShim(): void {
  if (process.env.POS_CORS_SHIM === 'off') return;
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (details, cb) => {
    const headers = { ...(details.responseHeaders || {}) };
    for (const k of Object.keys(headers)) {
      if (/^access-control-allow-(origin|methods|headers|credentials)$/i.test(k)) delete headers[k];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET,POST,PUT,PATCH,DELETE,OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: headers });
  });
}

app.whenReady().then(async () => {
  installShim();
  protocol.handle('app', () =>
    new Response('<!doctype html><meta charset="utf-8"><title>probe</title>', {
      headers: { 'content-type': 'text/html' },
    }),
  );

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await win.loadURL('app://app/');

  const script = `(async () => {
    const out = { origin: location.origin, api: ${JSON.stringify(API)}, shim: ${JSON.stringify(process.env.POS_CORS_SHIM || 'on')} };
    try { const h = await fetch(out.api + '/api/health'); out.health = h.status; }
    catch (e) { out.healthErr = String(e && e.message || e); }
    try {
      const r = await fetch(out.api + '/api/auth/login/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: ${JSON.stringify(STORE)}, pin: ${JSON.stringify(PIN)} }),
      });
      out.login = r.status;
      const b = await r.json().catch(() => ({}));
      out.token = !!(b.accessToken || b.token || b.tokens);
    } catch (e) { out.loginErr = String(e && e.message || e); }
    return out;
  })()`;

  let result: any;
  try {
    result = await win.webContents.executeJavaScript(script);
  } catch (e: any) {
    result = { fatal: String(e?.message || e) };
  }
  // eslint-disable-next-line no-console
  console.log('CONNECTIVITY_RESULT ' + JSON.stringify(result));
  const ok = result && result.health === 200 && result.login === 200 && result.token === true;
  app.exit(ok ? 0 : 1);
});
