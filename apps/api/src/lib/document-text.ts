import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { DocumentExtension } from '@void-space/types';

import { ValidationError } from './errors';

export const MAX_TRANSLATION_DOCUMENT_CHARACTERS = 20_000;
const MAX_TRANSLATION_PDF_PAGES = 100;

export function validateDocumentTranslationText(text: string): string {
  const normalised = text.replace(/\u0000/g, '').trim();
  if (!normalised) {
    throw new ValidationError('This document does not contain readable text to translate.');
  }
  if (normalised.length > MAX_TRANSLATION_DOCUMENT_CHARACTERS) {
    throw new ValidationError(
      `The extracted text exceeds the ${MAX_TRANSLATION_DOCUMENT_CHARACTERS.toLocaleString()} character translation limit.`,
      { maxCharacters: MAX_TRANSLATION_DOCUMENT_CHARACTERS },
    );
  }
  return normalised;
}

function extractRtfText(source: string): string {
  return source
    .replace(/\\par[d]?/gi, '\n')
    .replace(/\\line/gi, '\n')
    .replace(/\\tab/gi, '\t')
    .replace(/\\u(-?\d+)\??/g, (_match, value: string) => {
      const codePoint = Number(value);
      return String.fromCharCode((codePoint + 65_536) % 65_536);
    })
    .replace(/\\'[0-9a-f]{2}/gi, (escaped) =>
      String.fromCharCode(Number.parseInt(escaped.slice(2), 16)),
    )
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/[{}]/g, '');
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_TRANSLATION_PDF_PAGES) {
      throw new ValidationError(
        `This PDF has more than ${MAX_TRANSLATION_PDF_PAGES} pages and cannot be translated in one request.`,
        { maxPages: MAX_TRANSLATION_PDF_PAGES },
      );
    }

    const pages: string[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ('str' in item && typeof item.str === 'string' ? [item.str] : []))
        .join(' ');
      characterCount += text.length;
      if (characterCount > MAX_TRANSLATION_DOCUMENT_CHARACTERS) {
        throw new ValidationError(
          `The extracted text exceeds the ${MAX_TRANSLATION_DOCUMENT_CHARACTERS.toLocaleString()} character translation limit.`,
          { maxCharacters: MAX_TRANSLATION_DOCUMENT_CHARACTERS },
        );
      }
      pages.push(text);
    }
    return validateDocumentTranslationText(pages.join('\n'));
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractDocumentText(
  bytes: Buffer,
  extension: DocumentExtension,
): Promise<string> {
  let text: string;
  switch (extension) {
    case '.txt':
    case '.md':
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      break;
    case '.docx': {
      const { default: mammoth } = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
      break;
    }
    case '.pdf':
      return extractPdfText(bytes);
    case '.rtf':
      text = extractRtfText(new TextDecoder('windows-1252').decode(bytes));
      break;
    case '.doc':
      throw new ValidationError(
        'Legacy .doc files cannot be translated. Save the document as .docx or PDF and upload it again.',
      );
  }
  return validateDocumentTranslationText(text);
}
