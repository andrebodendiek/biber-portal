// Schlanker OpenID-Connect-Client für IServ (Authorization Code Flow + PKCE).
// Endpunkte kommen aus der Discovery: https://<iserv>/.well-known/openid-configuration

import crypto from 'node:crypto';
import * as jose from 'jose';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function createOidcClient(cfg) {
  let meta = null;
  let metaAt = 0;
  let jwks = null;

  async function discover() {
    if (meta && Date.now() - metaAt < 60 * 60 * 1000) return meta;
    const url = `${cfg.issuer}/.well-known/openid-configuration`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`IServ-Discovery fehlgeschlagen (${res.status}) unter ${url}`);
    meta = await res.json();
    metaAt = Date.now();
    jwks = jose.createRemoteJWKSet(new URL(meta.jwks_uri));
    return meta;
  }

  function pickAuthMethod(m) {
    if (cfg.tokenAuthMethod) return cfg.tokenAuthMethod;
    const supported = m.token_endpoint_auth_methods_supported || ['client_secret_basic'];
    return supported.includes('client_secret_basic') ? 'client_secret_basic' : 'client_secret_post';
  }

  /** Erzeugt die Weiterleitungs-URL zu IServ und die zu merkenden Prüfwerte. */
  async function beginLogin({ scope } = {}) {
    const m = await discover();
    const state = b64url(crypto.randomBytes(24));
    const nonce = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const url = new URL(m.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('scope', scope || cfg.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    if (cfg.usePkce) {
      url.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return { url: url.toString(), state, nonce, verifier };
  }

  /** Tauscht den Code gegen Tokens, prüft das ID-Token und liest die Userinfo. */
  async function finishLogin({ code, verifier, nonce }) {
    const m = await discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
    });
    if (cfg.usePkce) body.set('code_verifier', verifier);
    const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    if (pickAuthMethod(m) === 'client_secret_basic') {
      const cred = `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`;
      headers.authorization = `Basic ${Buffer.from(cred).toString('base64')}`;
    } else {
      body.set('client_id', cfg.clientId);
      body.set('client_secret', cfg.clientSecret);
    }

    const tokRes = await fetch(m.token_endpoint, { method: 'POST', headers, body });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token) {
      throw new Error(`Token-Abruf fehlgeschlagen (${tokRes.status}): ${tok.error_description || tok.error || 'unbekannt'}`);
    }

    let idClaims = {};
    if (tok.id_token) {
      const { payload } = await jose.jwtVerify(tok.id_token, jwks, {
        issuer: m.issuer,
        audience: cfg.clientId,
        clockTolerance: 60,
      });
      if (payload.nonce !== undefined && payload.nonce !== nonce) throw new Error('Ungültige Nonce im ID-Token.');
      idClaims = payload;
    }

    let userinfo = {};
    if (m.userinfo_endpoint) {
      const uiRes = await fetch(m.userinfo_endpoint, {
        headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/json' },
      });
      if (uiRes.ok) userinfo = await uiRes.json();
    }
    if (idClaims.sub && userinfo.sub && idClaims.sub !== userinfo.sub) {
      throw new Error('Userinfo gehört nicht zum angemeldeten Konto.');
    }
    return { ...idClaims, ...userinfo };
  }

  return { discover, beginLogin, finishLogin };
}
