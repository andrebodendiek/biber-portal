// Lokaler Test-Anmeldeserver, der die OpenID-Connect-Schnittstelle von IServ nachbildet.
// Nur für Entwicklung und Tests!  Start: npm run mock-iserv  (Port 4000)

import express from 'express';
import crypto from 'node:crypto';
import * as jose from 'jose';

const PORT = Number(process.env.MOCK_PORT || 4000);
const CLIENT_ID = process.env.OIDC_CLIENT_ID || 'biber-portal';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || 'dev-secret';

const G = (act, name) => ({ id: Math.abs([...act].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)), act, name });
const GROUPS = {
  alle: G('alle', 'Alle'),
  schueler: G('schueler', 'Schülerinnen und Schüler'),
  lehrende: G('lehrende', 'Lehrende'),
  k10a: G('klasse.10a', 'Klasse 10a'),
  k8c: G('klasse.8c', 'Klasse 8c'),
  inf10: G('informatik.10', 'Informatik 10'),
  fsinf: G('fachschaft.informatik', 'Fachschaft Informatik'),
};

export const USERS = [
  { preferred_username: 'max.mustermann', given_name: 'Max', family_name: 'Mustermann', role: 'Schüler', groups: [GROUPS.alle, GROUPS.schueler, GROUPS.k10a, GROUPS.inf10] },
  { preferred_username: 'erika.musterfrau', given_name: 'Erika', family_name: 'Musterfrau', role: 'Schülerin', groups: [GROUPS.alle, GROUPS.schueler, GROUPS.k10a] },
  { preferred_username: 'lena.ohnedaten', given_name: 'Lena', family_name: 'Ohnedaten', role: 'Schülerin (ohne Biber-Daten)', groups: [GROUPS.alle, GROUPS.schueler, GROUPS.k8c] },
  { preferred_username: 'tina.lehrerin', given_name: 'Tina', family_name: 'Lehrerin', role: 'Lehrkraft (Klasse 10a, Informatik 10)', groups: [GROUPS.alle, GROUPS.lehrende, GROUPS.k10a, GROUPS.inf10, GROUPS.fsinf] },
  { preferred_username: 'andre.bodendiek', given_name: 'André', family_name: 'Bodendiek', role: 'Lehrkraft (Admin)', groups: [GROUPS.alle, GROUPS.lehrende, GROUPS.k8c, GROUPS.inf10, GROUPS.fsinf] },
];

export async function startMock(port = PORT) {
  const ISSUER = process.env.MOCK_ISSUER || `http://localhost:${port}`;
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'mock-1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const tokens = new Map();

  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/.well-known/openid-configuration', (req, res) => res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/iserv/auth/auth`,
    token_endpoint: `${ISSUER}/iserv/auth/public/token`,
    userinfo_endpoint: `${ISSUER}/iserv/auth/userinfo`,
    jwks_uri: `${ISSUER}/iserv/auth/public/jwk`,
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
  }));

  app.get('/iserv/auth/public/jwk', (req, res) => res.json({ keys: [jwk] }));

  app.get('/iserv/auth/auth', (req, res) => {
    const q = req.query;
    if (q.client_id !== CLIENT_ID) return res.status(400).send('unbekannter client_id');
    const hidden = ['redirect_uri', 'state', 'nonce', 'code_challenge', 'code_challenge_method', 'scope']
      .map((k) => `<input type="hidden" name="${k}" value="${String(q[k] ?? '').replace(/"/g, '&quot;')}">`).join('');
    res.send(`<!doctype html><meta charset="utf-8"><title>Mock-IServ</title>
      <style>body{font:16px system-ui;background:#1d4f91;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}
      form{background:#fff;color:#111;padding:28px;border-radius:12px;width:340px}button{display:block;width:100%;margin:8px 0;padding:12px;border:1px solid #ccc;border-radius:8px;background:#f5f7fb;cursor:pointer;text-align:left}
      small{color:#666}</style>
      <form method="post" action="/iserv/auth/auth">${hidden}<h2>Mock-IServ</h2><p>Als wer möchten Sie sich anmelden?</p>
      ${USERS.map((u) => `<button name="user" value="${u.preferred_username}">${u.given_name} ${u.family_name}<br><small>${u.preferred_username} · ${u.role}</small></button>`).join('')}
      </form>`);
  });

  app.post('/iserv/auth/auth', (req, res) => {
    const user = USERS.find((u) => u.preferred_username === req.body.user);
    if (!user) return res.status(400).send('unbekannter Nutzer');
    const code = crypto.randomBytes(16).toString('hex');
    codes.set(code, { ...req.body, user, at: Date.now() });
    const url = new URL(req.body.redirect_uri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', req.body.state);
    res.redirect(url.toString());
  });

  app.post('/iserv/auth/public/token', async (req, res) => {
    let id = req.body.client_id, secret = req.body.client_secret;
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Basic ')) {
      const [a, b] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      id = decodeURIComponent(a); secret = decodeURIComponent(b);
    }
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return res.status(401).json({ error: 'invalid_client' });
    const c = codes.get(req.body.code);
    codes.delete(req.body.code);
    if (!c || Date.now() - c.at > 60000) return res.status(400).json({ error: 'invalid_grant' });
    if (c.redirect_uri !== req.body.redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri' });
    if (c.code_challenge) {
      const calc = crypto.createHash('sha256').update(req.body.code_verifier || '').digest('base64url');
      if (calc !== c.code_challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE' });
    }
    const sub = crypto.createHash('sha256').update(c.user.preferred_username).digest('hex').slice(0, 24);
    const access = crypto.randomBytes(24).toString('hex');
    tokens.set(access, { sub, user: c.user });
    const idToken = await new jose.SignJWT({ nonce: c.nonce, preferred_username: c.user.preferred_username })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-1' })
      .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject(sub)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey);
    res.json({ access_token: access, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });

  app.get('/iserv/auth/userinfo', (req, res) => {
    const t = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!t) return res.status(401).json({ error: 'invalid_token' });
    const u = t.user;
    res.json({
      sub: t.sub,
      preferred_username: u.preferred_username,
      name: `${u.given_name} ${u.family_name}`,
      given_name: u.given_name,
      family_name: u.family_name,
      email: `${u.preferred_username}@mock-iserv.test`,
      'iserv:groups': u.groups,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Mock-IServ läuft auf ${ISSUER}`);
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) startMock();
