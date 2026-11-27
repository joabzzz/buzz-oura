import { createRemoteJWKSet, jwtVerify } from "jose";

const authorizeUrl = "https://cloud.ouraring.com/oauth/authorize";
const tokenUrl = "https://api.ouraring.com/oauth/token";
const encoder = new TextEncoder();

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function reply(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...headers, ...extra } });
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function hash(value) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

function bytesFromHex(value) {
  return Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16));
}

async function importTokenKey(key) {
  if (!/^[a-f\d]{64}$/i.test(key)) throw new Error("Invalid encryption key");
  return crypto.subtle.importKey("raw", bytesFromHex(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptToken(token, owner, key) {
  const encryptionKey = await importTokenKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(owner) },
    encryptionKey,
    encoder.encode(JSON.stringify(token)),
  );
  return JSON.stringify({
    version: 1,
    iv: hex(iv),
    ciphertext: hex(new Uint8Array(ciphertext)),
  });
}

async function readToken(stored, owner, key) {
  const envelope = JSON.parse(stored);
  if (envelope.version !== 1) throw new Error("Unknown token envelope");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytesFromHex(envelope.iv),
      additionalData: encoder.encode(owner),
    },
    await importTokenKey(key),
    bytesFromHex(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function providerEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid Oura endpoint");
  return url.href;
}

const accountStyle = `<style>
  :root { color-scheme: light dark; font: 1rem/1.55 system-ui, sans-serif; }
  main { max-width: 34rem; margin: 12vh auto; padding: 1.5rem; }
  h1 { margin: 0 0 .5rem; line-height: 1.15; }
  .badge { display: inline-block; border: 1px solid; border-radius: 2rem; padding: .15rem .65rem; font-weight: 600; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; }
  button, .action { display: inline-block; font: inherit; font-weight: 600; padding: .45rem .8rem; border: 1px solid; border-radius: .5rem; cursor: pointer; }
  button { background: CanvasText; color: Canvas; }
  .action { color: inherit; text-decoration: none; }
</style>`;
const accountPageHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": headers["Content-Security-Policy"] + "; style-src 'unsafe-inline'",
};

function accountPage(title, badge, message, actions, status = 200) {
  return reply(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${accountStyle}<main><h1>${title}</h1><span class="badge">${badge}</span><p>${message}</p><div class="actions">${actions}</div></main></html>`,
    status,
    accountPageHeaders,
  );
}

function connectionStatus(message, status = 200, badge = "Test failed") {
  return accountPage(
    "Oura connection status",
    badge,
    message,
    '<a class="action" href="/account">Manage Oura account</a>',
    status,
  );
}

let keySet;
let keySetIssuer;
async function verifyOwner(request, env) {
  const issuer = new URL(env.ACCESS_ISSUER);
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.origin) ||
    issuer.href !== issuer.origin + "/" ||
    !env.ACCESS_AUDIENCE
  )
    return null;
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return null;
  if (issuer.origin !== keySetIssuer) {
    keySet = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    keySetIssuer = issuer.origin;
  }
  const { payload } = await jwtVerify(assertion, keySet, {
    issuer: issuer.origin,
    audience: env.ACCESS_AUDIENCE,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
}

export function createWorker({
  authenticate = verifyOwner,
  exchange = fetch,
  fetchOura = fetch,
} = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.origin !== env.PUBLIC_ORIGIN)
        return reply("Page not found.", 404);
      const methods = {
        "/account": "GET",
        "/account/status": "GET",
        "/oauth/oura/start": "POST",
        "/oauth/oura/callback": "GET",
        "/account/disconnect": "POST",
      };
      if (!Object.hasOwn(methods, url.pathname))
        return reply("Page not found.", 404);
      if (request.method !== methods[url.pathname])
        return reply("Method not allowed.", 405, {
          Allow: methods[url.pathname],
        });
      if (
        request.method === "POST" &&
        request.headers.get("Origin") !== url.origin
      )
        return reply("Request origin denied.", 403);

      let owner;
      try {
        owner = await authenticate(request, env);
      } catch {
        owner = null;
      }
      if (!owner) return reply("Sign in through Cloudflare Access.", 401);

      const db = env.OURA_DB;
      const callback = new URL("/oauth/oura/callback", url.origin).href;
      try {
        switch (url.pathname) {
          case "/account": {
            const account = await db
              .prepare("SELECT 1 FROM oura_connections WHERE owner = ?")
              .bind(owner)
              .first();
            const action = account ? "/account/disconnect" : "/oauth/oura/start";
            const label = account ? "Disconnect Oura" : "Sign in to Oura";
            const test = account ? '<a class="action" href="/account/status">Test connection</a>' : "";
            return accountPage(
              "Oura account",
              account ? "Account linked" : "Disconnected",
              account ? "Test your connection to check whether Oura accepts API requests." : "Sign in to link your Oura account.",
              `<form method="post" action="${action}"><button>${label}</button></form>${test}`,
            );
          }
          case "/account/status": {
            const account = await db
              .prepare(
                "SELECT token_envelope FROM oura_connections WHERE owner = ?",
              )
              .bind(owner)
              .first();
            if (!account) return connectionStatus("No Oura account is linked.", 200, "Disconnected");
            const token = await readToken(
              account.token_envelope,
              owner,
              env.OURA_TOKEN_KEY,
            );
            if (token.expiresAt <= Date.now())
              return connectionStatus(
                "The Oura token expired. Reconnect your Oura account.",
                409,
                "Reconnect required",
              );

            const apiBase = providerEndpoint(
              env.OURA_API_BASE_URL || "https://api.ouraring.com/v2",
            );
            const endpoint = new URL(
              "usercollection/daily_sleep",
              apiBase.endsWith("/") ? apiBase : apiBase + "/",
            );
            const day = new Date().toISOString().slice(0, 10);
            endpoint.search = new URLSearchParams({
              start_date: day,
              end_date: day,
            });
            const result = await fetchOura(endpoint, {
              headers: { Authorization: `Bearer ${token.accessToken}` },
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
            });
            await result.body?.cancel();
            if (result.ok)
              return connectionStatus(
                "Oura accepted the API request.", 200, "Connected",
              );
            if (result.status === 401 || result.status === 403)
              return connectionStatus(
                "Oura rejected the token or its permissions. Reconnect your Oura account.",
                409,
                "Reconnect required",
              );
            return connectionStatus(
              "Oura could not complete the test. Try again later.",
              502,
            );
          }
          case "/account/disconnect":
            await db.batch([
              db
                .prepare("DELETE FROM oura_oauth_pending WHERE owner = ?")
                .bind(owner),
              db
                .prepare("DELETE FROM oura_connections WHERE owner = ?")
                .bind(owner),
            ]);
            return reply(null, 303, { Location: "/account" });
          case "/oauth/oura/start": {
            if (
              !env.OURA_CLIENT_ID ||
              !env.OURA_CLIENT_SECRET ||
              !/^[a-f\d]{64}$/i.test(env.OURA_TOKEN_KEY)
            )
              return reply("Oura credentials are unavailable.", 503);
            const state = hex(crypto.getRandomValues(new Uint8Array(32)));
            await db
              .prepare(
                `INSERT INTO oura_oauth_pending (owner, state_hash, expires)
              VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET
              state_hash = excluded.state_hash, expires = excluded.expires, claimed = 0`,
              )
              .bind(owner, await hash(state), Date.now() + 600_000)
              .run();
            const destination = new URL(providerEndpoint(env.OURA_AUTHORIZE_URL || authorizeUrl));
            destination.search = new URLSearchParams({
              response_type: "code",
              client_id: env.OURA_CLIENT_ID,
              redirect_uri: callback,
              scope: "daily",
              state,
            }).toString();
            return reply(null, 303, { Location: destination.href });
          }
          case "/oauth/oura/callback": {
            const state = url.searchParams.get("state") || "";
            const code = url.searchParams.get("code") || "";
            if (!/^[a-f\d]{64}$/.test(state))
              return reply("Invalid Oura authorization.", 400);
            const stateHash = await hash(state);
            const claimed = await db
              .prepare(
                `UPDATE oura_oauth_pending SET claimed = 1
              WHERE owner = ? AND state_hash = ? AND expires > ? AND claimed = 0 RETURNING owner`,
              )
              .bind(owner, stateHash, Date.now())
              .first();
            if (!claimed)
              return reply(
                "Oura authorization expired or was already used.",
                400,
              );
            if (url.searchParams.has("error") || !code || code.length > 4096)
              return reply(
                "Oura authorization was not completed. Return to your account to retry.",
                400,
              );

            const result = await exchange(providerEndpoint(env.OURA_TOKEN_URL || tokenUrl), {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: callback,
                client_id: env.OURA_CLIENT_ID,
                client_secret: env.OURA_CLIENT_SECRET,
              }),
            });
            if (!result.ok)
              return reply(
                "Oura rejected the authorization. Return to your account to retry.",
                502,
              );
            const token = await result.json();
            if (
              typeof token.access_token !== "string" ||
              !token.access_token ||
              typeof token.refresh_token !== "string" ||
              !token.refresh_token ||
              !Number.isFinite(token.expires_in) ||
              token.expires_in <= 0
            )
              return reply("Oura returned an invalid token response.", 502);
            const envelope = await encryptToken(
              {
                accessToken: token.access_token,
                refreshToken: token.refresh_token,
                expiresAt: Date.now() + token.expires_in * 1000,
              },
              owner,
              env.OURA_TOKEN_KEY,
            );

            // A newer start or disconnect invalidates the in-flight exchange.
            const [stored] = await db.batch([
              db
                .prepare(
                  `INSERT INTO oura_connections (owner, token_envelope)
                SELECT owner, ? FROM oura_oauth_pending WHERE owner = ? AND state_hash = ?
                ON CONFLICT(owner) DO UPDATE SET token_envelope = excluded.token_envelope`,
                )
                .bind(envelope, owner, stateHash),
              db
                .prepare(
                  "DELETE FROM oura_oauth_pending WHERE owner = ? AND state_hash = ?",
                )
                .bind(owner, stateHash),
            ]);
            if (!stored.meta.changes)
              return reply("Oura authorization was superseded.", 409);
            return reply(null, 303, { Location: "/account" });
          }
        }
      } catch {
        if (url.pathname === "/account/status")
          return connectionStatus(
            "The connection could not be checked. Try again later.",
            503,
          );
        return reply("The Oura service is temporarily unavailable.", 503);
      }
    },
  };
}

export default createWorker();
