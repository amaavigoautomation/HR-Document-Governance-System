export interface ParsedFileResult {
  fileName: string;
  mimeType: string;
  fileSize: number;
  extractedText: string;
  fileDataUrl?: string;
  isPdf: boolean;
  pageCount?: number;
}

let pdfjsPromise: Promise<any> | null = null;

export async function getBrowserPdfjs() {
  if (typeof window === 'undefined') return null;
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        } catch (e) {
          console.warn('PDF.js worker setup warning:', e);
        }
        return pdfjs;
      } catch (err) {
        console.warn('Failed to load pdfjs-dist dynamically:', err);
        return null;
      }
    })();
  }
  return pdfjsPromise;
}

/**
 * Fallback regex stream extractor to extract plain text tokens from raw PDF byte strings
 */
export function extractTextFromRawPdfStream(rawPdf: string): string {
  if (!rawPdf || !rawPdf.includes('%PDF')) return rawPdf;

  const extractedLines: string[] = [];
  
  // Extract text within BT ... ET blocks and (string) Tj / TJ operators
  const textBlockRegex = /BT[\s\S]*?ET/g;
  const matches = rawPdf.match(textBlockRegex) || [];

  for (const block of matches) {
    // Match (string) Tj or [(str1)(str2)] TJ
    const tjMatches = block.match(/\((.*?)\)\s*Tj/g) || [];
    for (const tj of tjMatches) {
      const text = tj.replace(/^\(/, '').replace(/\)\s*Tj$/, '').trim();
      if (text && text.length > 0) {
        extractedLines.push(text);
      }
    }

    const arrayTjMatches = block.match(/\[(.*?)\]\s*TJ/g) || [];
    for (const atj of arrayTjMatches) {
      const innerStrings = atj.match(/\((.*?)\)/g) || [];
      const combined = innerStrings
        .map((s) => s.slice(1, -1))
        .join('')
        .trim();
      if (combined) {
        extractedLines.push(combined);
      }
    }
  }

  // If regex found readable text lines, join them nicely
  if (extractedLines.length > 2) {
    return extractedLines.join('\n');
  }

  // If no streams decoded, extract readable strings of length >= 4
  const printableStrings = rawPdf.match(/[A-Za-z0-9\s.,!?:;'"\-–—()/#&]{4,}/g) || [];
  const cleanStrings = printableStrings
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 4 &&
        !s.startsWith('obj') &&
        !s.startsWith('endobj') &&
        !s.startsWith('/Type') &&
        !s.startsWith('/Font') &&
        !s.includes('Adobe') &&
        !s.includes('MediaBox')
    );

  if (cleanStrings.length > 5) {
    return cleanStrings.join('\n\n');
  }

  return '';
}

/**
 * Parse any uploaded file (PDF, TXT, MD, DOC, etc.)
 */
export async function parseUploadedFile(file: File): Promise<ParsedFileResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const mimeType = file.type || (isPdf ? 'application/pdf' : 'text/plain');

  // Generate Data URL for direct iframe / object embedding
  const fileDataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

  if (isPdf) {
    try {
      const pdfjsLib = await getBrowserPdfjs();
      if (pdfjsLib) {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages;

        let fullText = '';
        for (let i = 1; i <= numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (pageText) {
            fullText += (i > 1 ? '\n\n' : '') + pageText;
          }
        }

        if (fullText.trim().length > 10) {
          return {
            fileName: file.name,
            mimeType: 'application/pdf',
            fileSize: file.size,
            extractedText: fullText.trim(),
            fileDataUrl,
            isPdf: true,
            pageCount: numPages,
          };
        }
      }
    } catch (pdfErr) {
      console.warn('PDF.js parse failed, falling back to stream reader:', pdfErr);
    }

    // Fallback if PDF.js failed or was empty
    const rawText = await file.text();
    const streamExtracted = extractTextFromRawPdfStream(rawText);

    return {
      fileName: file.name,
      mimeType: 'application/pdf',
      fileSize: file.size,
      extractedText:
        streamExtracted ||
        `# Document: ${file.name.replace(/\.pdf$/i, '')}\n\n*Uploaded PDF document containing binary formatted pages. Use the embedded PDF previewer or download the original file.*`,
      fileDataUrl,
      isPdf: true,
      pageCount: 1,
    };
  }

  // Standard text / Markdown / other text files
  const text = await file.text();
  return {
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    extractedText: text,
    fileDataUrl,
    isPdf: false,
  };
}

/**
 * Checks if rawContent is unparsed raw PDF binary stream
 */
export function isRawPdfStream(content: string): boolean {
  return typeof content === 'string' && (content.startsWith('%PDF') || content.includes('%PDF-1.'));
}
