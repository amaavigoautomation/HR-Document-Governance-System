import type { ExtractedPage } from './documentExtractor';

export type DocumentChunk = {
  chunkIndex: number;
  pageNumber: number;
  text: string;
  characterCount: number;
};

export type ChunkOptions = {
  /** Approx. 900 tokens when using ordinary English text. */
  maxChars?: number;
  /** Repeats context from the previous chunk. */
  overlapChars?: number;
};

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];

  const parts: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maxChars) {
    // Prefer cutting at a word boundary near the maximum size.
    let cutAt = remaining.lastIndexOf(' ', maxChars);
    if (cutAt < Math.floor(maxChars * 0.6)) cutAt = maxChars;

    parts.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

export function chunkDocumentPages(
  pages: ExtractedPage[],
  options: ChunkOptions = {},
): DocumentChunk[] {
  const maxChars = options.maxChars ?? 3600;
  const overlapChars = options.overlapChars ?? 500;

  if (!Number.isInteger(maxChars) || maxChars < 200) {
    throw new Error('maxChars must be an integer of at least 200.');
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('overlapChars must be an integer between 0 and maxChars - 1.');
  }

  const chunks: DocumentChunk[] = [];

  for (const page of pages) {
    const paragraphs = page.text
      .replace(/\\r\\n/g, '\\n')
      .split(/\\n\\s*\\n/)
      .map((paragraph) => paragraph.replace(/\\s+/g, ' ').trim())
      .filter(Boolean);

    const segments = paragraphs.flatMap((paragraph) =>
      splitLongParagraph(paragraph, maxChars),
    );

    let current = '';
    for (const segment of segments) {
      const candidate = current ? `${current}\\n\\n${segment}` : segment;

      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }

      if (current) {
        chunks.push({
          chunkIndex: chunks.length,
          pageNumber: page.pageNumber,
          text: current,
          characterCount: current.length,
        });
      }

      const overlap = current.slice(-overlapChars).trim();
      current = overlap ? `${overlap}\\n\\n${segment}` : segment;

      // A segment can be maxChars long, so discard overlap if it would exceed the limit.
      if (current.length > maxChars) current = segment;
    }

    if (current.trim()) {
      chunks.push({
        chunkIndex: chunks.length,
        pageNumber: page.pageNumber,
        text: current.trim(),
        characterCount: current.trim().length,
      });
    }
  }

  return chunks;
}
