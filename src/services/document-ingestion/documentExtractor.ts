import JSZip from 'jszip';

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type ExtractedDocument = {
  text: string;
  pages: ExtractedPage[];
  mimeType: string;
  fileName: string;
};

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

async function extractPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  // Import the legacy build for reliable Node.js execution.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: ExtractedPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

    pages.push({ pageNumber, text });
  }

  await pdf.destroy();
  return pages;
}

async function extractDocx(buffer: Buffer): Promise<ExtractedPage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text');
  if (!documentXml) {
    throw new Error('Invalid DOCX: word/document.xml was not found.');
  }

  const paragraphs = [...documentXml.matchAll(/<w:p(?:\\s[^>]*)?>([\\s\\S]*?)<\\/w:p>/g)]
    .map((match) => {
      const paragraphXml = match[1]
        .replace(/<w:tab\\b[^>]*\\/>/g, '\\t')
        .replace(/<w:br\\b[^>]*\\/>/g, '\\n');
      const words = [...paragraphXml.matchAll(/<w:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/w:t>/g)]
        .map((part) => decodeXml(part[1]));
      return words.join('').trim();
    })
    .filter(Boolean);

  return [{ pageNumber: 1, text: paragraphs.join('\\n\\n') }];
}

export async function extractDocumentText(
  buffer: Buffer | Uint8Array,
  fileName: string,
  mimeType?: string,
): Promise<ExtractedDocument> {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const extension = fileName.toLowerCase().split('.').pop() || '';
  const normalizedMime = (mimeType || '').toLowerCase();

  let pages: ExtractedPage[];
  if (extension === 'pdf' || normalizedMime.includes('application/pdf')) {
    pages = await extractPdf(safeBuffer);
  } else if (
    extension === 'docx' ||
    normalizedMime.includes('wordprocessingml')
  ) {
    pages = await extractDocx(safeBuffer);
  } else if (
    extension === 'txt' ||
    normalizedMime.startsWith('text/plain') ||
    normalizedMime === ''
  ) {
    const text = safeBuffer.toString('utf8').replace(/^\\uFEFF/, '').trim();
    pages = [{ pageNumber: 1, text }];
  } else {
    throw new Error(
      `Unsupported document type: ${extension || normalizedMime || 'unknown'}. Supported types: PDF, DOCX and TXT.`,
    );
  }

  const text = pages.map((page) => page.text).filter(Boolean).join('\\n\\n').trim();
  if (!text) {
    throw new Error(
      'No readable text was extracted. This may be a scanned PDF; OCR support is required for this file.',
    );
  }

  return {
    text,
    pages: pages.filter((page) => page.text.length > 0),
    mimeType: mimeType || 'application/octet-stream',
    fileName,
  };
}
