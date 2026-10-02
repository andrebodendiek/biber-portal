import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGroupsClaim, groupKey, isTeacher, resolveTeacherGroups } from '../lib/groups.js';

test('parseGroupsClaim liest IServ-Format, Strings und Dubletten', () => {
  const g = parseGroupsClaim({ 'iserv:groups': [
    { id: 1, act: 'Klasse.7b', name: 'Klasse 7b' },
    { id: 2, act: 'klasse.7b', name: 'doppelt' },
    'lehrende',
  ] });
  assert.deepEqual(g, [{ act: 'klasse.7b', name: 'Klasse 7b' }, { act: 'lehrende', name: 'lehrende' }]);
  assert.deepEqual(parseGroupsClaim({}), []);
});

test('groupKey vereinheitlicht Klassenbezeichnungen', () => {
  for (const s of ['7b', 'Klasse 7b', 'klasse.7b', 'Kl. 07b', 'KLASSE-7B', '7 b']) assert.equal(groupKey(s), '7b', s);
  assert.equal(groupKey('Informatik 10 (Bod)'), 'informatik10bod');
  assert.notEqual(groupKey('Jahrgang 10'), groupKey('10a'));
});

test('isTeacher prüft act und Namen', () => {
  assert.ok(isTeacher([{ act: 'lehrende', name: 'Lehrende' }]));
  assert.ok(isTeacher([{ act: 'x', name: 'Lehrende' }]));
  assert.ok(!isTeacher([{ act: 'schueler', name: 'Schüler' }]));
  assert.ok(isTeacher([{ act: 'kollegium', name: 'Kollegium' }], ['Kollegium']));
});

const cred = (id, className, account, lastName = id) => ({ id, username: `biber-${id}`, password: 'pw', className, account, lastName, firstName: '' });

test('resolveTeacherGroups: Klasse + Anmeldung, Grenzen, Ignorieren', () => {
  const credentials = [
    cred('a', '7b', 'a.a'), cred('b', '7b', ''), cred('c', 'Klasse 7b', 'c.c'),
    cred('d', '9a', 'd.d'), cred('e', '9a', 'e.e'),
    cred('f', '', 'f.f'), cred('g', '', 'g.g'), cred('h', '', 'h.h'),
  ];
  // Informatik-Kurs nur über Anmeldungen bekannt; Schüler:innen der 9a melden die Kursgruppe
  const memberships = {
    'f.f': { groups: [{ act: 'informatik.11', name: 'Informatik 11' }] },
    'g.g': { groups: [{ act: 'informatik.11', name: 'Informatik 11' }] },
    'h.h': { groups: [{ act: 'informatik.11', name: 'Informatik 11' }] },
    'a.a': { groups: [{ act: 'klasse.7b', name: 'Klasse 7b' }] }, // doppelt (Klasse + Anmeldung) → nur einmal zählen
    'x.x': { groups: [{ act: 'informatik.11', name: 'Informatik 11' }] }, // ohne Zugang → zählt nicht
  };
  const teacherGroups = [
    { act: 'lehrende', name: 'Lehrende' },
    { act: 'klasse.7b', name: 'Klasse 7b' },
    { act: 'klasse.9a', name: 'Klasse 9a' },
    { act: 'informatik.11', name: 'Informatik 11' },
    { act: 'fachschaft.mathe', name: 'Fachschaft Mathematik' },
    { act: 'ag.robotik', name: 'Robotik-AG' },
  ];
  const settings = { groupMin: 3, groupMax: 40, groupIgnore: 'Robotik-AG', matchByClass: true, matchByLogin: true };
  const { visible, hidden } = resolveTeacherGroups({ teacherGroups, credentials, memberships, settings });

  assert.deepEqual(visible.map((g) => [g.name, g.count]), [['Informatik 11', 3], ['Klasse 7b', 3]]);
  const k7 = visible.find((g) => g.act === 'klasse.7b');
  assert.equal(k7.sources.klasse, 3);
  assert.equal(k7.sources.anmeldung, 1);
  assert.deepEqual(hidden.map((g) => [g.name, g.count]), [['Klasse 9a', 2], ['Fachschaft Mathematik', 0]]);
  assert.ok(!hidden.some((g) => g.act === 'lehrende' || g.act === 'ag.robotik'));

  // Obergrenze
  const big = resolveTeacherGroups({ teacherGroups, credentials, memberships, settings: { ...settings, groupMax: 2, groupMin: 1 } });
  assert.ok(big.hidden.find((g) => g.act === 'klasse.7b').reason.includes('mehr als 2'));

  // Quelle „Klasse“ abgeschaltet
  const loginOnly = resolveTeacherGroups({ teacherGroups, credentials, memberships, settings: { ...settings, matchByClass: false, groupMin: 1 } });
  assert.equal(loginOnly.visible.find((g) => g.act === 'klasse.7b').count, 1);
});

test('Gruppen mit Mitgliedern aus zu vielen Klassen werden ausgeblendet', () => {
  const credentials = ['5a', '6b', '7c', '8d'].map((k, i) => ({ id: `x${i}`, username: `u${i}`, password: 'p', className: k, account: `a.${i}`, lastName: `N${i}` }));
  const memberships = Object.fromEntries(credentials.map((c) => [c.account, { groups: [{ act: 'alle', name: 'Alle' }, { act: 'ag.robotik', name: 'AG Robotik' }] }]));
  const teacherGroups = [{ act: 'alle', name: 'Alle' }, { act: 'ag.robotik', name: 'AG Robotik' }];
  const base = { groupMin: 1, groupMax: 40, groupMaxClasses: 3, groupIgnore: 'Alle', matchByClass: true, matchByLogin: true };
  const r = resolveTeacherGroups({ teacherGroups, credentials, memberships, settings: base });
  assert.equal(r.visible.length, 0);
  assert.match(r.hidden.find((g) => g.act === 'ag.robotik').reason, /aus 4 Klassen/);
  assert.ok(!r.hidden.some((g) => g.act === 'alle')); // ignoriert
  const off = resolveTeacherGroups({ teacherGroups, credentials, memberships, settings: { ...base, groupMaxClasses: 0 } });
  assert.deepEqual(off.visible.map((g) => g.act), ['ag.robotik']);
});

test('classTokens findet Klassenkennungen per RegExp', async () => {
  const { classTokens } = await import('../lib/groups.js');
  assert.deepEqual(classTokens('Klasse 7b (Mü)'), ['7b']);
  assert.deepEqual(classTokens('Klassenleitung 7 b'), ['7b']);
  assert.deepEqual(classTokens('Kl. 07b'), ['7b']);
  assert.deepEqual(classTokens('10 a / 10b'), ['10a', '10b']);
  assert.deepEqual(classTokens('Informatik 11'), ['11']);
  assert.deepEqual(classTokens('Q1'), []);
  assert.deepEqual(classTokens('AG2026'), []);
});

test('tolerante Zuordnung: Gruppe „Klasse 7b (Mü)“ findet Zugänge der „7b“, aber „Informatik 11“ nicht den ganzen Jahrgang', () => {
  const credentials = [
    ...['a', 'b', 'c', 'd'].map((x) => cred(`7b-${x}`, '7b', '')),
    ...['a', 'b', 'c'].map((x) => cred(`7c-${x}`, '7 c Bio', '')),
    ...['a', 'b', 'c', 'd', 'e'].map((x) => cred(`11-${x}`, '11', '')),
  ];
  const teacherGroups = [
    { act: 'klasse-7b-mue', name: 'Klasse 7b (Mü)' },
    { act: 'kl7c', name: 'Klassenleitung 7c' },
    { act: 'informatik-11', name: 'Informatik 11' },
    { act: 'wpk-7b-7c', name: 'WPK 7b/7c' }, // nennt zwei Klassen → kein RegExp-Treffer
  ];
  const settings = { groupMin: 3, groupMax: 40, groupMaxClasses: 3, groupIgnore: '', matchByClass: true, matchByLogin: true };
  const { visible, hidden } = resolveTeacherGroups({ teacherGroups, credentials, memberships: {}, settings });
  assert.deepEqual(visible.map((g) => [g.name, g.count]), [['Klasse 7b (Mü)', 4], ['Klassenleitung 7c', 3]]);
  assert.equal(hidden.find((g) => g.act === 'informatik-11').count, 0);
  assert.equal(hidden.find((g) => g.act === 'wpk-7b-7c').count, 0);
});
