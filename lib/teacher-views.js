// Ansichten für Lehrkräfte: eigene IServ-Gruppen und druckbare Zugangslisten.

import { esc, ICON } from './views.js';

const fmt = (iso) =>
  iso ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso)) : '–';

const PRINT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>`;
const CARDS = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/></svg>`;

export function teacherPage({ user, groups, settings }) {
  const { visible, hidden, at } = groups;
  const tiles = visible.map((g) => {
    const href = `/lehrkraft/druck/${encodeURIComponent(g.act)}`;
    const src = [
      g.sources.klasse ? `Klasse ${g.sources.klasse}` : '',
      g.sources.anmeldung ? `Anmeldung ${g.sources.anmeldung}` : '',
    ].filter(Boolean).join(' · ');
    return `
    <article class="tile group-tile spot reveal">
      <span class="k">${esc(g.act)}</span>
      <h3 class="h3">${esc(g.name)}</h3>
      <p class="group-count"><span data-countup="${g.count}">${g.count}</span><small>${g.count === 1 ? 'Zugang' : 'Zugänge'}</small></p>
      <p class="muted small">${esc(src)}</p>
      <div class="group-actions">
        <a class="btn btn-primary magnetic" href="${href}?layout=liste">${PRINT}Liste</a>
        <a class="btn btn-ghost" href="${href}?layout=karten">${CARDS}Karten</a>
      </div>
    </article>`;
  }).join('');

  const empty = !visible.length ? `
  <section class="panel empty spot reveal">
    <h2 class="h3">${user.groupsKnown === false ? 'Keine Gruppen von IServ erhalten.' : 'Keine passende Gruppe.'}</h2>
    <p>${user.groupsKnown === false
      ? 'IServ hat bei der Anmeldung keine Gruppen übermittelt. Die Biber-Koordination muss im IServ-Client den Scope <code>iserv:groups</code> freigeben.'
      : `Keine Ihrer IServ-Gruppen hat zwischen ${esc(settings.groupMin)} und ${esc(settings.groupMax)} Biber-Zugänge.`}</p>
    <p class="muted">Fehlt eine Lerngruppe? Bitte an die Biber-Koordination wenden.</p>
  </section>` : '';

  const hiddenList = hidden.length ? `
  <details class="hidden-groups reveal">
    <summary>${hidden.length} ${hidden.length === 1 ? 'Gruppe' : 'Gruppen'} ausgeblendet</summary>
    <p class="muted small">Angezeigt werden nur Gruppen mit ${esc(settings.groupMin)} bis ${esc(settings.groupMax)} Zugängen – so bleiben Fachschaften, AGs ohne Biber-Teilnahme und sehr große Gruppen (z. B. „Alle“) außen vor.</p>
    <ul>${hidden.map((g) => `<li><span>${esc(g.name)}</span><span class="muted">${esc(g.reason)}</span></li>`).join('')}</ul>
  </details>` : '';

  return `
<section class="hero tight">
  <p class="eyebrow reveal">Lehrkräfte · Gruppen laut IServ, Stand ${esc(fmt(at))}</p>
  <h1 class="display" data-split>Meine Gruppen.</h1>
  <p class="sub reveal">Zugangsdaten. Zum Austeilen.</p>
</section>
${empty}
${visible.length ? `<section class="group-grid">${tiles}</section>` : ''}
${hiddenList}
<section class="bento teacher-info">
  <article class="tile reveal">
    <span class="k">Woher</span>
    <ul class="bold-list">
      <li>Klasse.<span>Klassen-/Kursname im Biber-Export passt zum Gruppennamen.</span></li>
      <li>Anmeldung.<span>IServ hat die Gruppe bei der Anmeldung der Schülerin/des Schülers gemeldet.</span></li>
    </ul>
  </article>
  <article class="tile reveal">
    <span class="k">Vertraulich</span>
    <ul class="bold-list">
      <li>Nur Ihre Gruppen.<span>Grundlage ist Ihre aktuelle IServ-Mitgliedschaft.</span></li>
      <li>Protokolliert.<span>Jeder Abruf einer Liste wird vermerkt.</span></li>
    </ul>
  </article>
  <article class="tile reveal">
    <span class="k">Tipp</span>
    <ul class="bold-list">
      <li>Karten.<span>Zehn pro Seite – ausschneiden und austeilen.</span></li>
      <li>Neu angemeldet?<span>Gruppen aktualisieren sich bei Ihrer nächsten Anmeldung.</span></li>
    </ul>
  </article>
</section>`;
}

export function printPage({ group, layoutMode, user, settings }) {
  const host = (() => { try { return new URL(settings.loginUrl).host; } catch { return 'wettbewerb.informatik-biber.de'; } })();
  const href = `/lehrkraft/druck/${encodeURIComponent(group.act)}`;
  const now = new Date().toISOString();
  const nameOf = (c) => [c.lastName, c.firstName].filter(Boolean).join(', ') || '–';

  const list = `
    <table class="sheet-table">
      <thead><tr><th>Nr.</th><th>Name</th><th>Klasse</th><th>Benutzername</th><th>Passwort</th><th>Erhalten</th></tr></thead>
      <tbody>${group.credentials.map((c, i) => `
        <tr><td>${i + 1}</td><td>${esc(nameOf(c))}</td><td>${esc(c.className)}</td><td class="mono">${esc(c.username)}</td><td class="mono">${esc(c.password)}</td><td class="tick"><span></span></td></tr>`).join('')}
      </tbody>
    </table>
    <p class="sheet-foot">Anmeldung: <strong>${esc(host)}</strong> → „Anmelden“ → Benutzername und Passwort eingeben. Dieselben Daten gelten für Schnupper-Biber und Wettbewerb.</p>`;

  const cards = `
    <div class="cut-grid">${group.credentials.map((c) => `
      <section class="cut-card">
        <header><strong>Informatik-Biber 2026</strong><span>${esc(c.className)}</span></header>
        <p class="cut-name">${esc([c.firstName, c.lastName].filter(Boolean).join(' ') || '–')}</p>
        <dl>
          <dt>Benutzername</dt><dd class="mono">${esc(c.username)}</dd>
          <dt>Passwort</dt><dd class="mono">${esc(c.password)}</dd>
        </dl>
        <footer>${esc(host)} → „Anmelden“</footer>
      </section>`).join('')}
    </div>`;

  return `
<div class="print-toolbar reveal">
  <a class="link" href="/lehrkraft">‹ Meine Gruppen</a>
  <nav class="segmented" aria-label="Darstellung">
    <a href="${href}?layout=liste" class="${layoutMode === 'liste' ? 'on' : ''}">Liste</a>
    <a href="${href}?layout=karten" class="${layoutMode === 'karten' ? 'on' : ''}">Karten</a>
  </nav>
  <button class="btn btn-primary magnetic" type="button" data-print-page>${PRINT}Drucken</button>
</div>

<article class="sheet ${layoutMode === 'karten' ? 'sheet-cards' : ''} reveal">
  <header class="sheet-head">
    <div>
      <p class="sheet-kicker">Informatik-Biber 2026 · Zugangsdaten</p>
      <h1>${esc(group.name)}</h1>
      <p>${group.count} ${group.count === 1 ? 'Zugang' : 'Zugänge'}</p>
    </div>
    <div class="sheet-meta">
      <span>Erstellt von ${esc(user.name || user.account)}</span>
      <span>${esc(fmt(now))}</span>
      <strong>Vertraulich · nach Ausgabe vernichten</strong>
    </div>
  </header>
  ${layoutMode === 'karten' ? cards : list}
</article>`;
}

export { ICON };
