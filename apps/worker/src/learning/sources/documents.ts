import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';
export interface Passage {
  id: string;
  page: number;
  text: string;
}
export function textPassages(text: string, page = 1, prefix = 'p'): Passage[] {
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (clean.length > 100000)
    throw new Error('Source exceeds 100,000 extracted characters. Split it into smaller sections.');
  return (clean.match(/[\s\S]{1,2500}/g) ?? []).map((text, i) => ({
    id: `${prefix}${i + 1}`,
    page,
    text,
  }));
}
export function extractOffice(bytes: Uint8Array, mime: string): Passage[] {
  let expanded = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (
        ++count > 2000 ||
        file.originalSize > 10 * 1024 * 1024 ||
        (expanded += file.originalSize) > 30 * 1024 * 1024
      )
        throw new Error('Document archive exceeds safe extraction limits.');
      return /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml)$/.test(file.name);
    },
  });
  const names = Object.keys(files)
    .filter((n) =>
      mime.includes('wordprocessingml')
        ? n === 'word/document.xml'
        : /^ppt\/slides\/slide\d+\.xml$/.test(n),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length || names.length > 50)
    throw new Error('Use a valid DOCX document or a PPTX with at most 50 slides.');
  const parser = new XMLParser({
    ignoreAttributes: true,
    processEntities: true,
    preserveOrder: true,
  });
  const passages = names.flatMap((name, i) => {
    const xml = new TextDecoder().decode(files[name]);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error('Document entity declarations are unsupported.');
    const texts: string[] = [];
    function visit(node: unknown): void {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (['w:t', 'a:t'].includes(key)) {
          const collect = (v: unknown): void => {
            if (typeof v === 'string' || typeof v === 'number') texts.push(String(v));
            else if (Array.isArray(v)) v.forEach(collect);
            else if (v && typeof v === 'object') Object.values(v).forEach(collect);
          };
          collect(value);
        } else visit(value);
      }
    }
    visit(parser.parse(xml));
    const page = Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? i + 1);
    return textPassages(texts.join(' '), page, `page${page}_`);
  });
  if (passages.reduce((n, p) => n + p.text.length, 0) > 100000)
    throw new Error('Document exceeds 100,000 extracted characters.');
  if (!passages.some((p) => p.text.length >= 20))
    throw new Error('No usable document text. Paste notes or upload a text document.');
  return passages;
}
export function extractWebPage(bytes: Uint8Array): Passage[] {
  const $ = load(new TextDecoder().decode(bytes));
  $('script,style,nav,footer,header,form,iframe,svg,noscript').remove();
  const main = $('main,article').first();
  const text = (main.length ? main : $('body')).text().replace(/\s+/g, ' ').trim();
  if (text.length < 20)
    throw new Error(
      'This page has no readable text. Login-only and JavaScript-only pages require a file upload or pasted notes.',
    );
  return textPassages(text);
}
