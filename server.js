// Biber-Portal – IServ-SSO für die Zugangsdaten zum Informatik-Biber.

import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, normalizeAccount } from './lib/config.js';
import { Store } from './lib/store.js';
import { createOidcClient } from './lib/oidc.js';
import { parseCredentialFile } from './lib/importer.js';
import { currentPhase, PHASES } from './lib/phase.js';
import { layout, landingPage, studentPage, messagePage } from './lib/views.js';
import { adminPage, importPreviewPage, credentialFormPage } from './lib/admin-views.js';
import { teacherPage, printPage } from './lib/teacher-views.js';
import { parseGroupsClaim, isTeacher, resolveTeacherGroups, classOverview } from './lib/groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(cfg = loadConfig()) {
  const store = new Store(cfg.dataDir, cfg.dataKey);
  const oidc = createOidcClient(cfg.oidc);
  const pendingImports = new Map(); // token -> { result, filename, actor, at }

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': cfg.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: cfg.isProd ? '1h' : 0, index: false }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(
    cookieSession({
      name: 'biber_sess',
      keys: [cfg.sessionSecret],
      httpOnly: true,
      sameSite: 'lax', // nötig, damit das Cookie beim Rücksprung von IServ mitgeschickt wird
      secure: cfg.baseUrl.startsWith('https://'),
      maxAge: 8 * 60 * 60 * 1000,
    })
  );

  // Keine Zwischenspeicherung von Seiten mit Zugangsdaten
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.session.csrf ||= crypto.randomBytes(24).toString('base64url');
    res.locals.csrf = req.session.csrf;
    next();
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  // ---------- Hilfen ----------
  const render = (req, res, opts, status = 200) => {
    const user = req.session.user ? { ...req.session.user, canPrint: canPrint(req.session.user) } : null;
    return res.status(status).type('html').send(layout({ cfg, csrf: req.session.csrf, user, ...opts }));
  };

  function checkCsrf(req, res, next) {
    const token = req.body?._csrf;
    const expected = req.session?.csrf;
    if (
      !token || !expected || token.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ) {
      return render(req, res, { title: 'Sitzung abgelaufen', body: messagePage({ title: 'Sitzung abgelaufen.', text: 'Seite neu laden. Noch einmal versuchen.', action: { href: '/', label: 'Startseite' } }) }, 403);
    }
    next();
  }

  const requireUser = (req, res, next) => (req.session.user ? next() : res.redirect('/'));
  const requireAdmin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    if (!cfg.admins.has(req.session.user.account)) {
      return render(req, res, { title: 'Kein Zugriff', body: messagePage({ title: 'Kein Zugriff.', text: 'Nur für die Biber-Koordination.', action: { href: '/', label: 'Zurück' } }) }, 403);
    }
    next();
  };
  const actor = (req) => req.session.user?.account || 'unbekannt';
  const setFlash = (req, type, text) => { req.session.flash = { type, text }; };
  const takeFlash = (req) => { const f = req.session.flash; req.session.flash = null; return f; };

  function establishSession(req, claims) {
    const account = normalizeAccount(claims[cfg.oidc.accountClaim] || claims.preferred_username || claims.email);
    if (!account) throw new Error(`IServ hat keinen Accountnamen geliefert (Claim „${cfg.oidc.accountClaim}“).`);
    const name = claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || account;
    const hasGroups = 'iserv:groups' in claims || 'groups' in claims;
    const groups = parseGroupsClaim(claims);
    const teacher = isTeacher(groups, cfg.teacherGroups);
    // Gruppen nur speichern, wenn sie gebraucht werden: Lehrkräfte (eigene Gruppen)
    // und Schüler:innen mit Biber-Zugang (Quelle „Anmeldung“ für die Gruppenlisten).
    if (hasGroups && (teacher || cfg.admins.has(account) || store.byAccount(account))) store.recordMembership(account, groups);
    req.session.user = {
      account,
      name,
      givenName: claims.given_name || '',
      isAdmin: cfg.admins.has(account),
      isTeacher: teacher,
      groupsKnown: hasGroups,
    };
  }

  const canPrint = (user) => !!user && (user.isAdmin || (user.isTeacher && store.settings.teacherPrintEnabled));
  const requireTeacher = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    if (!canPrint(req.session.user)) {
      return render(req, res, { title: 'Kein Zugriff', body: messagePage({ title: 'Kein Zugriff.', text: 'Nur für Lehrkräfte.', action: { href: '/', label: 'Zurück' } }) }, 403);
    }
    next();
  };
  function teacherGroupsFor(user) {
    const m = store.membershipOf(user.account);
    const result = resolveTeacherGroups({
      teacherGroups: m?.groups || [],
      credentials: store.all(),
      memberships: store.memberships,
      settings: store.settings,
      teacherGroupNames: cfg.teacherGroups,
    });
    return { ...result, at: m?.at || null, known: !!m, total: m?.groups?.length || 0 };
  }

  // ---------- Öffentliche Routen ----------
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/', (req, res) => {
    const user = req.session.user;
    if (!user) {
      const error = req.session.loginError; req.session.loginError = null;
      return render(req, res, { title: 'Anmelden', page: 'landing', body: landingPage({ cfg, error, devLogin: cfg.devLogin, csrf: req.session.csrf }) });
    }
    const cred = store.byAccount(user.account);
    if (!cred && canPrint(user) && !user.isAdmin) return res.redirect('/lehrkraft');
    const settings = store.settings;
    if (cred && settings.credentialsVisible) store.markViewed(cred.id);
    render(req, res, { title: 'Meine Zugangsdaten', page: 'student', body: studentPage({ user, cred, settings, phase: currentPhase(settings) }) });
  });

  // ---------- IServ-Anmeldung ----------
  app.get('/auth/login', async (req, res) => {
    try {
      // Fallback: lehnt IServ den Scope iserv:groups ab, ohne Gruppen anmelden
      const noGroups = req.query.ohneGruppen === '1';
      const scope = noGroups ? cfg.oidc.scope.split(/\s+/).filter((x) => x !== 'iserv:groups').join(' ') : undefined;
      const { url, state, nonce, verifier } = await oidc.beginLogin({ scope });
      req.session.oidc = { state, nonce, verifier, at: Date.now(), noGroups };
      res.redirect(url);
    } catch (err) {
      console.error('[auth] Login-Start fehlgeschlagen:', err);
      req.session.loginError = 'IServ ist gerade nicht erreichbar. Gleich noch einmal.';
      res.redirect('/');
    }
  });

  app.get('/auth/callback', async (req, res) => {
    const pending = req.session.oidc;
    req.session.oidc = null;
    try {
      if (req.query.error === 'invalid_scope' && pending && !pending.noGroups && cfg.oidc.scope.includes('iserv:groups')) {
        console.warn('[auth] IServ lehnt den Scope iserv:groups ab – Anmeldung ohne Gruppen. Scope im IServ-Client freigeben!');
        return res.redirect('/auth/login?ohneGruppen=1');
      }
      if (req.query.error) throw new Error(`IServ meldet: ${req.query.error_description || req.query.error}`);
      if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state) {
        throw new Error('Ungültiger oder abgelaufener Anmeldevorgang (state).');
      }
      if (Date.now() - pending.at > 10 * 60 * 1000) throw new Error('Anmeldevorgang abgelaufen.');
      const claims = await oidc.finishLogin({ code: String(req.query.code || ''), verifier: pending.verifier, nonce: pending.nonce });
      establishSession(req, claims);
      req.session.csrf = crypto.randomBytes(24).toString('base64url'); // neue Sitzung, neues Token
      const u = req.session.user;
      const own = store.byAccount(u.account);
      res.redirect(own ? '/' : u.isAdmin ? '/admin' : canPrint(u) ? '/lehrkraft' : '/');
    } catch (err) {
      console.error('[auth] Callback fehlgeschlagen:', err.message);
      req.session.loginError = 'Anmeldung hat nicht geklappt. Bitte noch einmal.';
      res.redirect('/');
    }
  });

  if (cfg.devLogin) {
    app.post('/auth/dev', checkCsrf, (req, res) => {
      establishSession(req, { preferred_username: req.body.account, name: req.body.account });
      res.redirect('/');
    });
  }

  app.post('/logout', checkCsrf, (req, res) => {
    req.session = null;
    res.type('html').send(layout({ cfg, title: 'Abgemeldet', body: messagePage({ title: 'Bis bald.', text: 'Im Portal abgemeldet. IServ bleibt angemeldet.', action: { href: '/', label: 'Startseite' } }) }));
  });

  // ---------- Lehrkräfte: Zugangslisten der eigenen IServ-Gruppen ----------
  app.get('/lehrkraft', requireTeacher, (req, res) => {
    const groups = teacherGroupsFor(req.session.user);
    const diagnosis = req.session.user.isAdmin ? { classes: classOverview(store.all()), memberships: store.membershipCount(), credentials: store.all().length } : null;
    render(req, res, { title: 'Meine Gruppen', page: 'teacher', body: teacherPage({ user: req.session.user, groups, settings: store.settings, diagnosis }) });
  });

  app.get('/lehrkraft/druck/:act', requireTeacher, (req, res) => {
    const { visible } = teacherGroupsFor(req.session.user);
    const group = visible.find((g) => g.act === String(req.params.act).toLowerCase());
    if (!group) {
      return render(req, res, { title: 'Nicht verfügbar', body: messagePage({ title: 'Nicht verfügbar.', text: 'Diese Gruppe gehört nicht zu Ihren Gruppen oder ist ausgeblendet.', action: { href: '/lehrkraft', label: 'Meine Gruppen' } }) }, 404);
    }
    const layoutMode = req.query.layout === 'karten' ? 'karten' : 'liste';
    store.note(actor(req), 'print', `Zugangsliste „${group.name}“ (${group.count} Zugänge, ${layoutMode}) aufgerufen`);
    render(req, res, { title: `Zugänge ${group.name}`, page: 'print', body: printPage({ group, layoutMode, user: req.session.user, settings: store.settings }) });
  });

  // ---------- Verwaltung ----------
  app.get('/admin', requireAdmin, (req, res) => {
    const settings = store.settings;
    render(req, res, { title: 'Verwaltung', page: 'admin', body: adminPage({ store, settings, phase: currentPhase(settings), csrf: req.session.csrf, flash: takeFlash(req), adminCount: cfg.admins.size }) });
  });

  app.get('/admin/vorlage.csv', requireAdmin, (req, res) => {
    const csv = '﻿Klassen-/Kursname;Stufe;Vorname;Nachname;Benutzername;Passwort;IServ\n10a;9-10;Max;Mustermann;biber-ab12cd;Xy7-Kq2p;max.mustermann\n';
    res.type('text/csv; charset=utf-8').attachment('biber-zugangsdaten-vorlage.csv').send(csv);
  });

  app.post('/admin/import', requireAdmin, upload.single('file'), checkCsrf, async (req, res) => {
    try {
      if (!req.file) throw new Error('Bitte eine Datei auswählen.');
      const result = await parseCredentialFile(req.file.buffer, req.file.originalname);
      const token = crypto.randomBytes(18).toString('base64url');
      // alte, verwaiste Vorschauen aufräumen
      for (const [k, v] of pendingImports) if (Date.now() - v.at > 30 * 60 * 1000) pendingImports.delete(k);
      pendingImports.set(token, { result, filename: req.file.originalname, actor: actor(req), at: Date.now() });
      render(req, res, { title: 'Import-Vorschau', page: 'import', body: importPreviewPage({ result, token, csrf: req.session.csrf, filename: req.file.originalname, existingCount: store.all().length }) });
    } catch (err) {
      setFlash(req, 'error', `Import nicht möglich: ${err.message}`);
      res.redirect('/admin#import');
    }
  });

  app.post('/admin/import/confirm', requireAdmin, checkCsrf, (req, res) => {
    const pending = pendingImports.get(req.body.token);
    pendingImports.delete(req.body.token);
    if (!pending || pending.actor !== actor(req)) {
      setFlash(req, 'error', 'Die Vorschau ist abgelaufen. Bitte die Datei erneut hochladen.');
      return res.redirect('/admin#import');
    }
    const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
    const { added, updated } = store.importRows(pending.result.rows, mode, actor(req));
    const open = store.stats().unassigned;
    setFlash(req, 'success', `Import abgeschlossen: ${added} neu, ${updated} aktualisiert.${open ? ` ${open} Einträge haben noch keinen IServ-Account.` : ''}`);
    res.redirect('/admin#zuordnung');
  });

  // ---------- Einzelne Zugänge (Formular) ----------
  const FORM_FIELDS = ['firstName', 'lastName', 'className', 'level', 'username', 'password', 'account'];
  const pickForm = (body) => Object.fromEntries(FORM_FIELDS.map((k) => [k, String(body?.[k] ?? '')]));
  const renderForm = (req, res, opts, status = 200) =>
    render(req, res, { title: opts.mode === 'edit' ? 'Zugang bearbeiten' : 'Neuer Zugang', page: 'admin', body: credentialFormPage({ csrf: req.session.csrf, flash: takeFlash(req), ...opts }) }, status);

  app.get('/admin/credentials/new', requireAdmin, (req, res) => {
    renderForm(req, res, { mode: 'new', values: {} });
  });

  app.post('/admin/credentials', requireAdmin, checkCsrf, (req, res) => {
    const values = pickForm(req.body);
    try {
      const rec = store.addOne(values, actor(req));
      setFlash(req, 'success', `${rec.username} angelegt${rec.account ? ` und ${rec.account} zugeordnet` : ' (noch ohne IServ-Account)'}.`);
      res.redirect(req.body.next === 'again' ? '/admin/credentials/new' : '/admin#zuordnung');
    } catch (err) {
      renderForm(req, res, { mode: 'new', values, error: err.message }, 422);
    }
  });

  app.get('/admin/credentials/:id/edit', requireAdmin, (req, res) => {
    const rec = store.byId(req.params.id);
    if (!rec) { setFlash(req, 'error', 'Eintrag nicht gefunden.'); return res.redirect('/admin#zuordnung'); }
    renderForm(req, res, { mode: 'edit', record: rec, values: rec });
  });

  app.post('/admin/credentials/:id', requireAdmin, checkCsrf, (req, res) => {
    const rec = store.byId(req.params.id);
    if (!rec) { setFlash(req, 'error', 'Eintrag nicht gefunden.'); return res.redirect('/admin#zuordnung'); }
    const values = pickForm(req.body);
    try {
      const { changed } = store.update(rec.id, values, actor(req));
      setFlash(req, 'success', changed.length ? `${rec.username} gespeichert.` : 'Keine Änderungen.');
      res.redirect('/admin#zuordnung');
    } catch (err) {
      renderForm(req, res, { mode: 'edit', record: rec, values, error: err.message }, 422);
    }
  });

  app.post('/admin/credentials/:id/assign', requireAdmin, checkCsrf, (req, res) => {
    try {
      const rec = store.assign(req.params.id, req.body.account, actor(req));
      setFlash(req, 'success', rec.account ? `${rec.username} ist jetzt ${rec.account} zugeordnet.` : `Zuordnung für ${rec.username} entfernt.`);
    } catch (err) {
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin#zuordnung');
  });

  app.post('/admin/credentials/:id/delete', requireAdmin, checkCsrf, (req, res) => {
    store.remove(req.params.id, actor(req));
    setFlash(req, 'success', 'Eintrag gelöscht.');
    res.redirect('/admin#zuordnung');
  });

  app.post('/admin/clear', requireAdmin, checkCsrf, (req, res) => {
    if (req.body.confirm !== 'LÖSCHEN') {
      setFlash(req, 'error', 'Bitte zur Bestätigung LÖSCHEN eingeben.');
      return res.redirect('/admin#protokoll');
    }
    store.clearAll(actor(req));
    setFlash(req, 'success', 'Alle Zugangsdaten wurden gelöscht.');
    res.redirect('/admin');
  });

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  app.post('/admin/settings', requireAdmin, checkCsrf, (req, res) => {
    const b = req.body;
    const errors = [];
    const dates = ['schnupperStart', 'schnupperEnd', 'contestStart', 'contestEnd'];
    for (const d of dates) if (!DATE.test(b[d] || '')) errors.push(`Ungültiges Datum: ${d}`);
    if (!errors.length && !(b.schnupperStart <= b.schnupperEnd && b.schnupperEnd < b.contestStart && b.contestStart <= b.contestEnd)) {
      errors.push('Die Daten müssen in der Reihenfolge Schnupper-Start ≤ Schnupper-Ende < Wettbewerb-Start ≤ Wettbewerb-Ende liegen.');
    }
    for (const u of ['loginUrl', 'schnupperUrl']) {
      try { const x = new URL(b[u]); if (x.protocol !== 'https:') throw 0; } catch { errors.push(`${u === 'loginUrl' ? 'Anmelde-Adresse' : 'Schnupper-Adresse'} muss eine https-Adresse sein.`); }
    }
    const phaseMode = b.phaseMode === 'auto' || PHASES[b.phaseMode] ? b.phaseMode : 'auto';
    let teacherSettings = {};
    if (b.teacherSection === '1') {
      const min = Number.parseInt(b.groupMin, 10);
      const max = Number.parseInt(b.groupMax, 10);
      if (!(min >= 1 && min <= 500)) errors.push('Mindestzahl muss zwischen 1 und 500 liegen.');
      if (!(max >= 1 && max <= 2000)) errors.push('Höchstzahl muss zwischen 1 und 2000 liegen.');
      if (min > max) errors.push('Die Mindestzahl darf nicht größer als die Höchstzahl sein.');
      const maxClasses = Number.parseInt(b.groupMaxClasses, 10);
      if (!(maxClasses >= 0 && maxClasses <= 100)) errors.push('Höchstzahl an Klassen muss zwischen 0 und 100 liegen.');
      teacherSettings = {
        teacherPrintEnabled: b.teacherPrintEnabled === '1',
        groupMin: min,
        groupMax: max,
        groupMaxClasses: maxClasses,
        groupIgnore: String(b.groupIgnore || '').slice(0, 1000).trim(),
        matchByClass: b.matchByClass === '1',
        matchByLogin: b.matchByLogin === '1',
      };
      if (!teacherSettings.matchByClass && !teacherSettings.matchByLogin) errors.push('Mindestens eine Quelle (Klasse oder Anmeldung) muss aktiv sein.');
    }
    if (errors.length) {
      setFlash(req, 'error', errors.join(' '));
      return res.redirect('/admin#einstellungen');
    }
    store.updateSettings({
      phaseMode,
      schnupperStart: b.schnupperStart,
      schnupperEnd: b.schnupperEnd,
      contestStart: b.contestStart,
      contestEnd: b.contestEnd,
      loginUrl: b.loginUrl,
      schnupperUrl: b.schnupperUrl,
      notice: String(b.notice || '').slice(0, 300).trim(),
      credentialsVisible: b.credentialsVisible === '1',
      ...(b.teacherSection === '1' ? teacherSettings : {}),
    }, actor(req));
    setFlash(req, 'success', 'Einstellungen gespeichert.');
    res.redirect('/admin#einstellungen');
  });

  app.get('/admin/preview/:id', requireAdmin, (req, res) => {
    const cred = store.byId(req.params.id);
    if (!cred) return res.redirect('/admin#zuordnung');
    const fakeUser = { account: cred.account || '(ohne Zuordnung)', name: [cred.firstName, cred.lastName].filter(Boolean).join(' '), givenName: cred.firstName };
    const settings = store.settings;
    render(req, res, { title: 'Vorschau', page: 'student', body: studentPage({ user: fakeUser, cred, settings, phase: currentPhase(settings), preview: true }) });
  });

  // ---------- Fehler ----------
  app.use((req, res) => render(req, res, { title: 'Nicht gefunden', body: messagePage({ title: 'Nicht gefunden.', text: 'Diese Seite gibt es nicht.', action: { href: '/', label: 'Startseite' } }) }, 404));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    const text = err.code === 'LIMIT_FILE_SIZE' ? 'Die Datei ist zu groß (max. 5 MB).' : 'Da ist etwas schiefgelaufen. Bitte versuchen Sie es erneut.';
    render(req, res, { title: 'Fehler', body: messagePage({ title: 'Fehler', text, action: { href: '/', label: 'Zur Startseite' } }) }, 500);
  });

  return { app, store };
}

// Direkt gestartet?
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const { app } = createApp(cfg);
  app.listen(cfg.port, () => {
    console.log(`Biber-Portal läuft auf Port ${cfg.port} (${cfg.baseUrl}), IServ: ${cfg.oidc.issuer}`);
  });
}
