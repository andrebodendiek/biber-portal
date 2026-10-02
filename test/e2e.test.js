// Ende-zu-Ende: echter OIDC-Ablauf gegen den Mock-IServ inkl. PKCE, Admin-Import und Schüleransicht.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startMock } from '../tools/mock-iserv.js';
import { createApp } from '../server.js';
import { loadConfig } from '../lib/config.js';

let mock, server, base;

before(async () => {
  mock = await startMock(4100);
  process.env.ISERV_URL = 'http://localhost:4100';
  process.env.MOCK_ISSUER = 'http://localhost:4100';
  process.env.BASE_URL = 'http://localhost:3100';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biber-e2e-'));
  process.env.ADMIN_ACCOUNTS = 'andre.bodendiek';
  const { app } = createApp(loadConfig());
  await new Promise((r) => { server = app.listen(3100, r); });
  base = 'http://localhost:3100';
});
after(() => { server?.closeAllConnections?.(); server?.close(); mock?.closeAllConnections?.(); mock?.close(); });

// Minimaler Browser mit Cookie-Jar
function browser() {
  const jar = new Map();
  async function go(url, opts = {}) {
    const u = new URL(url, base);
    const headers = { ...(opts.headers || {}) };
    const cookies = [...jar].filter(([, v]) => v.host === u.host).map(([k, v]) => `${k}=${v.value}`).join('; ');
    if (cookies) headers.cookie = cookies;
    if (process.env.DBG) console.log('>>', opts.method || 'GET', u.toString().slice(0, 90));
    const res = await fetch(u, { ...opts, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), { value: pair.slice(i + 1), host: u.host });
    }
    if ([301, 302, 303].includes(res.status) && !opts.noFollow) {
      return go(new URL(res.headers.get('location'), u).toString(), { method: 'GET' });
    }
    return { res, text: await res.text(), url: u.toString() };
  }
  return { go };
}

async function login(b, account) {
  const start = await b.go('/auth/login'); // folgt zu Mock-Auswahlseite
  assert.match(start.text, /Mock-IServ/);
  const hidden = Object.fromEntries([...start.text.matchAll(/name="(\w+)" value="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&quot;/g, '"')]));
  const body = new URLSearchParams({ ...hidden, user: account });
  return b.go('http://localhost:4100/iserv/auth/auth', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}
const csrfOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

test('kompletter Ablauf', async () => {
  // 1) Admin meldet sich an und importiert
  const admin = browser();
  let page = await login(admin, 'andre.bodendiek');
  assert.match(page.text, /Verwaltung/);
  const csv = 'Klassen-/Kursname;Vorname;Nachname;Benutzername;Passwort;IServ\n10a;Max;Mustermann;biber-max;S3cret!;max.mustermann\n10a;Erika;Musterfrau;biber-erika;Pw<b>;\n';
  const fd = new FormData();
  fd.set('_csrf', csrfOf(page.text));
  fd.set('file', new Blob([csv], { type: 'text/csv' }), 'export.csv');
  page = await admin.go('/admin/import', { method: 'POST', body: fd });
  assert.match(page.text, /2 Zugangsdaten erkannt/);
  const token = page.text.match(/name="token" value="([^"]+)"/)[1];
  page = await admin.go('/admin/import/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfOf(page.text), token, mode: 'replace' }),
  });
  assert.match(page.text, /Import abgeschlossen: 2 neu/);
  assert.match(page.text, /1 Einträge haben noch keinen IServ-Account/);

  // Zuordnung nachtragen
  const id = page.text.match(/\/admin\/credentials\/([\w-]+)\/assign[\s\S]*?value=""/)?.[1];
  assert.ok(id);
  page = await admin.go(`/admin/credentials/${id}/assign`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfOf(page.text), account: 'Erika.Musterfrau' }),
  });
  assert.match(page.text, /erika\.musterfrau zugeordnet/);

  // CSRF-Schutz
  const bad = await admin.go('/admin/clear', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=L%C3%96SCHEN&_csrf=falsch' });
  assert.equal(bad.res.status, 403);

  // 2) Schüler sieht eigene Daten, HTML ist escaped
  const erika = browser();
  page = await login(erika, 'erika.musterfrau');
  assert.match(page.text, /Hallo, Erika\./);
  assert.match(page.text, /biber-erika/);
  assert.ok(page.text.includes('Pw&lt;b&gt;') && !page.text.includes('Pw<b>'));
  assert.ok(!page.text.includes('biber-max'));
  assert.equal(page.res.headers.get('cache-control'), 'no-store');
  assert.match(page.res.headers.get('content-security-policy'), /script-src 'self'/);

  // Kein Admin-Zugriff
  const forb = await erika.go('/admin');
  assert.equal(forb.res.status, 403);

  // 3) Konto ohne Daten
  const lena = browser();
  page = await login(lena, 'lena.ohnedaten');
  assert.match(page.text, /Noch keine Zugangsdaten hinterlegt/);

  // 4) Abruf wurde gezählt
  page = await admin.go('/admin');
  assert.match(page.text, /1× abgerufen/);

  // 5) Zugangsdaten verbergen
  page = await admin.go('/admin/settings', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfOf(page.text), phaseMode: 'wettbewerb', schnupperStart: '2026-09-14', schnupperEnd: '2026-11-06', contestStart: '2026-11-09', contestEnd: '2026-11-20', loginUrl: 'https://wettbewerb.informatik-biber.de/index.php?action=login', schnupperUrl: 'https://wettbewerb.informatik-biber.de/index.php?action=login', notice: 'Start Montag 3. Stunde' }),
  });
  assert.match(page.text, /Einstellungen gespeichert/);
  page = await erika.go('/');
  assert.match(page.text, /werden im Unterricht freigeschaltet/);
  assert.match(page.text, /Start Montag 3. Stunde/);
  assert.ok(!page.text.includes('biber-erika'));

  // 6) Abmelden
  page = await erika.go('/');
  page = await erika.go('/logout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf(page.text) }) });
  assert.match(page.text, /abgemeldet/);
  page = await erika.go('/');
  assert.match(page.text, /Mit IServ anmelden/);
});

test('manipulierter state wird abgewiesen', async () => {
  const b = browser();
  await b.go('/auth/login', { noFollow: true });
  const page = await b.go('/auth/callback?code=abc&state=falsch');
  assert.match(page.text, /hat nicht geklappt/);
});

test('einzelne Zugänge per Formular anlegen und bearbeiten', async () => {
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const admin = browser();
  let page = await login(admin, 'andre.bodendiek');
  page = await admin.go('/admin');
  assert.match(page.text, /Einzeln\./);
  // Sichtbarkeit wieder einschalten (vorheriger Test hat sie ausgeschaltet)
  page = await admin.go('/admin/settings', {
    method: 'POST', headers: form,
    body: new URLSearchParams({ _csrf: csrfOf(page.text), phaseMode: 'auto', schnupperStart: '2026-09-14', schnupperEnd: '2026-11-06', contestStart: '2026-11-09', contestEnd: '2026-11-20', loginUrl: 'https://wettbewerb.informatik-biber.de/index.php?action=login', schnupperUrl: 'https://wettbewerb.informatik-biber.de/index.php?action=login', notice: '', credentialsVisible: '1' }),
  });

  // Anlegen mit „Anlegen & nächster“ → leeres Formular mit Erfolgsmeldung
  page = await admin.go('/admin/credentials', {
    method: 'POST', headers: form,
    body: new URLSearchParams({ _csrf: csrfOf(page.text), firstName: 'Lena', lastName: 'Ohnedaten', className: '8c', level: '7-8', username: 'biber-lena', password: 'Erst-Pw-1', account: ' Lena.Ohnedaten ', next: 'again' }),
  });
  assert.match(page.text, /Neuer Zugang\./);
  assert.match(page.text, /biber-lena angelegt und lena\.ohnedaten zugeordnet/);

  // Doppelter Benutzername → Fehler, Eingaben bleiben erhalten
  page = await admin.go('/admin/credentials', {
    method: 'POST', headers: form,
    body: new URLSearchParams({ _csrf: csrfOf(page.text), firstName: 'Zweit', username: 'BIBER-LENA', password: 'x', account: '' }),
  });
  assert.equal(page.res.status, 422);
  assert.match(page.text, /schon vergeben/);
  assert.match(page.text, /value="Zweit"/);

  // Doppelter IServ-Account → Fehler
  page = await admin.go('/admin/credentials', {
    method: 'POST', headers: form,
    body: new URLSearchParams({ _csrf: csrfOf(page.text), username: 'biber-neu', password: 'x', account: 'lena.ohnedaten' }),
  });
  assert.match(page.text, /bereits biber-lena zugeordnet/);

  // Schülerin sieht ihre Daten
  const lena = browser();
  page = await login(lena, 'lena.ohnedaten');
  assert.match(page.text, /Erst-Pw-1/);

  // Bearbeiten: Passwort ändern
  page = await admin.go('/admin');
  const id = page.text.match(/\/admin\/credentials\/([\w-]+)\/edit" title="Bearbeiten" aria-label="biber-lena/)[1];
  page = await admin.go(`/admin/credentials/${id}/edit`);
  assert.match(page.text, /Zugang bearbeiten\./);
  assert.match(page.text, /value="Erst-Pw-1"/);
  page = await admin.go(`/admin/credentials/${id}`, {
    method: 'POST', headers: form,
    body: new URLSearchParams({ _csrf: csrfOf(page.text), firstName: 'Lena', lastName: 'Ohnedaten', className: '8c', level: '7-8', username: 'biber-lena', password: 'Neu-Pw-2', account: 'lena.ohnedaten' }),
  });
  assert.match(page.text, /biber-lena gespeichert/);
  assert.match(page.text, /biber-lena geändert \(Passwort\)/);

  page = await lena.go('/');
  assert.match(page.text, /Neu-Pw-2/);
  assert.ok(!page.text.includes('Erst-Pw-1'));
});

test('Lehrkräfte drucken Zugangslisten ihrer IServ-Gruppen', async () => {
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const admin = browser();
  let page = await login(admin, 'andre.bodendiek');
  page = await admin.go('/admin');
  // Drei weitere Zugänge der Klasse 10a (ohne IServ-Account) – Quelle „Klasse“
  for (const n of ['a', 'b', 'c']) {
    page = await admin.go('/admin/credentials', {
      method: 'POST', headers: form,
      body: new URLSearchParams({ _csrf: csrfOf(page.text), firstName: `Kind-${n}`, lastName: 'Zehn', className: '10a', username: `biber-10a-${n}`, password: `Geheim-${n}`, account: '', next: 'again' }),
    });
  }

  // Lehrkraft (nicht Admin) landet nach dem Login auf „Meine Gruppen“
  const tina = browser();
  page = await login(tina, 'tina.lehrerin');
  assert.match(page.url, /\/lehrkraft$/);
  assert.match(page.text, /Meine Gruppen\./);
  assert.match(page.text, /Klasse 10a/);
  assert.match(page.text, /Fachschaft Informatik/); // ausgeblendet, aber begründet
  assert.ok(!page.text.includes('Geheim-a')); // Übersicht zeigt keine Passwörter

  // Druckliste
  page = await tina.go('/lehrkraft/druck/klasse.10a?layout=liste');
  assert.equal(page.res.status, 200);
  assert.match(page.text, /Geheim-a/);
  assert.match(page.text, /biber-10a-c/);
  assert.match(page.text, /Vertraulich/);
  assert.ok(!page.text.includes('biber-lena')); // 8c gehört nicht dazu
  page = await tina.go('/lehrkraft/druck/klasse.10a?layout=karten');
  assert.match(page.text, /cut-card/);

  // Fremde Gruppe (Tina ist nicht in 8c) → 404
  page = await tina.go('/lehrkraft/druck/klasse.8c');
  assert.equal(page.res.status, 404);
  // Keine Verwaltung für Lehrkräfte
  page = await tina.go('/admin');
  assert.equal(page.res.status, 403);

  // Schüler:innen haben keinen Zugriff
  const max = browser();
  await login(max, 'max.mustermann');
  page = await max.go('/lehrkraft');
  assert.equal(page.res.status, 403);

  // Abruf ist protokolliert
  page = await admin.go('/admin');
  assert.match(page.text, /tina\.lehrerin<\/strong> · Zugangsliste „Klasse 10a“/);

  // Abschalten in der Verwaltung → Lehrkraft ohne Zugriff
  page = await admin.go('/admin/settings', {
    method: 'POST', headers: form,
    body: new URLSearchParams({ _csrf: csrfOf(page.text), phaseMode: 'auto', schnupperStart: '2026-09-14', schnupperEnd: '2026-11-06', contestStart: '2026-11-09', contestEnd: '2026-11-20', loginUrl: 'https://wettbewerb.informatik-biber.de/index.php?action=login', schnupperUrl: 'https://wettbewerb.informatik-biber.de/index.php?action=login', notice: '', credentialsVisible: '1', teacherSection: '1', groupMin: '3', groupMax: '40', groupMaxClasses: '3', groupIgnore: 'Alle', matchByClass: '1', matchByLogin: '1' }),
  });
  assert.match(page.text, /Einstellungen gespeichert/);
  page = await tina.go('/lehrkraft');
  assert.equal(page.res.status, 403);
});
