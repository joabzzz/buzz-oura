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

async function encryptToken(token, owner, key) {
  if (!/^[a-f\d]{64}$/i.test(key)) throw new Error("Invalid encryption key");
  const bytes = Uint8Array.from(key.match(/../g), (value) =>
    parseInt(value, 16),
  );
  const encryptionKey = await crypto.subtle.importKey(
    "raw",
    bytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );
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
} = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.origin !== env.PUBLIC_ORIGIN)
        return reply("Page not found.", 404);
      const methods = {
        "/account": "GET",
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
            const action = account
              ? "/account/disconnect"
              : "/oauth/oura/start";
            const label = account
              ? "Disconnect from this Worker"
              : "Connect Oura";
            return reply(
              `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oura account</title><main><h1>Oura account</h1><p>${account ? "Connected. To revoke authorization at Oura, remove the app in your Oura account settings." : "Connect your Oura account to this deployment."}</p><form method="post" action="${action}"><button>${label}</button></form></main></html>`,
              200,
              { "Content-Type": "text/html; charset=utf-8" },
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
            const destination = new URL(authorizeUrl);
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

            const result = await exchange(tokenUrl, {
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
        return reply("The Oura service is temporarily unavailable.", 503);
      }
    },
  };
}

export default createWorker();
