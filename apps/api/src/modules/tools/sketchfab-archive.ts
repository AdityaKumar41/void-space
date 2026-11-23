import { unzipSync } from 'fflate';

const LIMIT = 200 * 1024 * 1024;
const fail = (message: string): never => {
  throw new Error(message);
};
function archivePath(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fail('Invalid archive resource path');
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  )
    return fail('External archive resources are not supported');
  const parts = decoded.split('/');
  if (parts.some((part) => part === '..')) return fail('Archive resource escapes its folder');
  return parts.filter((part) => part && part !== '.').join('/');
}
interface Gltf {
  asset: { version: string };
  buffers?: { uri?: string; byteLength: number; [key: string]: unknown }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    [key: string]: unknown;
  }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** Offline-only packing: a ZIP may never make the server fetch another URL. */
export function sketchfabArchiveToGlb(input: Uint8Array): Buffer {
  if (Buffer.from(input.subarray(0, 4)).toString() === 'glTF') {
    const bytes = Buffer.from(input);
    if (bytes.length < 20 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
      fail('Invalid GLB header');
    return bytes;
  }
  let expanded = 0;
  let count = 0;
  const files = unzipSync(input, {
    filter(file) {
      archivePath(file.name);
      expanded += file.originalSize;
      count++;
      if (expanded > LIMIT || count > 2000) fail('Sketchfab archive exceeds extraction limits');
      return !file.name.endsWith('/');
    },
  });
  const actual = Object.values(files).reduce((sum, file) => sum + file.byteLength, 0);
  if (actual > LIMIT) fail('Sketchfab archive exceeds extraction limits');
  const entries = Object.entries(files);
  const binaries = entries.filter(([name]) => name.toLowerCase().endsWith('.glb'));
  if (binaries.length === 1) {
    const binary = binaries[0]![1];
    if (Buffer.from(binary.subarray(0, 4)).toString() !== 'glTF') fail('Invalid GLB in archive');
    return Buffer.from(binary);
  }
  const scenes = entries.filter(([name]) => name.toLowerCase().endsWith('.gltf'));
  if (scenes.length !== 1) fail('Archive must contain exactly one glTF scene');
  const [name, json] = scenes[0]!;
  if (json.byteLength > 10 * 1024 * 1024) fail('glTF scene description is too large');
  const scene = JSON.parse(Buffer.from(json).toString('utf8')) as Gltf;
  if (JSON.stringify(scene.extensionsUsed ?? []).includes('EXT_meshopt_compression'))
    fail('Meshopt-compressed archives require external conversion');
  if (scene.asset?.version !== '2.0') fail('Only glTF 2.0 is supported');
  const directory = name.slice(0, name.lastIndexOf('/') + 1);
  const resources = new Map(entries.map(([path, bytes]) => [archivePath(path), bytes]));
  function resource(uri: string): Uint8Array {
    if (uri.startsWith('data:')) {
      const match = uri.match(/^data:[a-z0-9.+/-]*;base64,([a-z0-9+/=\r\n]*)$/i);
      if (!match) return fail('Unsupported embedded resource');
      return Buffer.from(match[1]!, 'base64');
    }
    const bytes = resources.get(archivePath(directory + archivePath(uri)));
    return bytes ?? fail('A glTF texture or buffer is missing from the archive');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  function append(bytes: Uint8Array): number {
    const offset = length;
    const aligned = Buffer.alloc(Math.ceil(bytes.byteLength / 4) * 4);
    aligned.set(bytes);
    chunks.push(aligned);
    length += aligned.byteLength;
    if (length > LIMIT) fail('Packed model exceeds size limit');
    return offset;
  }
  const offsets = (scene.buffers ?? []).map((buffer) => {
    if (!buffer.uri || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0)
      return fail('Invalid glTF buffer');
    const bytes = resource(buffer.uri);
    if (bytes.byteLength < buffer.byteLength) return fail('Truncated glTF buffer');
    return append(bytes.subarray(0, buffer.byteLength));
  });
  scene.bufferViews ??= [];
  for (const view of scene.bufferViews) {
    const source = scene.buffers?.[view.buffer];
    const offset = view.byteOffset ?? 0;
    if (
      !source ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteLength < 0 ||
      offset + view.byteLength > source.byteLength
    )
      fail('Invalid glTF buffer view');
    view.byteOffset = offsets[view.buffer]! + offset;
    view.buffer = 0;
  }
  for (const image of scene.images ?? []) {
    if (!image.uri) continue;
    const uri = image.uri;
    const bytes = resource(uri);
    const mime =
      image.mimeType ??
      (uri.startsWith('data:')
        ? uri.slice(5, uri.indexOf(';'))
        : /\.png$/i.test(uri)
          ? 'image/png'
          : /\.jpe?g$/i.test(uri)
            ? 'image/jpeg'
            : /\.webp$/i.test(uri)
              ? 'image/webp'
              : /\.ktx2$/i.test(uri)
                ? 'image/ktx2'
                : undefined);
    if (!mime) fail('Unknown texture format');
    image.bufferView = scene.bufferViews.length;
    scene.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.byteLength });
    image.mimeType = mime;
    delete image.uri;
  }
  scene.buffers = [{ byteLength: length }];
  const jsonBytes = Buffer.from(JSON.stringify(scene));
  const paddedJson = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20);
  paddedJson.set(jsonBytes);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + bin.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, paddedJson, binHeader, bin]);
}
