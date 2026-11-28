# Sketchfab integration configuration

The platform supports thumbnail search, interactive model references, authorized downloads and private learning-library imports. A downloadable model still requires the author's permission and compliance with its license.

## Server configuration

Register a confidential Authorization Code application with Sketchfab and configure its issued credentials only in the ignored server `.env` or a secret manager:

```dotenv
SKETCHFAB_CLIENT_ID=<registered-client-id>
SKETCHFAB_CLIENT_SECRET=<registered-client-secret>
SKETCHFAB_REDIRECT_URI=http://localhost:3000/api/v1/tools/sketchfab/callback
SKETCHFAB_WEB_ORIGIN=http://localhost:3000
```

The local application has issued credentials configured. Do not commit or include them in client bundles. Production requires an approved HTTPS callback and matching website origin; no public Void Space deployment is configured here.

OAuth tokens are sealed into purpose-separated encrypted HttpOnly cookies, bound to the current user and tenant. The connection expires with the provider access token. Reconnect when it expires. Disconnect clears the local connection; provider authorization can be revoked in the account's connected applications.

## User journey

Open **Find a model**, search by name or paste a model link, and select a thumbnail to inspect the model in 3D. Connect your Sketchfab account for permitted editable downloads and private-library imports. Author and license attribution remain visible. Native annotations and graded component interactions require importing a permitted model into the library and reviewing its component targets. Embeds remain reference viewers.
