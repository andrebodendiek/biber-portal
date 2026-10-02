// Zentrale Konfiguration aus Umgebungsvariablen.
// Alle Geheimnisse kommen ausschließlich aus der Umgebung, nie aus dem Code.

import path from 'node:path';

function required(name, fallbackInDev) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (process.env.NODE_ENV !== 'production' && fallbackInDev !== undefined) return fallbackInDev;
  throw new Error(`Umgebungsvariable ${name} fehlt.`);
}

function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(v.toLowerCase());
}

export function normalizeAccount(value) {
  if (value === undefined || value === null) return '';
  let s = String(value).trim().toLowerCase();
  const at = s.indexOf('@');
  if (at > 0) s = s.slice(0, at); // "max.mustermann@schule.de" -> "max.mustermann"
  return s;
}

export function loadConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const baseUrl = required('BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');
  const issuer = required('ISERV_URL', 'http://localhost:4000').replace(/\/+$/, '');

  const cfg = {
    isProd,
    port: Number(process.env.PORT || 3000),
    baseUrl,
    trustProxy: process.env.TRUST_PROXY ?? (isProd ? '1' : ''),
    dataDir: path.resolve(process.env.DATA_DIR || './data'),

    // Schlüssel
    sessionSecret: required('SESSION_SECRET', 'dev-session-secret-bitte-in-produktion-aendern'),
    dataKey: required('DATA_KEY', 'dev-data-key-bitte-in-produktion-aendern'),

    // IServ / OpenID Connect
    oidc: {
      issuer,
      clientId: required('OIDC_CLIENT_ID', 'biber-portal'),
      clientSecret: required('OIDC_CLIENT_SECRET', 'dev-secret'),
      redirectUri: `${baseUrl}/auth/callback`,
      scope: process.env.OIDC_SCOPE || 'openid profile email iserv:groups',
      accountClaim: process.env.OIDC_ACCOUNT_CLAIM || 'preferred_username',
      tokenAuthMethod: process.env.OIDC_TOKEN_AUTH_METHOD || '', // leer = automatisch
      usePkce: bool('OIDC_PKCE', true),
    },

    // Admins: kommagetrennte IServ-Accountnamen
    admins: new Set(
      (process.env.ADMIN_ACCOUNTS || (isProd ? '' : 'andre.bodendiek'))
        .split(/[,;\s]+/)
        .map(normalizeAccount)
        .filter(Boolean)
    ),

    // IServ-Gruppe(n), deren Mitglieder als Lehrkraft gelten (act oder Name, kommagetrennt)
    teacherGroups: (process.env.TEACHER_GROUPS || 'lehrende')
      .split(/[,;]+/)
      .map((g) => g.trim())
      .filter(Boolean),

    schoolName: process.env.SCHOOL_NAME || 'Johann-Beckmann-Gymnasium Hoya',
    impressumUrl: process.env.IMPRESSUM_URL || '',
    datenschutzUrl: process.env.DATENSCHUTZ_URL || '',
    devLogin: !isProd && bool('DEV_LOGIN', false),
  };

  if (isProd) {
    if (cfg.sessionSecret.length < 32) throw new Error('SESSION_SECRET muss mindestens 32 Zeichen lang sein.');
    if (cfg.dataKey.length < 32) throw new Error('DATA_KEY muss mindestens 32 Zeichen lang sein.');
    if (cfg.admins.size === 0) console.warn('[config] ADMIN_ACCOUNTS ist leer – niemand kann den Admin-Bereich öffnen.');
  }
  return cfg;
}
