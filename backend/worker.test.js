import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createWorker } from "./worker.js";

const origin = "https://oura.example.com";
const callback = "/oauth/oura/callback";
const key = "12".repeat(32);

function fixture(exchange, fetchOura) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_oura.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => sqlite.prepare(sql).get(...args),
            run: () => ({ meta: sqlite.prepare(sql).run(...args) }),
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const worker = createWorker({
    authenticate: (request) => request.headers.get("test-owner"),
    exchange,
    fetchOura,
  });
  const env = {
    PUBLIC_ORIGIN: origin,
    OURA_DB: db,
    OURA_CLIENT_ID: "test-id",
    OURA_CLIENT_SECRET: "test-secret",
    OURA_TOKEN_KEY: key,
  };
  return {
    sqlite,
    send(path, { owner = "alice", method = "GET", source = origin } = {}) {
      return worker.fetch(
        new Request(origin + path, {
          method,
          headers: { Origin: source, "test-owner": owner },
        }),
        env,
      );
    },
  };
}

const token = () =>
  Response.json({
    access_token: "access-token-test",
    refresh_token: "refresh-token-test",
    expires_in: 3600,
  });

async function authorize(send) {
  const start = await send("/oauth/oura/start", { method: "POST" });
  assert.equal(start.status, 200);
  const html = await start.text();
  const href = html.match(/href="([^"]+)">Open Oura sign-in/)[1];
  assert.ok(html.includes(`content="0;url=${href}"`));
  const redirect = new URL(href.replaceAll("&amp;", "&"));
  assert.equal(redirect.origin, "https://cloud.ouraring.com");
  assert.equal(redirect.searchParams.get("redirect_uri"), origin + callback);
  assert.ok(!redirect.href.includes("test-secret"));
  return (
    callback + "?code=test-code&state=" + redirect.searchParams.get("state")
  );
}

test("authenticates, binds callback to the initiating account, encrypts tokens, and consumes state", async () => {
  let exchanges = 0;
  const { send, sqlite } = fixture(async (url, options) => {
    exchanges++;
    assert.equal(url, "https://api.ouraring.com/oauth/token");
    assert.equal(options.redirect, "manual");
    assert.equal(options.body.get("client_secret"), "test-secret");
    assert.equal(options.body.get("code"), "test-code");
    return token();
  });
  assert.equal((await send("/account", { owner: "" })).status, 401);
  assert.equal(
    (
      await send("/oauth/oura/start", {
        method: "POST",
        source: "https://elsewhere.example",
      })
    ).status,
    403,
  );
  const path = await authorize(send);
  assert.equal((await send(path, { owner: "bob" })).status, 400);
  assert.equal((await send(path)).status, 303);
  assert.equal((await send(path)).status, 400);
  assert.equal(exchanges, 1);
  const row = sqlite.prepare("SELECT * FROM oura_connections").get();
  assert.equal(row.owner, "alice");
  assert.ok(!row.token_envelope.includes("access-token-test"));
  const envelope = JSON.parse(row.token_envelope);
  const decryptionKey = await crypto.subtle.importKey(
    "raw",
    Buffer.from(key, "hex"),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Buffer.from(envelope.iv, "hex"),
      additionalData: Buffer.from("alice"),
    },
    decryptionKey,
    Buffer.from(envelope.ciphertext, "hex"),
  );
  assert.equal(
    JSON.parse(new TextDecoder().decode(plaintext)).refreshToken,
    "refresh-token-test",
  );
  assert.match(await (await send("/account")).text(), /Account linked/);
  assert.doesNotMatch(
    await (await send("/account", { owner: "bob" })).text(),
    /Account linked/,
  );
  assert.equal(
    (await send("/account/disconnect", { method: "POST" })).status,
    303,
  );
  assert.equal(
    sqlite.prepare("SELECT count(*) AS count FROM oura_connections").get()
      .count,
    0,
  );
});

test("disconnect cancels an in-flight exchange and expired state cannot be used", async () => {
  let started;
  let release;
  const exchanging = new Promise((resolve) => {
    started = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const { send, sqlite } = fixture(async () => {
    started();
    await waiting;
    return token();
  });
  const expired = await authorize(send);
  sqlite.exec("UPDATE oura_oauth_pending SET expires = 0");
  assert.equal((await send(expired)).status, 400);

  const path = await authorize(send);
  const result = send(path);
  await exchanging;
  await send("/account/disconnect", { method: "POST" });
  release();
  assert.equal((await result).status, 409);
  assert.equal(
    sqlite.prepare("SELECT count(*) AS count FROM oura_connections").get()
      .count,
    0,
  );
});

test("production authentication fails closed for missing or malformed Access assertions", async () => {
  const worker = createWorker();
  const env = {
    PUBLIC_ORIGIN: origin,
    ACCESS_ISSUER: "https://test.cloudflareaccess.com",
    ACCESS_AUDIENCE: "test-audience",
  };
  for (const headers of [{}, { "Cf-Access-Jwt-Assertion": "not-a-jwt" }]) {
    const response = await worker.fetch(
      new Request(origin + "/account", { headers }),
      env,
    );
    assert.equal(response.status, 401);
  }
});

test("checks only the signed-in account and never returns Oura data", async () => {
  let status = 200;
  let checks = 0;
  const { send } = fixture(token, async (url, options) => {
    checks++;
    assert.equal(url.origin, "https://api.ouraring.com");
    assert.equal(options.redirect, "manual");
    assert.equal(url.pathname, "/v2/usercollection/daily_sleep");
    assert.equal(options.headers.Authorization, "Bearer access-token-test");
    return Response.json({ data: ["private-test-record"] }, { status });
  });
  assert.equal((await send("/account/status", { owner: "" })).status, 401);
  assert.match(await (await send("/account")).text(), /<button>Sign in to Oura<\/button>/);
  assert.match(await (await send("/account/status")).text(), /class="badge">Disconnected</);
  assert.equal((await send(await authorize(send))).status, 303);
  assert.match(
    await (await send("/account/status", { owner: "bob" })).text(),
    /No Oura account/,
  );
  assert.equal(checks, 0);
  const html = await (await send("/account/status")).text();
  assert.match(html, /class="badge">Connected</);
  assert.match(html, /Oura accepted the API request/);
  assert.doesNotMatch(html, /private-test-record|access-token-test/);
  status = 401;
  const rejected = await send("/account/status");
  assert.equal(rejected.status, 409);
  assert.match(await rejected.text(), /class="badge">Reconnect required</);
  status = 429;
  const unavailable = await send("/account/status");
  assert.equal(unavailable.status, 502);
  assert.match(await unavailable.text(), /class="badge">Test failed</);
});
