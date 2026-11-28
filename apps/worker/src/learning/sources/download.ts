import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}
/** Resolve and pin every hop. No cookies, credentials, proxy or automatic redirects. */
export async function downloadPublicSource(
  value: string,
  redirects = 0,
): Promise<{ bytes: Buffer; mime: string; url: string }> {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    redirects > 3
  )
    throw new Error('Use a public HTTP(S) link without credentials or a custom port.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('Only publicly reachable source addresses are supported.');
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        family: address.family,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        headers: {
          'User-Agent': 'VoidSpaceSourceImporter/1.0',
          Accept: 'text/html,application/pdf,text/plain,image/*',
        },
        signal: AbortSignal.timeout(20000),
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.resume();
          if (!response.headers.location)
            return reject(new Error('Source redirect has no destination.'));
          downloadPublicSource(new URL(response.headers.location, url).href, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          return reject(
            new Error(
              `Source returned HTTP ${response.statusCode}. Upload the file or paste notes instead.`,
            ),
          );
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) {
            response.destroy(new Error('Source exceeds 10 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            bytes: Buffer.concat(chunks),
            mime: (response.headers['content-type'] ?? '').split(';')[0]!.trim(),
            url: url.href,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}
