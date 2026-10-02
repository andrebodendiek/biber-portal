// IServ-Gruppen: Claims lesen, Lehrende erkennen, Zugänge einer Gruppe ermitteln.
//
// IServ liefert über den Scope „iserv:groups“ nur die Gruppen der angemeldeten Person –
// eine Schnittstelle „Mitglieder einer Gruppe“ gibt es nicht. Die Mitglieder einer Gruppe
// ermitteln wir deshalb aus zwei Quellen:
//   1. Klasse:    Klassen-/Kursname aus dem Biber-Export ↔ Gruppenname in IServ
//                 („Klasse 7b“, „klasse.7b“, „7b“ … gelten als gleich).
//   2. Anmeldung: Gruppen, die IServ bei der Anmeldung einer Schülerin/eines Schülers meldet.
// Gruppen mit zu wenigen oder zu vielen Zugängen werden ausgeblendet, ebenso Gruppen,
// deren Mitglieder aus zu vielen verschiedenen Klassen stammen (typisch für „Alle“ & Co.,
// die über die Quelle „Anmeldung“ langsam wachsen und anfangs unter der Höchstzahl liegen).

export const DEFAULT_TEACHER_GROUPS = ['lehrende'];

/** Liest die Gruppenliste aus den OIDC-Claims (robust gegen verschiedene Formate). */
export function parseGroupsClaim(claims) {
  const raw = claims?.['iserv:groups'] ?? claims?.groups ?? [];
  const list = Array.isArray(raw) ? raw : typeof raw === 'object' && raw ? Object.values(raw) : [];
  const out = [];
  const seen = new Set();
  for (const g of list) {
    let act = '', name = '';
    if (typeof g === 'string') { act = g; name = g; }
    else if (g && typeof g === 'object') {
      act = String(g.act ?? g.id ?? g.name ?? '');
      name = String(g.name ?? g.displayName ?? g.act ?? '');
    }
    act = act.trim().toLowerCase();
    name = name.trim();
    if (!act || seen.has(act)) continue;
    seen.add(act);
    out.push({ act: act.slice(0, 120), name: (name || act).slice(0, 160) });
    if (out.length >= 500) break;
  }
  return out;
}

const fold = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/** Gruppen-/Klassenbezeichnung auf einen Vergleichsschlüssel bringen: „Klasse 07b“ → „7b“. */
export function groupKey(s) {
  let k = fold(s)
    .replace(/[._\-/]+/g, ' ')
    .replace(/\b(klasse|klassen|kl|jahrgang|jahrgangsstufe|jg|stufe)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  k = k.replace(/(^|[a-z])0+(\d)/g, '$1$2'); // führende Nullen: 07b → 7b
  return k;
}

/** Gehört die Person zu einer der Lehrenden-Gruppen? (Abgleich über act oder Name) */
export function isTeacher(groups, teacherGroups = DEFAULT_TEACHER_GROUPS) {
  const wanted = new Set(teacherGroups.map((t) => fold(t).trim()).filter(Boolean));
  return groups.some((g) => wanted.has(fold(g.act)) || wanted.has(fold(g.name)));
}

function splitList(s) {
  return String(s ?? '').split(/[,;\n]+/).map((x) => fold(x).trim()).filter(Boolean);
}

/**
 * Ermittelt für die Gruppen einer Lehrkraft die zugehörigen Zugänge.
 * @returns {{ visible: Array, hidden: Array }}
 *   jeweils { act, name, count, credentials, sources: {klasse, anmeldung}, reason? }
 */
export function resolveTeacherGroups({ teacherGroups, credentials, memberships, settings, teacherGroupNames = DEFAULT_TEACHER_GROUPS }) {
  const min = Math.max(1, Number(settings.groupMin) || 1);
  const max = Math.max(min, Number(settings.groupMax) || 9999);
  const maxClasses = Math.max(0, Number(settings.groupMaxClasses) || 0); // 0 = keine Prüfung
  const byClass = settings.matchByClass !== false;
  const byLogin = settings.matchByLogin !== false;
  const ignore = new Set([...splitList(settings.groupIgnore), ...teacherGroupNames.map(fold)]);

  // Indizes einmal aufbauen
  const classIndex = new Map(); // groupKey(className) -> [cred]
  const accountIndex = new Map(); // account -> cred
  for (const c of credentials) {
    if (c.className) {
      const k = groupKey(c.className);
      if (k.length >= 1) {
        if (!classIndex.has(k)) classIndex.set(k, []);
        classIndex.get(k).push(c);
      }
    }
    if (c.account) accountIndex.set(c.account, c);
  }
  const loginIndex = new Map(); // act -> Set(account)
  if (byLogin) {
    for (const [account, m] of Object.entries(memberships || {})) {
      if (!accountIndex.has(account)) continue;
      for (const g of m.groups || []) {
        if (!loginIndex.has(g.act)) loginIndex.set(g.act, new Set());
        loginIndex.get(g.act).add(account);
      }
    }
  }

  const visible = [];
  const hidden = [];
  for (const g of teacherGroups) {
    if (ignore.has(fold(g.act)) || ignore.has(fold(g.name))) continue; // stillschweigend ignorieren
    const members = new Map(); // credId -> { cred, via:Set }
    const add = (cred, via) => {
      if (!members.has(cred.id)) members.set(cred.id, { cred, via: new Set() });
      members.get(cred.id).via.add(via);
    };
    if (byClass) {
      const keys = new Set([groupKey(g.name), groupKey(g.act)].filter((k) => k.length >= 2 && /\d/.test(k)));
      for (const k of keys) for (const c of classIndex.get(k) || []) add(c, 'klasse');
    }
    if (byLogin) for (const acc of loginIndex.get(g.act) || []) add(accountIndex.get(acc), 'anmeldung');

    const list = [...members.values()];
    const entry = {
      act: g.act,
      name: g.name,
      count: list.length,
      credentials: list.map((m) => m.cred).sort(byName),
      sources: {
        klasse: list.filter((m) => m.via.has('klasse')).length,
        anmeldung: list.filter((m) => m.via.has('anmeldung')).length,
      },
    };
    entry.classes = new Set(entry.credentials.map((c) => groupKey(c.className)).filter(Boolean)).size;
    if (entry.count < min) hidden.push({ ...entry, credentials: [], reason: entry.count === 0 ? 'keine Zugänge' : `nur ${entry.count} – Grenze ${min}` });
    else if (entry.count > max) hidden.push({ ...entry, credentials: [], reason: `${entry.count} – mehr als ${max}` });
    // Schutz für Gruppen, die nur über Anmeldungen wachsen (z. B. „Alle“): Mitglieder aus zu vielen Klassen
    else if (maxClasses && entry.classes > maxClasses) hidden.push({ ...entry, credentials: [], reason: `${entry.count} aus ${entry.classes} Klassen – mehr als ${maxClasses}` });
    else visible.push(entry);
  }
  const byGroupName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });
  visible.sort(byGroupName);
  hidden.sort((a, b) => b.count - a.count || byGroupName(a, b));
  return { visible, hidden };
}

export function byName(a, b) {
  return (a.lastName || '').localeCompare(b.lastName || '', 'de') ||
    (a.firstName || '').localeCompare(b.firstName || '', 'de') ||
    a.username.localeCompare(b.username, 'de');
}
