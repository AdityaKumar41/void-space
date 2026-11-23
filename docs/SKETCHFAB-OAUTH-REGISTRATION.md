# Sketchfab registration for Void Studio and Void Space

Prepared 23 November 2026. No application is registered yet; no client credentials have been supplied. Shared model viewing needs no OAuth application. End-user editable downloads do.

## Registration request to copy into Sketchfab support

Application name: **Void Studio / Void Space**

Grant type: **Authorization Code** (server-side exchange, confidential client).

Application author: **your Sketchfab username**. This must be supplied by the account owner; it is not inferred from a GitHub username.

Development redirect URI: **http://localhost:3000/api/v1/tools/sketchfab/callback**

Production redirect URI: the future HTTPS Void Space website followed by **/api/v1/tools/sketchfab/callback**. Void Space is not publicly deployed yet, so do not register an invented domain. Register the localhost callback now and request the real production callback once hosting exists. The API must be reachable at that path through the website’s reverse proxy.

Application description:

> Void Studio is a browser-based 3D modeling editor. Void Space is its learning platform for lessons, programs, interactive practice and shared learning rooms. We would like users to search Sketchfab, view author-attributed model references, and connect their own Sketchfab accounts to download models whose authors permit downloading. We retain model attribution and license information and require review before imported content is used for graded learning interactions. Our server performs the OAuth authorization-code exchange and never exposes client secrets or end-user Sketchfab access tokens to the browser application. We need Download API access for end-user-authorized glTF/GLB imports.

Public Studio website: https://adityakumar41.github.io/void-space/

Code repository: https://github.com/AdityaKumar41/void-space

Sketchfab asks for registration through [Sketchfab support](https://help.sketchfab.com/en/), rather than a self-service client creation form. This document prepares the request; no support message has been sent.

## Configuration after approval

Set these values only on the **core API server**, using its secret manager or ignored `.env` file:

```dotenv
SKETCHFAB_CLIENT_ID=<registered-client-id>
SKETCHFAB_CLIENT_SECRET=<registered-client-secret>
SKETCHFAB_REDIRECT_URI=http://localhost:3000/api/v1/tools/sketchfab/callback
SKETCHFAB_WEB_ORIGIN=http://localhost:3000
```

For production, use the approved HTTPS website origin and exact HTTPS callback, `COOKIE_SECURE=true`, and a private high-entropy `JWT_REFRESH_SECRET`. Provider cookies are encrypted with a purpose-separated key derived from that secret; rotating it disconnects Sketchfab sessions. Tokens are stored only in encrypted HttpOnly cookies, bound to the current Void Space user and tenant. This implementation expires the connection with the provider access token and requires reconnecting; it deliberately does not retain refresh tokens. “Disconnect” clears the local connection; revoke authorization in Sketchfab’s Connected Apps to revoke it at the provider.

Do not put a client secret in `NEXT_PUBLIC_*`, GitHub Pages variables, the Studio bundle, a lesson, or chat. A site-wide `SKETCHFAB_API_TOKEN` used by the older creator-search adapter is not authorization for downloading on behalf of end users.

## Usage

- Void Studio: **File → Sketchfab Models…**. Paste a full model link or 32-character ID to preview. Configure the actual Void Space website to open its account/search workflow. A permitted editable GLB can be imported through this dialog with attribution, as an undoable change.
- Void Space: **3D references** in the learning navigation. Paste a model link or search. Connect the end user’s Sketchfab account after registration is configured. Download an editable GLB when the author permits it. glTF ZIP downloads are packed server-side with buffers and textures into a self-contained GLB.
- Lessons: put a full Sketchfab model link in an outline step, summary or narration. Up to three distinct references appear as interactive viewers outside the assessment. Programs and lesson-based shared rooms reuse that lesson player.
- Practice: open **Free model exploration with Sketchfab and a study guide**. The exploration guide uses metadata and inspection guidance, not visual recognition or assessment answers. Existing native viewer inspection modes and AI integrations remain available.
- For graded practice mesh targets: upload a permitted model to the library, review and approve it, then use the experience builder. An external embed does not expose native mesh/hotspot geometry.

A public GitHub Pages editor has no OAuth server. Shared model viewing and local GLB import work there; OAuth downloads need the hosted Void Space/API configuration. No claim of real OAuth verification can be made before registration, credentials and an end-user consent test.

## Source documentation

- [OAuth registration, exchange and token handling](https://sketchfab.com/developers/oauth)
- [Download API and end-user authentication requirements](https://sketchfab.com/developers/download-api)
- [Signed downloads and glTF ZIP structure](https://sketchfab.com/developers/download-api/downloading-models)

## Direct Studio transfer

Set `SKETCHFAB_STUDIO_URL` to `http://localhost:5007` in development, or `https://adityakumar41.github.io/void-space/` when connecting to the public editor. Include that editor’s **origin** (`https://adityakumar41.github.io`, without the repository path) in the core API’s `CORS_ORIGINS`. The Space/API must be publicly reachable over HTTPS for the public editor to fetch its models.

**Import into Studio** creates a random, single-use five-minute transfer ticket. Redis stores its encrypted provider authorization; Studio receives only the scoped ticket in a URL fragment. The editor removes it from history and asks the user to confirm the displayed source before fetching the model without browser credentials. The server consumes the ticket atomically and retrieves only that model with the end user’s Sketchfab token. Retrying a consumed or expired link requires a fresh import. Attribution travels with the model and is saved with imported objects. Keep the normal GLB download/import route as a fallback.
