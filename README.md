# Oura for Buzz

Connect an Oura account from Buzz using a Cloudflare Worker. The Worker requests
Oura’s daily scope, stores encrypted OAuth tokens in D1, and discards the API
response from a connection test.

## Joabar pilot

Open **Settings → Integrations → Oura → Sign in to Oura**. Verify your email in
the browser. If your Oura account is already linked, select **Link to Buzz**.
Otherwise authorize the app on Oura. Select **Return to Buzz** to see the
connection in the desktop app. **Test connection** checks Oura and updates the
badge. If your browser cannot reopen Buzz, use the connection code shown in
the browser on the device that started sign-in.

The pilot defaults to `https://wearables.joabar.xyz`. The plugin asks Buzz for
permission to contact that Worker. The device credential is limited to
connection status and testing until you select **Enable sleep access** and
approve it in the browser. This uses your existing Oura authorization. Oura
tokens stay on the Worker. The connection follows your Buzz identity on this
device.

The plugin registers `oura_get_deep_sleep` on Buzz's MCP server. The tool lets
your agents read up to 30 nights of deep-sleep durations in a private
one-on-one chat with you. Ask for a chart in that chat to use Buzz's native
Charts plugin. Sleep access requires the Joabar pilot Worker. Disconnecting
Oura from its account page revokes the linked Buzz devices.

## Files

- `buzz/` contains the manifest and single JavaScript module Buzz loads.
- `backend/worker.js` contains the Access checks, OAuth exchange and account
  page.
- `migrations/` contains the D1 schema.
- `wrangler.example.jsonc` is the deployment template.

## Self-host with your own secrets

1. Run `npm ci` with Node 22 or newer. Create a D1 database using
   `npx wrangler d1 create buzz-oura`. Copy `wrangler.example.jsonc` to
   `wrangler.jsonc` and fill in the hostname, origin and D1 ID.
2. Create a Cloudflare Access self-hosted application covering the entire
   Worker hostname. Give access only to the people you intend to authorize.
   Use a human sign-in policy. Fill in the Access issuer and application
   audience in the Wrangler config. The Worker verifies the signed Access
   JWT on each request, including the OAuth callback.
3. Register your own app in the [Oura developer portal](https://cloud.ouraring.com/oauth/applications).
   Supply privacy and terms URLs for your deployment. Register
   `https://YOUR-WORKER-HOST/oauth/oura/callback` as the exact redirect URI.
4. Apply the database schema and deploy.

   ```sh
   npx wrangler d1 migrations apply OURA_DB --remote
   npx wrangler deploy
   npx wrangler secret put OURA_CLIENT_ID
   npx wrangler secret put OURA_CLIENT_SECRET
   openssl rand -hex 32 | npx wrangler secret put OURA_TOKEN_KEY
   ```

   Keep the encryption key stable and back it up securely. The current
   version has no key migration. Keep secrets out of Git and Buzz.

5. In Buzz, open **Settings → Plugins → Manage plugins → Add → Browse** and
   select the `buzz/` folder. Open **Settings → Integrations → Oura →
   Advanced settings** and save your Worker URL. **Sign in to Oura** and
   **Test in browser** use the signed-in browser on self-hosted Workers.
   Advanced settings also shows the OAuth redirect URI and lets you override
   the same-origin sign-in and test routes.

   For a custom provider deployment, set the optional Worker variables
   `OURA_AUTHORIZE_URL`, `OURA_TOKEN_URL`, and `OURA_API_BASE_URL` in your
   Wrangler configuration. The defaults are Oura’s public HTTPS endpoints.
   An operator should set these only to endpoints they trust with their
   OAuth credentials and tokens.

Disconnect removes the token envelope from the live D1 database. To revoke
the provider grant itself, remove the app from your Oura account settings.

Run `npm test` for the local callback tests. These exercise SQLite and a
simulated token exchange. A live Oura authorization requires your browser
and developer app.

This package is available under the [MIT License](LICENSE).

The Oura wordmark identifies the integration and belongs to Oura.
