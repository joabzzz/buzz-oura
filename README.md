# Oura for Buzz

Connect an Oura account from a Buzz page using a self-hosted Cloudflare
Worker. This first version links and disconnects accounts. It requests
Oura’s daily scope and stores encrypted OAuth tokens in D1, without storing wearable
records. The connection test checks the daily API and discards its response. Each connection belongs to the authenticated
Cloudflare Access user. Buzz community membership and sharing controls are
outside the scope of this version.

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
   select the `buzz/` folder. Open **Settings → Integrations → Oura**, save your Worker origin, and
   select **Open Oura sign-in in browser**. Sign in to the Worker through Cloudflare
   Access, then connect your Oura account. The plugin shows the callback and
   API URLs. **Test connection in browser** checks the linked account once
   you deploy a Worker with the status route.

Disconnect removes the token envelope from the live D1 database. To revoke
the provider grant itself, remove the app from your Oura account settings.

Run `npm test` for the local callback tests. These exercise SQLite and a
simulated token exchange. A live Oura authorization requires your browser
and developer app.

This package is available under the [MIT License](LICENSE).

The Oura wordmark identifies the integration and belongs to Oura.
