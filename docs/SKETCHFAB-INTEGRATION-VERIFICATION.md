# Sketchfab integration verification

Verified locally on 23 November 2026. Existing AI integration edits were preserved.

## Studio checks

- Added File → Sketchfab Models with strict model-link parsing, isolated-page compatible previews, local GLB import, editable credit and an explicit Space connection/search destination.
- Imported native-exported geometry through the new file picker. Verified that undo removes it, redo restores it, and attribution survives project save/load.
- Fixed Unicode/spacing corruption in workflow serialization. Workflow JSON now uses ASCII escapes so the existing project string serializer preserves attribution, including non-English author names. Other workflow operations use the same writer.
- Added direct Space-to-Studio transfers: encrypted server-side grants in Redis, random single-use five-minute tickets, no Sketchfab access token in browser JavaScript, and source confirmation before import. Consuming a ticket is atomic. Failed/expired transfers give a fresh-import instruction.
- Twenty Studio browser cases passed across Sketchfab, remaining modeling tools and existing object workflows. Eight workflow unit tests passed. Studio TypeScript checking passed.

## Space and learning checks

- Added the 3D references page, real Sketchfab search, model metadata/attribution, shared embeds, reset view, account controls, editable GLB download and direct Studio import when configured.
- Included free exploration in Practice with an AI/reference guide. The guide explicitly uses metadata and instructions; it cannot inspect geometry or grade work. Existing lesson AI and native inspection modes remain intact.
- Authors can include full Sketchfab links in released lesson content. Up to three distinct references appear in the lesson player, reused by programs and lesson-based shared rooms. External references are hidden in the quiz. Native graded mesh/hotspot tasks still require approved library assets.
- A browser test created and published a real lesson, verified its model reference, entered the quiz and verified removal of the reference, opened its shared live room and verified the same model, and checked Practice discovery. Test records were cleaned up.
- BrowserOS verified real Sketchfab search results, a model preview in both products, reset view, author/license links, and a real AI exploration response. Provider consent/download was not attempted without registered credentials.
- Thirty-one web unit tests passed. The production web build passed. Core API, shared types and web TypeScript checks passed.

## OAuth, download and archive checks

Fourteen dedicated API tests passed: authenticated status, truthful unconfigured state, encrypted-cookie purpose separation, account binding, state validation/expiry, cancellation, disconnect, download permission, authenticated provider requests without forwarding credentials to the CDN, forbidden-host rejection, single-use model grants, glTF ZIP conversion with buffers/textures, archive path/external-resource rejection and expansion limits. Existing tools, learning/spatial and lesson mentor suites passed as well (28 additional tests).

The server retrieves fresh provider download URLs, rejects redirects and unexpected hosts, limits downloaded files to 100 MB, limits extracted/packed data to 200 MB and 2,000 archive entries, and packs separate glTF resources into a GLB. Ambiguous scenes, missing resources, unsupported texture formats and Meshopt-compressed ZIPs fail clearly instead of producing incomplete models. A direct valid GLB requires a matching version and declared file size.

## External prerequisites and limits

No Sketchfab OAuth application exists yet. Real consent, user-authorized downloads and production direct transfers require registration approval, client credentials, a reachable Space API and correct Studio CORS configuration. [The registration request and exact configuration](SKETCHFAB-OAUTH-REGISTRATION.md) are prepared. No support message was sent and no secret was requested in chat.

Void Space is not publicly deployed. GitHub Pages can provide Studio’s editor, shared previews and local imports; it cannot run the OAuth exchange or Redis transfer service. These checks do not certify every provider model, every browser/device or a production OAuth flow. Model availability, embedded controls, annotations and download permission remain under Sketchfab/the model author’s control.
