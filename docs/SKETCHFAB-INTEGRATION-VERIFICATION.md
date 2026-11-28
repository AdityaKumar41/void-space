# Sketchfab integration verification

Verified locally on 23 November 2026. Existing AI integration edits were preserved.

## Space and learning checks

## OAuth, download and archive checks

Fourteen dedicated API tests passed: authenticated status, truthful unconfigured state, encrypted-cookie purpose separation, account binding, state validation/expiry, cancellation, disconnect, download permission, authenticated provider requests without forwarding credentials to the CDN, forbidden-host rejection, single-use model grants, glTF ZIP conversion with buffers/textures, archive path/external-resource rejection and expansion limits. Existing tools, learning/spatial and lesson mentor suites passed as well (28 additional tests).

The server retrieves fresh provider download URLs, rejects redirects and unexpected hosts, limits downloaded files to 100 MB, limits extracted/packed data to 200 MB and 2,000 archive entries, and packs separate glTF resources into a GLB. Ambiguous scenes, missing resources, unsupported texture formats and Meshopt-compressed ZIPs fail clearly instead of producing incomplete models. A direct valid GLB requires a matching version and declared file size.

## External prerequisites and limits