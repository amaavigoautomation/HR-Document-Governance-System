import JSZip from 'jszip';
import { stripPolicyMetadataHeader } from './documentHeaderFooter';
import { removePolicyMetadataFromDocxXml, cleanDocxBytes } from './documentStamper';

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
 * Extract clean text and structure from a Word .docx file using JSZip & XML DOM Parser
 */
export async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(arrayBuffer);

  // Look for word/document.xml
  const docXmlFile = loadedZip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('word/document.xml not found inside DOCX package');
  }

  const xmlString = await docXmlFile.async('text');
  const cleanedXml = removePolicyMetadataFromDocxXml(xmlString);
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(cleanedXml, 'application/xml');

  // Check for XML parsing errors
  const parseError = xmlDoc.getElementsByTagName('parsererror');
  if (parseError.length > 0) {
    // Regex fallback if DOMParser fails
    return extractTextFromDocxXmlRegex(cleanedXml);
  }

  const paragraphs = xmlDoc.getElementsByTagName('w:p');
  const extractedLines: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    // Check heading style in w:pPr -> w:pStyle
    let headingLevel = 0;
    const pStyle = p.getElementsByTagName('w:pStyle')[0];
    if (pStyle) {
      const val = pStyle.getAttribute('w:val') || '';
      if (/heading\s*1/i.test(val) || val === 'Heading1') headingLevel = 1;
      else if (/heading\s*2/i.test(val) || val === 'Heading2') headingLevel = 2;
      else if (/heading\s*3/i.test(val) || val === 'Heading3') headingLevel = 3;
    }

    // Extract all text nodes within runs (w:t)
    const textNodes = p.getElementsByTagName('w:t');
    let pText = '';
    for (let j = 0; j < textNodes.length; j++) {
      pText += textNodes[j].textContent || '';
    }

    pText = pText.trim();
    if (pText.length > 0) {
      if (headingLevel === 1) {
        extractedLines.push(`# ${pText}`);
      } else if (headingLevel === 2) {
        extractedLines.push(`## ${pText}`);
      } else if (headingLevel === 3) {
        extractedLines.push(`### ${pText}`);
      } else {
        extractedLines.push(pText);
      }
    }
  }

  if (extractedLines.length > 0) {
    return extractedLines.join('\n\n');
  }

  return extractTextFromDocxXmlRegex(xmlString);
}

/**
 * Fallback regex XML text extractor for word/document.xml
 */
function extractTextFromDocxXmlRegex(xmlString: string): string {
  // Split into paragraphs <w:p> ... </w:p>
  const paragraphMatches = xmlString.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const lines: string[] = [];

  for (const p of paragraphMatches) {
    const textMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    let pText = '';
    for (const t of textMatches) {
      const clean = t.replace(/<[^>]+>/g, '');
      pText += clean;
    }
    pText = pText.trim();
    if (pText.length > 0) {
      lines.push(pText);
    }
  }

  if (lines.length > 0) {
    return lines.join('\n\n');
  }

  // Raw tag strip fallback
  return xmlString.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

  if (extractedLines.length > 2) {
    return extractedLines.join('\n');
  }

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
 * Parse any uploaded file (Strictly supports PDF and DOCX)
 * Automatically unpacks .docx XML containers and extracts clean plain text / Markdown.
 */
export async function parseUploadedFile(file: File): Promise<ParsedFileResult> {
  const fileNameLower = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || fileNameLower.endsWith('.pdf');
  const isDocx =
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileNameLower.endsWith('.docx');

  const mimeType = file.type || (isPdf ? 'application/pdf' : isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain');

  // Generate Data URL for direct iframe / object embedding / downloads
  const fileDataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

  // Handle .docx files with JSZip XML parser
  if (isDocx) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const extractedText = await extractTextFromDocx(arrayBuffer);

      // Clean redundant metadata directly from the DOCX zip XML (tables & paragraphs)
      let cleanedDataUrl = fileDataUrl;
      try {
        const cleanedBytes = await cleanDocxBytes(arrayBuffer);
        const blob = new Blob([cleanedBytes], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        cleanedDataUrl = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => resolve(fileDataUrl);
          r.readAsDataURL(blob);
        });
      } catch (cleanErr) {
        console.warn('Could not pre-clean DOCX binary:', cleanErr);
      }

      if (extractedText && extractedText.trim().length > 0) {
        return {
          fileName: file.name,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fileSize: file.size,
          extractedText: stripPolicyMetadataHeader(extractedText.trim()),
          fileDataUrl: cleanedDataUrl,
          isPdf: false,
        };
      }
    } catch (docxErr) {
      console.error('Failed to parse .docx file:', docxErr);
      throw new Error('Could not parse Word (.docx) document. Please ensure it is a valid .docx file.');
    }
  }

  // Handle PDF documents
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
            extractedText: stripPolicyMetadataHeader(fullText.trim()),
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
      extractedText: stripPolicyMetadataHeader(
        streamExtracted ||
        `# Document: ${file.name.replace(/\.pdf$/i, '')}\n\n*Uploaded PDF document containing formatted pages.*`
      ),
      fileDataUrl,
      isPdf: true,
      pageCount: 1,
    };
  }

  // Standard plain text fallback
  const text = await file.text();
  return {
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    extractedText: stripPolicyMetadataHeader(text),
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
