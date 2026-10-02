// Vorlagen für den Verwaltungsbereich. Tonalität: kurz und präzise.

import { esc, ICON } from './views.js';
import { PHASES } from './phase.js';

const fmt = (iso) =>
  iso
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso))
    : '–';

function flashBlock(flash) {
  if (!flash) return '';
  return `<div class="alert ${flash.type === 'error' ? 'error' : 'success'} reveal">${esc(flash.text)}</div>`;
}

export function credentialFields(v = {}) {
  const val = (k) => esc(v[k] ?? '');
  const plain = 'autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" data-1p-ignore data-lpignore="true"';
  return `
    <label>Vorname<input name="firstName" value="${val('firstName')}" maxlength="80" ${plain}></label>
    <label>Nachname<input name="lastName" value="${val('lastName')}" maxlength="80" ${plain}></label>
    <label>Klasse/Kurs<input name="className" value="${val('className')}" maxlength="40" placeholder="z. B. 7b" ${plain}></label>
    <label>Stufe<input name="level" value="${val('level')}" maxlength="20" placeholder="z. B. 7-8" ${plain}></label>
    <label class="span2">Biber-Benutzername<input class="mono" name="username" value="${val('username')}" required maxlength="120" ${plain}></label>
    <label class="span2">Passwort<input class="mono" type="text" name="password" value="${val('password')}" required maxlength="120" ${plain}></label>
    <label class="wide"><span>IServ-Account <span class="opt">· optional</span></span><input class="mono" name="account" value="${val('account')}" maxlength="120" placeholder="max.mustermann" ${plain}><small>Ohne Account wird der Zugang gespeichert, aber noch niemandem angezeigt.</small></label>`;
}

export function credentialFormPage({ mode, values = {}, record = null, error = '', flash = null, csrf }) {
  const edit = mode === 'edit';
  const meta = edit && record ? [
    record.viewCount ? `${record.viewCount}× abgerufen, zuletzt ${fmt(record.lastViewedAt)}` : 'Noch nicht abgerufen',
    record.source === 'formular' ? `Einzeln angelegt ${fmt(record.importedAt)}` : `Importiert ${fmt(record.importedAt)}`,
    record.updatedAt ? `Geändert ${fmt(record.updatedAt)}` : '',
  ].filter(Boolean) : [];
  return `
<section class="hero tight">
  <p class="eyebrow reveal">Verwaltung · ${edit ? 'Bearbeiten' : 'Einzeln'}</p>
  <h1 class="display" data-split>${edit ? 'Zugang bearbeiten.' : 'Neuer Zugang.'}</h1>
  <p class="sub reveal">${edit ? esc(record?.username || '') : 'Eintragen. Zuordnen. Fertig.'}</p>
</section>
${flashBlock(flash)}
${error ? `<div class="alert error reveal">${esc(error)}</div>` : ''}
<section class="panel block spot reveal form-panel">
  ${meta.length ? `<p class="meta-line">${meta.map(esc).join(' · ')}</p>` : ''}
  <form method="post" action="${edit ? `/admin/credentials/${esc(record.id)}` : '/admin/credentials'}" class="cred-form" autocomplete="off">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    ${credentialFields(values)}
    <div class="wide actions">
      ${!edit ? `<span class="muted small form-note">Zuerst in <a href="https://admin.informatik-biber.de/" target="_blank" rel="noopener">admin.informatik-biber.de</a> anlegen. Dann hier eintragen.</span>` : ''}
      ${edit && record?.account ? `<a class="btn btn-ghost" href="/admin/preview/${esc(record.id)}">${ICON.eye}Vorschau</a>` : ''}
      <a class="btn btn-ghost" href="/admin#${edit ? 'zuordnung' : 'einzeln'}">Abbrechen</a>
      ${edit ? '' : '<button class="btn btn-ghost" type="submit" name="next" value="again">Anlegen &amp; nächster</button>'}
      <button class="btn btn-primary magnetic" type="submit" name="next" value="list">${edit ? 'Speichern' : `${ICON.plus}Anlegen`}</button>
    </div>
  </form>
</section>`;
}

function stat(value, label, extra = '') {
  return `<div class="tile stat spot reveal ${extra}"><p class="stat-num"><span data-countup="${value}">${value}</span></p><span class="k">${esc(label)}</span></div>`;
}

export function adminPage({ store, settings, phase, csrf, flash, adminCount }) {
  const s = store.stats();
  const rows = [...store.all()].sort((a, b) =>
    (a.className || '').localeCompare(b.className || '', 'de', { numeric: true }) ||
    (a.lastName || '').localeCompare(b.lastName || '', 'de') ||
    a.username.localeCompare(b.username, 'de')
  );
  const classes = [...new Set(rows.map((r) => r.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));

  const phaseOptions = [['auto', 'Automatisch'], ...Object.entries(PHASES).map(([k, v]) => [k, v.label])]
    .map(([k, l]) => `<option value="${k}" ${settings.phaseMode === k ? 'selected' : ''}>${esc(l)}</option>`)
    .join('');

  const table = rows.length
    ? rows.map((r) => `
      <tr data-row data-search="${esc([r.username, r.account, r.firstName, r.lastName, r.className].join(' ').toLowerCase())}" data-class="${esc(r.className)}" data-state="${r.account ? 'assigned' : 'open'}">
        <td><strong>${esc([r.lastName, r.firstName].filter(Boolean).join(', ') || '–')}</strong><small>${esc(r.className || '')}${r.level ? ` · Stufe ${esc(r.level)}` : ''}</small></td>
        <td class="mono">${esc(r.username)}</td>
        <td>
          <form method="post" action="/admin/credentials/${esc(r.id)}/assign" class="assign-form">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <input name="account" value="${esc(r.account)}" placeholder="iserv.account" aria-label="IServ-Account für ${esc(r.username)}" autocomplete="off" spellcheck="false" class="${r.account ? '' : 'missing'}">
            <button class="icon" type="submit" aria-label="Speichern">${ICON.check}</button>
          </form>
        </td>
        <td>${r.firstViewedAt ? `<span class="status ok" title="zuletzt ${esc(fmt(r.lastViewedAt))}">${r.viewCount}× abgerufen</span>` : '<span class="status">offen</span>'}</td>
        <td><div class="row-actions">
          <a class="icon" href="/admin/credentials/${esc(r.id)}/edit" title="Bearbeiten" aria-label="${esc(r.username)} bearbeiten">${ICON.edit}</a>
          ${r.account ? `<a class="icon" href="/admin/preview/${esc(r.id)}" title="Vorschau" aria-label="Vorschau">${ICON.eye}</a>` : ''}
          <form method="post" action="/admin/credentials/${esc(r.id)}/delete" class="inline" data-confirm="Eintrag ${esc(r.username)} löschen?">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <button class="icon danger" type="submit" aria-label="Löschen">${ICON.trash}</button>
          </form>
        </div></td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="empty-cell">Noch nichts importiert.</td></tr>`;

  const viewedPct = s.assigned ? Math.round((s.viewed / s.assigned) * 100) : 0;

  return `
<section class="hero tight">
  <p class="eyebrow reveal"><span class="live phase-${esc(phase)}"></span>${esc(PHASES[phase].label)} · ${settings.phaseMode === 'auto' ? 'automatisch' : 'manuell'}</p>
  <h1 class="display" data-split>Verwaltung.</h1>
  <p class="sub reveal">Importieren. Zuordnen. Freischalten.</p>
</section>
${flashBlock(flash)}

<nav class="segmented reveal" aria-label="Bereiche">
  <a href="#import">Import</a><a href="#einzeln">Einzeln</a><a href="#zuordnung">Zuordnung</a><a href="#einstellungen">Einstellungen</a><a href="#protokoll">Protokoll</a>
</nav>

<section class="stats-row">
  ${stat(s.total, 'Zugangsdaten')}
  ${stat(s.assigned, 'Zugeordnet')}
  ${stat(s.unassigned, 'Ohne Zuordnung', s.unassigned ? 'is-warn' : '')}
  <div class="tile stat spot reveal"><p class="stat-num"><span data-countup="${s.viewed}">${s.viewed}</span></p><span class="k">Abgerufen · ${viewedPct} %</span><span class="bar"><i data-progress="${viewedPct}"></i></span></div>
</section>

<section id="import" class="panel block spot reveal">
  <header class="block-head"><span class="num">01</span><div><h2 class="h2">Import.</h2><p>Biber-Export. Plus Spalte „IServ“.</p></div></header>
  <div class="split">
    <form method="post" action="/admin/import" enctype="multipart/form-data" class="dropzone" data-dropzone>
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <span class="drop-icon">${ICON.upload}</span>
      <strong>Datei hierher ziehen.</strong>
      <span class="muted small">CSV oder Excel (.xlsx)</span>
      <label class="btn btn-quiet"><input type="file" name="file" accept=".csv,.txt,.xlsx" required hidden data-file>Auswählen</label>
      <span class="file-name small" data-file-name></span>
      <button class="btn btn-primary magnetic" type="submit" data-upload disabled>Vorschau ${ICON.arrow}</button>
    </form>
    <ol class="howto">
      <li><strong>Exportieren.</strong><span>Zugangsdaten in <a href="https://admin.informatik-biber.de/" target="_blank" rel="noopener">admin.informatik-biber.de</a> als Excel oder CSV laden.</span></li>
      <li><strong>Ergänzen.</strong><span>Spalte <code>IServ</code> mit dem Accountnamen, z.&nbsp;B. <code>max.mustermann</code>.</span></li>
      <li><strong>Hochladen.</strong><span>Vorschau prüfen. Übernehmen. <a href="/admin/vorlage.csv">Vorlage ›</a></span></li>
    </ol>
  </div>
</section>

<section id="einzeln" class="panel block spot reveal">
  <header class="block-head"><span class="num">02</span><div><h2 class="h2">Einzeln.</h2><p>Ein Zugang. Ohne Datei.</p></div></header>
  <form method="post" action="/admin/credentials" class="cred-form" autocomplete="off">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    ${credentialFields({})}
    <div class="wide actions">
      <span class="muted small form-note">Zuerst in <a href="https://admin.informatik-biber.de/" target="_blank" rel="noopener">admin.informatik-biber.de</a> anlegen. Dann hier eintragen.</span>
      <button class="btn btn-ghost" type="submit" name="next" value="again">Anlegen &amp; nächster</button>
      <button class="btn btn-primary magnetic" type="submit" name="next" value="list">${ICON.plus}Anlegen</button>
    </div>
  </form>
</section>

<section id="zuordnung" class="panel block spot reveal">
  <header class="block-head">
    <span class="num">03</span><div><h2 class="h2">Zuordnung.</h2><p>Biber-Konto zu IServ-Konto.</p></div>
    <div class="filters">
      <input type="search" placeholder="Suchen" data-filter-text aria-label="Suchen">
      <select data-filter-class aria-label="Klasse"><option value="">Alle Klassen</option>${classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select data-filter-state aria-label="Status"><option value="">Alle</option><option value="open">Ohne Zuordnung</option><option value="assigned">Zugeordnet</option></select>
    </div>
  </header>
  <div class="table-wrap scroll">
    <table class="data">
      <thead><tr><th>Name</th><th>Biber-Benutzername</th><th>IServ-Account</th><th>Abruf</th><th><span class="sr-only">Aktionen</span></th></tr></thead>
      <tbody>${table}</tbody>
    </table>
  </div>
  <p class="muted small table-foot" data-filter-count></p>
</section>

<section id="einstellungen" class="panel block spot reveal">
  <header class="block-head"><span class="num">04</span><div><h2 class="h2">Einstellungen.</h2><p>Phase. Termine. Weiterleitung.</p></div></header>
  <form method="post" action="/admin/settings" class="settings-grid">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <label>Phase<select name="phaseMode">${phaseOptions}</select></label>
    <label>Schnupper ab<input type="date" name="schnupperStart" value="${esc(settings.schnupperStart)}" required></label>
    <label>Schnupper bis<input type="date" name="schnupperEnd" value="${esc(settings.schnupperEnd)}" required></label>
    <label>Biberwochen ab<input type="date" name="contestStart" value="${esc(settings.contestStart)}" required></label>
    <label>Biberwochen bis<input type="date" name="contestEnd" value="${esc(settings.contestEnd)}" required></label>
    <label class="wide">Anmeldung<input type="url" name="loginUrl" value="${esc(settings.loginUrl)}" required></label>
    <label class="wide">Schnupper-Biber<input type="url" name="schnupperUrl" value="${esc(settings.schnupperUrl)}" required><small>Standard: Anmeldeseite. Der Schnupper-Biber steht dort unter „Wettbewerbe“.</small></label>
    <label class="wide">Hinweis an alle<input name="notice" maxlength="300" value="${esc(settings.notice)}" placeholder="z. B. Start: Montag, 3. Stunde, Raum 112."></label>
    <label class="switch wide"><input type="checkbox" name="credentialsVisible" value="1" ${settings.credentialsVisible ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span>Zugangsdaten sichtbar</span></label>
    <input type="hidden" name="teacherSection" value="1">
    <div class="wide settings-sub">
      <h3 class="h3">Lehrkräfte.</h3>
      <p class="muted small">Mitglieder der IServ-Gruppe „Lehrende“ können Zugangslisten ihrer eigenen IServ-Gruppen drucken.</p>
    </div>
    <label class="switch wide"><input type="checkbox" name="teacherPrintEnabled" value="1" ${settings.teacherPrintEnabled ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span>Gruppenlisten für Lehrkräfte</span></label>
    <label>Mindestens<input type="number" name="groupMin" min="1" max="500" value="${esc(settings.groupMin)}" required><small>Zugänge, damit eine Gruppe erscheint</small></label>
    <label>Höchstens<input type="number" name="groupMax" min="1" max="2000" value="${esc(settings.groupMax)}" required><small>Schützt vor Gruppen wie „Alle“</small></label>
    <label>Klassen je Gruppe<input type="number" name="groupMaxClasses" min="0" max="100" value="${esc(settings.groupMaxClasses)}" required><small>Höchstens so viele verschiedene Klassen (0 = aus)</small></label>
    <label class="switch"><input type="checkbox" name="matchByClass" value="1" ${settings.matchByClass ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span>Quelle: Klasse</span></label>
    <label class="switch"><input type="checkbox" name="matchByLogin" value="1" ${settings.matchByLogin ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span>Quelle: Anmeldung</span></label>
    <label class="wide">Immer ausblenden<input name="groupIgnore" maxlength="1000" value="${esc(settings.groupIgnore)}" placeholder="z. B. Alle, Schülervertretung, AG Schulgarten"><small>Gruppennamen oder -kürzel, kommagetrennt. „Lehrende“ ist immer ausgeblendet.</small></label>
    <div class="wide actions"><button class="btn btn-primary magnetic" type="submit">Speichern</button></div>
  </form>
</section>

<section id="protokoll" class="duo">
  <article class="tile spot reveal">
    <span class="k">Protokoll</span>
    <h3 class="h3">Zuletzt.</h3>
    <ul class="audit">${store.audit(15).map((a) => `<li><time>${esc(fmt(a.at))}</time><span><strong>${esc(a.actor)}</strong> · ${esc(a.detail)}</span></li>`).join('') || '<li class="muted">Noch nichts.</li>'}</ul>
  </article>
  <article class="tile spot reveal danger-zone">
    <span class="k">Nach dem Wettbewerb</span>
    <h3 class="h3">Alles löschen.</h3>
    <p class="muted">Alle Zugangsdaten und Zuordnungen. Endgültig. Einstellungen bleiben.</p>
    <form method="post" action="/admin/clear" class="clear-form">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <input name="confirm" autocomplete="off" required pattern="LÖSCHEN" placeholder="LÖSCHEN eingeben" aria-label="Zur Bestätigung LÖSCHEN eingeben">
      <button class="btn btn-danger" type="submit">${ICON.trash}Löschen</button>
    </form>
    <p class="muted small">${adminCount} Admin-Konto/Konten über ADMIN_ACCOUNTS.</p>
  </article>
</section>`;
}

export function importPreviewPage({ result, token, csrf, filename, existingCount }) {
  const { rows, warnings, errors, columns } = result;
  const assigned = rows.filter((r) => r.account).length;
  const sample = rows.slice(0, 200).map((r) => `<tr class="${r.account ? '' : 'row-open'}">
      <td class="muted">${r.line}</td><td>${esc([r.lastName, r.firstName].filter(Boolean).join(', ') || '–')}</td><td>${esc(r.className)}</td>
      <td class="mono">${esc(r.username)}</td><td class="mono muted">${'•'.repeat(Math.min(r.password.length, 10))}</td>
      <td class="mono">${r.account ? esc(r.account) : '<span class="status warn">fehlt</span>'}</td></tr>`).join('');

  return `
<section class="hero tight">
  <p class="eyebrow reveal">Import-Vorschau · ${esc(filename)}</p>
  <h1 class="display" data-split>${rows.length} Zugangsdaten erkannt.</h1>
  <p class="sub reveal">Prüfen. Übernehmen.</p>
</section>

<section class="stats-row">
  ${stat(rows.length, 'Gültige Zeilen')}
  ${stat(assigned, 'Mit IServ')}
  ${stat(rows.length - assigned, 'Ohne IServ', rows.length - assigned ? 'is-warn' : '')}
  ${stat(errors.length, 'Übersprungen', errors.length ? 'is-warn' : '')}
</section>

${errors.length || warnings.length ? `
<section class="panel block reveal">
  <h3 class="h3">Hinweise.</h3>
  <ul class="issues">${errors.map((e) => `<li class="err">${esc(e)}</li>`).join('')}${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
</section>` : ''}

<section class="panel block reveal">
  <form method="post" action="/admin/import/confirm" class="confirm-form">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="token" value="${esc(token)}">
    <fieldset class="radio-cards">
      <legend class="h3">Wie übernehmen?</legend>
      <label><input type="radio" name="mode" value="merge" checked><span><strong>Ergänzen.</strong><small>Neue hinzufügen, gleiche Benutzernamen aktualisieren. Bisher: ${existingCount}.</small></span></label>
      <label><input type="radio" name="mode" value="replace"><span><strong>Ersetzen.</strong><small>Alles Bisherige wird durch diese Datei ersetzt.</small></span></label>
    </fieldset>
    <div class="actions">
      <a class="btn btn-ghost" href="/admin">Abbrechen</a>
      <button class="btn btn-primary magnetic" type="submit">${rows.length} Einträge übernehmen ${ICON.arrow}</button>
    </div>
  </form>
</section>

<section class="panel block reveal">
  <h3 class="h3">Vorschau${rows.length > 200 ? ' · erste 200' : ''}.</h3>
  <p class="muted small">Spalten: ${columns.map(esc).join(', ')}</p>
  <div class="table-wrap scroll"><table class="data compact">
    <thead><tr><th>Zeile</th><th>Name</th><th>Klasse</th><th>Benutzername</th><th>Passwort</th><th>IServ-Account</th></tr></thead>
    <tbody>${sample}</tbody>
  </table></div>
</section>`;
}
