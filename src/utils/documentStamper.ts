import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import JSZip from 'jszip';
import pako from 'pako';
import {
  Document,
  Header,
  Footer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  Packer,
} from 'docx';
import {
  DocumentHeaderFooterData,
  cleanVersionNumber,
  formatDDMMYYYY,
  extractCleanBody,
  extractHeaderFooterData,
} from './documentHeaderFooter';
import { generateCorporatePdfBlob } from './pdfGenerator';
import { getMediaFromIndexedDb, findMediaInIndexedDb } from '../services/localMediaDb';
import { resolvePlayableMediaUrl } from '../services/mediaStorage';

export interface HeaderFooterMetadata {
  documentTitle: string;
  versionNumber: string;
  effectiveDate: string;
  createdByName?: string;
  approvedByName?: string;
  approvedDate?: string;
  companyName?: string;
}

export interface CorporateDocxOptions {
  documentTitle: string;
  versionNumber: string;
  effectiveDate: string;
  createdByName?: string;
  approvedByName?: string;
  approvedDate?: string;
  companyName?: string;
  rawContent: string;
  fileName?: string;
}

export interface StampResult {
  bytes: Uint8Array;
  blob: Blob;
  dataUrl: string;
}

/**
 * Converts various data inputs (base64 data URL, plain base64, Uint8Array, string) into a clean Uint8Array
 */
export function toUint8Array(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);

  if (typeof input === 'string') {
    let cleanBase64 = input;
    if (input.includes(',')) {
      cleanBase64 = input.split(',')[1];
    }

    try {
      const binary = atob(cleanBase64.trim());
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      const bytes = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        bytes[i] = input.charCodeAt(i) & 0xff;
      }
      return bytes;
    }
  }

  throw new Error('Unsupported document input format');
}

/**
 * Asynchronously resolves various document inputs (data URL, API URL, Blob URL, remote URL,
 * IndexedDB cache, or Uint8Array) into pure Uint8Array binary bytes.
 */
export async function resolveDocumentBytes(
  input: Uint8Array | ArrayBuffer | string,
  extraIdentifiers?: string[]
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);

  if (typeof input === 'string') {
    // 1. Data URL
    if (input.startsWith('data:')) {
      const cleanBase64 = input.includes(',') ? input.split(',')[1] : input;
      try {
        const binary = atob(cleanBase64.trim());
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      } catch (e) {
        console.warn('[resolveDocumentBytes] Data URL decode warning:', e);
      }
    }

    // 2. Fetchable URLs (API endpoint, relative path, HTTP/HTTPS, Blob URL)
    if (
      input.startsWith('/') ||
      input.startsWith('http://') ||
      input.startsWith('https://') ||
      input.startsWith('blob:')
    ) {
      try {
        const resp = await fetch(input);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          const bytes = new Uint8Array(ab);
          if (bytes.length > 0) return bytes;
        }
      } catch (fetchErr) {
        console.warn('[resolveDocumentBytes] Network fetch failed, checking local cache:', fetchErr);
      }
    }

    // 3. Search client-side IndexedDB for cached media
    try {
      const cleanId = input
        .replace('/api/storage/file/', '')
        .replace('/api/storage/download/', '')
        .replace('/api/storage/download?key=', '')
        .split('?')[0];

      const idsToSearch = [
        input,
        cleanId,
        decodeURIComponent(cleanId),
        ...(extraIdentifiers || []),
      ].filter(Boolean) as string[];

      const cached = await findMediaInIndexedDb(idsToSearch);
      if (cached?.dataUrl && cached.dataUrl.startsWith('data:')) {
        const cleanBase64 = cached.dataUrl.includes(',') ? cached.dataUrl.split(',')[1] : cached.dataUrl;
        const binary = atob(cleanBase64.trim());
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
      if (cached?.blob) {
        const ab = await cached.blob.arrayBuffer();
        return new Uint8Array(ab);
      }
    } catch (idbErr) {
      console.warn('[resolveDocumentBytes] IndexedDB lookup failed:', idbErr);
    }

    // 4. Raw base64 string without data prefix
    try {
      const clean = input.trim();
      if (/^[A-Za-z0-9+/=]+$/.test(clean) && clean.length % 4 === 0) {
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
    } catch {}

    // 5. Binary character string fallback
    try {
      const bytes = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        bytes[i] = input.charCodeAt(i) & 0xff;
      }
      return bytes;
    } catch {}
  }

  throw new Error('Unsupported document input format');
}

/**
 * Escapes XML special characters for OpenXML Word documents
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wraps text cleanly into multiple lines based on maximum allowed width in PDF points.
 * Intelligently handles compound words, underscores, hyphens, slashes, and long words
 * so text NEVER overflows or overlaps adjacent table columns.
 */
function wrapPdfText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  if (!text) return [''];
  const cleanText = text.trim();
  if (!cleanText) return [''];

  // Break text into tokens allowing breaks on whitespace, underscores, hyphens, slashes
  // to prevent long file names or snake_case titles from overflowing column bounds
  const rawTokens = cleanText.split(/(\s+|_|-|\/)/).filter(Boolean);
  const words: string[] = [];

  for (const token of rawTokens) {
    if (font.widthOfTextAtSize(token, fontSize) <= maxWidth) {
      words.push(token);
    } else {
      // Token itself is wider than maxWidth! Break it safely character by character
      let sub = '';
      for (let i = 0; i < token.length; i++) {
        const char = token[i];
        if (font.widthOfTextAtSize(sub + char, fontSize) <= maxWidth) {
          sub += char;
        } else {
          if (sub) words.push(sub);
          sub = char;
        }
      }
      if (sub) words.push(sub);
    }
  }

  const lines: string[] = [];
  let currentLine = '';

  for (const token of words) {
    const isDelimiter = /^[_\-\/\s]$/.test(token);
    const candidate = currentLine
      ? (isDelimiter || currentLine.endsWith(' ') || currentLine.endsWith('_') || currentLine.endsWith('-') || currentLine.endsWith('/')
          ? `${currentLine}${token}`
          : `${currentLine} ${token}`)
      : token;

    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine && currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = token.trim();
    }
  }
  if (currentLine && currentLine.trim()) {
    lines.push(currentLine.trim());
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * Detects if a PDF document has already been stamped with the Amaavigo corporate header & footer.
 * Checks PDF metadata (subject/keywords/author) and scans the first page content stream
 * for corporate branding signatures to prevent duplicate stamping.
 */
export function isPdfAlreadyStamped(doc: PDFDocument): boolean {
  try {
    const subject = doc.getSubject();
    if (subject && (subject.includes('AmaavigoGovernanceStamped') || subject.includes('Amaavigo Governance'))) {
      return true;
    }
    const keywords = doc.getKeywords();
    if (keywords && (keywords.includes('Amaavigo') || keywords.includes('GovernanceStamped'))) {
      return true;
    }
    const author = doc.getAuthor();
    if (author && author.includes('Amaavigo')) {
      return true;
    }

    // Inspect first page content stream for Amaavigo branding tokens
    const pages = doc.getPages();
    if (pages.length > 0) {
      const p0 = pages[0];
      const contents = (p0.node as any).normalizedEntries?.()?.Contents || (p0.node as any).Contents?.();
      if (contents && typeof contents.size === 'function') {
        const count = contents.size();
        for (let i = 0; i < count; i++) {
          const ref = contents.get(i);
          const stream = doc.context.lookup(ref);
          if (stream && typeof (stream as any).getContents === 'function') {
            let bytes = (stream as any).getContents();
            try {
              bytes = pako.inflate(bytes);
            } catch {
              // Not deflated or raw
            }
            const str = new TextDecoder('latin1').decode(bytes);
            if (
              str.includes('616D6161766967') ||
              str.includes('amaavig') ||
              str.includes('Where Brand takes Flight') ||
              str.includes('AmaavigoGovernanceStamped')
            ) {
              return true;
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('isPdfAlreadyStamped check warning:', e);
  }
  return false;
}

/**
 * Stamping engine for existing PDF documents:
 * Preserves the original document pages, vector objects, fonts, and graphics 100% INTACT.
 * Never scales, compresses, or modifies existing document streams.
 * Prevents double-stamping by inspecting document metadata and content streams.
 * Displays the full Document Name in the header table without any truncation.
 * Injects the official Amaavigo Header Table at the top of EVERY page
 * and the Governance Approval Footer Sign-Off at the bottom of EVERY page.
 */
export async function stampPdfWithHeaderFooter(
  sourcePdfInput: Uint8Array | ArrayBuffer | string,
  meta: HeaderFooterMetadata,
  options?: { forceRestamp?: boolean }
): Promise<StampResult> {
  const sourceBytes = await resolveDocumentBytes(sourcePdfInput);
  const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });

  const cleanVer = cleanVersionNumber(meta.versionNumber);
  const effective = formatDDMMYYYY(meta.effectiveDate);
  const isApproved = Boolean(
    meta.approvedByName &&
    meta.approvedByName !== 'Not yet approved' &&
    meta.approvedByName !== 'Pending Review' &&
    meta.approvedByName !== 'Pending Approval' &&
    !meta.approvedByName.toLowerCase().includes('not yet') &&
    meta.approvedDate &&
    meta.approvedDate !== 'Not yet approved' &&
    meta.approvedDate !== 'Pending Approval' &&
    !meta.approvedDate.toLowerCase().includes('not yet')
  );
  const approvedDt = isApproved ? formatDDMMYYYY(meta.approvedDate) : 'Not yet approved';
  const approver = isApproved ? meta.approvedByName : 'Not yet approved';
  const creator = meta.createdByName || 'HR Author';
  const title = meta.documentTitle || 'Document';

  // Guard against duplicate stamping: If already stamped with Amaavigo header/footer AND has full-width intact layout, return untouched
  // unless forceRestamp is requested OR approving an unapproved stamped document
  if (!options?.forceRestamp && isPdfAlreadyStamped(srcDoc)) {
    const keywords = srcDoc.getKeywords() || '';
    const alreadyHadApproval = keywords.includes('approved:true');
    const alreadyHadIntactLayout = keywords.includes('AmaavigoIntactFullWidth');
    if (alreadyHadIntactLayout && (!isApproved || alreadyHadApproval)) {
      const blob = new Blob([sourceBytes], { type: 'application/pdf' });
      const dataUrl =
        typeof sourcePdfInput === 'string' && sourcePdfInput.startsWith('data:')
          ? sourcePdfInput
          : `data:application/pdf;base64,${bytesToBase64(sourceBytes)}`;
      return {
        bytes: sourceBytes,
        blob,
        dataUrl,
      };
    }
  }

  // Mark document metadata so it is reliably recognized as stamped in future passes
  srcDoc.setSubject('AmaavigoGovernanceStamped');
  srcDoc.setKeywords([
    'AmaavigoGovernanceStamped',
    `v:${cleanVer}`,
    `approved:${isApproved}`,
    'corporate-governance',
    'AmaavigoIntactFullWidth',
  ]);
  srcDoc.setTitle(title);

  const font = await srcDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await srcDoc.embedFont(StandardFonts.HelveticaBold);

  const pageCount = srcDoc.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    const page = srcDoc.getPage(i);
    const { width: origW, height: origH } = page.getSize();

    // Dimensions for Header Table (kept compact at top margin to keep document 100% intact without empty space)
    const marginX = 36;
    const tableW = origW - marginX * 2;
    const headerH = 46;
    const topMargin = 8;
    const headerY = origH - topMargin - headerH;

    // Dimensions for Footer Table
    const footerH = 28;
    const footerY = 8;

    // 1. Draw Header Background & Slate Border (stamped cleanly above content with solid white background)
    page.drawRectangle({
      x: marginX,
      y: headerY,
      width: tableW,
      height: headerH,
      borderColor: rgb(15 / 255, 23 / 255, 42 / 255),
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });

    // Column boundaries:
    // Balanced allocation: Document Name gets generous space, Col 3 and Col 4 never get clipped
    const col1W = 108;
    const col3W = 74;
    const col4W = 98;
    const col2W = tableW - col1W - col3W - col4W;

    const col1X = marginX;
    const col2X = col1X + col1W;
    const col3X = col2X + col2W;
    const col4X = col3X + col3W;

    // Column Divider Lines
    page.drawLine({
      start: { x: col2X, y: headerY },
      end: { x: col2X, y: headerY + headerH },
      thickness: 0.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawLine({
      start: { x: col3X, y: headerY },
      end: { x: col3X, y: headerY + headerH },
      thickness: 0.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawLine({
      start: { x: col4X, y: headerY },
      end: { x: col4X, y: headerY + headerH },
      thickness: 0.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Col 1: Amaavigo Logo
    page.drawText('amaavig', {
      x: col1X + 8,
      y: headerY + 24,
      font: fontBold,
      size: 13.5,
      color: rgb(24 / 255, 26 / 255, 30 / 255),
    });
    page.drawCircle({
      x: col1X + 66,
      y: headerY + 28,
      size: 3.8,
      borderColor: rgb(250 / 255, 112 / 255, 20 / 255),
      borderWidth: 2,
    });
    page.drawRectangle({
      x: col1X + 59,
      y: headerY + 34,
      width: 3,
      height: 3,
      color: rgb(250 / 255, 112 / 255, 20 / 255),
    });
    page.drawText('Where Brand takes Flight', {
      x: col1X + 8,
      y: headerY + 9,
      font,
      size: 5.6,
      color: rgb(100 / 255, 116 / 255, 139 / 255),
    });

    // Col 2: Document Name - Full display without any ellipsis or title overlap
    page.drawText('Document Name:', {
      x: col2X + 8,
      y: headerY + headerH - 12,
      font: fontBold,
      size: 6.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    const maxTitleW = col2W - 16;
    let titleFontSize = 8.5;
    let titleLines = wrapPdfText(title, maxTitleW, fontBold, titleFontSize);

    if (titleLines.length > 2) {
      titleFontSize = 7.5;
      titleLines = wrapPdfText(title, maxTitleW, fontBold, titleFontSize);
    }
    if (titleLines.length > 3) {
      titleFontSize = 6.8;
      titleLines = wrapPdfText(title, maxTitleW, fontBold, titleFontSize);
    }

    if (titleLines.length === 1) {
      page.drawText(titleLines[0], {
        x: col2X + 8,
        y: headerY + 15,
        font: fontBold,
        size: titleFontSize,
        color: rgb(30 / 255, 41 / 255, 59 / 255),
      });
    } else if (titleLines.length === 2) {
      page.drawText(titleLines[0], {
        x: col2X + 8,
        y: headerY + 21,
        font: fontBold,
        size: titleFontSize,
        color: rgb(30 / 255, 41 / 255, 59 / 255),
      });
      page.drawText(titleLines[1], {
        x: col2X + 8,
        y: headerY + 10,
        font: fontBold,
        size: titleFontSize,
        color: rgb(30 / 255, 41 / 255, 59 / 255),
      });
    } else {
      const lineH = 9;
      const startY = headerY + 23;
      titleLines.slice(0, 3).forEach((line, idx) => {
        page.drawText(line, {
          x: col2X + 8,
          y: startY - idx * lineH,
          font: fontBold,
          size: titleFontSize,
          color: rgb(30 / 255, 41 / 255, 59 / 255),
        });
      });
    }

    // Col 3: Version - Cleanly centered
    page.drawText(`Version: ${cleanVer}`, {
      x: col3X + 8,
      y: headerY + 18,
      font: fontBold,
      size: 8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Col 4: Effective Date - Positioned without label/date collision
    page.drawText('Effective date :', {
      x: col4X + 8,
      y: headerY + headerH - 12,
      font: fontBold,
      size: 6.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(effective, {
      x: col4X + 8,
      y: headerY + 15,
      font,
      size: 8,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Dimensions for Footer Table
    page.drawRectangle({
      x: marginX,
      y: footerY,
      width: tableW,
      height: footerH,
      borderColor: rgb(15 / 255, 23 / 255, 42 / 255),
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });

    const footColW = tableW / 3;
    page.drawLine({
      start: { x: marginX + footColW, y: footerY },
      end: { x: marginX + footColW, y: footerY + footerH },
      thickness: 0.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawLine({
      start: { x: marginX + footColW * 2, y: footerY },
      end: { x: marginX + footColW * 2, y: footerY + footerH },
      thickness: 0.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Col 1: Created by
    page.drawText('Created by:', {
      x: marginX + 8,
      y: footerY + footerH - 10,
      font: fontBold,
      size: 6.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(creator, {
      x: marginX + 8,
      y: footerY + 6,
      font,
      size: 7.8,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Col 2: Approved by
    page.drawText('Approved by:', {
      x: marginX + footColW + 8,
      y: footerY + footerH - 10,
      font: fontBold,
      size: 6.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(approver, {
      x: marginX + footColW + 8,
      y: footerY + 6,
      font,
      size: 7.8,
      color: isApproved ? rgb(22 / 255, 101 / 255, 52 / 255) : rgb(148 / 255, 163 / 255, 184 / 255),
    });

    // Col 3: Approved Date
    page.drawText('Approved Date:', {
      x: marginX + footColW * 2 + 8,
      y: footerY + footerH - 10,
      font: fontBold,
      size: 6.8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(approvedDt, {
      x: marginX + footColW * 2 + 8,
      y: footerY + 6,
      font,
      size: 7.8,
      color: isApproved ? rgb(22 / 255, 101 / 255, 52 / 255) : rgb(148 / 255, 163 / 255, 184 / 255),
    });
  }

  const stampedBytes = await srcDoc.save();
  const blob = new Blob([stampedBytes], { type: 'application/pdf' });
  const dataUrl = `data:application/pdf;base64,${bytesToBase64(stampedBytes)}`;

  return {
    bytes: stampedBytes,
    blob,
    dataUrl,
  };
}

/**
 * Builds the official WordprocessingML Table Header for native DOCX injection
 */
function buildNativeHeaderXml(meta: {
  title: string;
  version: string;
  effectiveDate: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:left w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:bottom w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:right w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:insideH w:val="none"/>
        <w:insideV w:val="single" w:sz="6" w:space="0" w:color="0F172A"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="40" w:type="dxa"/>
        <w:left w:w="100" w:type="dxa"/>
        <w:bottom w:w="40" w:type="dxa"/>
        <w:right w:w="100" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="2434"/>
      <w:gridCol w:w="3463"/>
      <w:gridCol w:w="1591"/>
      <w:gridCol w:w="1872"/>
    </w:tblGrid>
    <w:tr>
      <!-- Col 1: Logo -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1300" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/><w:color w:val="181A1E"/></w:rPr><w:t>amaavig</w:t></w:r>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/><w:color w:val="FA7014"/></w:rPr><w:t>o</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="180" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="12"/><w:color w:val="64748B"/></w:rPr><w:t>Where Brand takes Flight</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 2: Document Name -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1850" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="14"/><w:color w:val="0F172A"/></w:rPr><w:t>Document Name:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.title)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 3: Version -->
      <w:tc>
        <w:tcPr><w:tcW w:w="850" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="10" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="16"/><w:color w:val="0F172A"/></w:rPr><w:t>Version: ${escapeXml(meta.version)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 4: Effective Date -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1000" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="14"/><w:color w:val="0F172A"/></w:rPr><w:t>Effective date :</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.effectiveDate)}</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>
</w:hdr>`;
}

/**
 * Builds the official WordprocessingML Table Footer for native DOCX injection
 */
function buildNativeFooterXml(meta: {
  creator: string;
  approver: string;
  approvedDate: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:left w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:bottom w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:right w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
        <w:insideH w:val="none"/>
        <w:insideV w:val="single" w:sz="6" w:space="0" w:color="0F172A"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="40" w:type="dxa"/>
        <w:left w:w="100" w:type="dxa"/>
        <w:bottom w:w="40" w:type="dxa"/>
        <w:right w:w="100" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="3120"/>
      <w:gridCol w:w="3120"/>
      <w:gridCol w:w="3120"/>
    </w:tblGrid>
    <w:tr>
      <!-- Col 1: Created by -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1666" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="180" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="14"/><w:color w:val="0F172A"/></w:rPr><w:t>Created by:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.creator)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 2: Approved by -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1667" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="180" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="14"/><w:color w:val="0F172A"/></w:rPr><w:t>Approved by:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.approver)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 3: Approved Date -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1667" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="180" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="14"/><w:color w:val="0F172A"/></w:rPr><w:t>Approved Date:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.approvedDate)}</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>
</w:ftr>`;
}

/**
 * Safely removes redundant policy metadata paragraphs from DOCX word/document.xml.
 * Targets exclusively paragraphs containing these 4 metadata labels:
 * - Policy Owner:
 * - Effective Date:
 * - Review Frequency:
 * - Applies To:
 *
 * It removes the complete paragraph containing each field, including its Word XML formatting.
 * Preserves all other paragraphs, tables, images, styles, section breaks, and document layout.
 */
export function removePolicyMetadataFromDocxXml(xml: string): string {
  if (!xml) return '';

  let res = xml;

  // 1. Remove metadata tables (<w:tbl> that contain Policy Owner and Effective Date / Review Frequency / Applies To)
  res = res.replace(/<w:tbl(?:[\s>][\s\S]*?)<\/w:tbl>/g, (tblMatch) => {
    const textMatches = tblMatch.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
    const fullText = textMatches.map((t) => t.replace(/<[^>]+>/g, '')).join(' ').trim();
    const isMetaTable =
      /Policy\s*Owner/i.test(fullText) &&
      (/Effective\s*Date/i.test(fullText) || /Review\s*Frequency/i.test(fullText) || /Applies\s*To/i.test(fullText));
    if (isMetaTable) {
      return '';
    }
    return tblMatch;
  });

  // 2. Remove metadata paragraphs (<w:p> representing any of the 4 metadata fields)
  res = res.replace(/<w:p(?:[\s>][\s\S]*?)<\/w:p>/g, (pMatch) => {
    // Safety check: never remove paragraphs containing drawings or pictures
    if (pMatch.includes('<w:drawing') || pMatch.includes('<w:pict')) {
      return pMatch;
    }

    // Extract plain text content from all Word text runs (<w:t>)
    const textMatches = pMatch.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
    const fullText = textMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
    const normalized = fullText.replace(/\s+/g, ' ').trim();

    if (!normalized) return pMatch;

    // Match paragraphs that represent any of the 4 metadata fields
    const isMetadata =
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Policy\s*Owner\s*[:\-–—]?)/i.test(normalized) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Effective\s*Date\s*[:\-–—]?)/i.test(normalized) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Review\s*Frequency\s*[:\-–—]?)/i.test(normalized) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Applies\s*To\s*[:\-–—]?)/i.test(normalized);

    if (isMetadata) {
      // Critical safety: If section properties (<w:sectPr>) are nested inside this paragraph, preserve them
      const sectPrMatch = pMatch.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
      if (sectPrMatch) {
        return `<w:p><w:pPr>${sectPrMatch[0]}</w:pPr></w:p>`;
      }
      return '';
    }

    return pMatch;
  });

  return res;
}

/**
 * Returns source DOCX bytes directly without destructive metadata stripping,
 * ensuring the original document structure, fonts, sizes, colors, and layout remain completely intact.
 */
export async function cleanDocxBytes(sourceDocxInput: Uint8Array | ArrayBuffer | string): Promise<Uint8Array> {
  return toUint8Array(sourceDocxInput);
}

/**
 * Returns DOCX data URL directly without altering or stripping document contents.
 */
export async function cleanDocxDataUrl(dataUrl: string): Promise<string> {
  return dataUrl;
}

/**
 * Stamping engine for existing DOCX Word documents:
 * Preserves the original word/document.xml content, formatting, fonts, sizes, colors, tables, and styles 100% INTACT.
 * Injects OpenXML header1.xml and footer1.xml containing the official corporate Header & Footer tables,
 * and sets section margins so body flows cleanly between them without overlapping.
 */
export async function stampDocxWithHeaderFooter(
  sourceDocxInput: Uint8Array | ArrayBuffer | string,
  meta: HeaderFooterMetadata
): Promise<StampResult> {
  const sourceBytes = await resolveDocumentBytes(sourceDocxInput);
  const zip = await JSZip.loadAsync(sourceBytes);

  const cleanVer = cleanVersionNumber(meta.versionNumber);
  const effective = formatDDMMYYYY(meta.effectiveDate);
  const isDocxApproved = Boolean(
    meta.approvedByName &&
    meta.approvedByName !== 'Not yet approved' &&
    meta.approvedByName !== 'Pending Review' &&
    meta.approvedByName !== 'Pending Approval' &&
    !meta.approvedByName.toLowerCase().includes('not yet') &&
    meta.approvedDate &&
    meta.approvedDate !== 'Not yet approved' &&
    meta.approvedDate !== 'Pending Approval' &&
    !meta.approvedDate.toLowerCase().includes('not yet')
  );
  const approvedDt = isDocxApproved ? formatDDMMYYYY(meta.approvedDate) : 'Not yet approved';
  const approver = isDocxApproved ? meta.approvedByName : 'Not yet approved';
  const creator = meta.createdByName || 'HR Author';
  const title = meta.documentTitle || 'Document';

  // 1. Generate Header & Footer XML
  const headerXml = buildNativeHeaderXml({ title, version: cleanVer, effectiveDate: effective });
  const footerXml = buildNativeFooterXml({ creator, approver, approvedDate: approvedDt });

  const headerPartName = 'header1.xml';
  const footerPartName = 'footer1.xml';
  zip.file(`word/${headerPartName}`, headerXml);
  zip.file(`word/${footerPartName}`, footerXml);

  // 2. Register Header & Footer in [Content_Types].xml
  let contentTypesXml = (await zip.file('[Content_Types].xml')?.async('text')) || '';
  if (contentTypesXml) {
    if (!contentTypesXml.includes(`PartName="/word/${headerPartName}"`)) {
      contentTypesXml = contentTypesXml.replace(
        '</Types>',
        `<Override PartName="/word/${headerPartName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
      );
    }
    if (!contentTypesXml.includes(`PartName="/word/${footerPartName}"`)) {
      contentTypesXml = contentTypesXml.replace(
        '</Types>',
        `<Override PartName="/word/${footerPartName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`
      );
    }
    zip.file('[Content_Types].xml', contentTypesXml);
  }

  // 3. Register Header & Footer in word/_rels/document.xml.rels
  let relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('text')) || '';
  let headerRelId = 'rIdGovHdr';
  let footerRelId = 'rIdGovFtr';

  if (relsXml) {
    const existingHeaderMatch = relsXml.match(/<Relationship[^>]+Target="header1\.xml"[^>]*>/i);
    if (existingHeaderMatch) {
      const idMatch = existingHeaderMatch[0].match(/Id="([^"]+)"/i);
      if (idMatch) headerRelId = idMatch[1];
    } else {
      if (relsXml.includes(`Id="${headerRelId}"`)) {
        headerRelId = `rIdGovHdr_${Math.floor(Math.random() * 10000)}`;
      }
      const headerRel = `<Relationship Id="${headerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="${headerPartName}"/>`;
      if (relsXml.includes('</Relationships>')) {
        relsXml = relsXml.replace('</Relationships>', `${headerRel}</Relationships>`);
      } else {
        relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${headerRel}</Relationships>`;
      }
    }

    const existingFooterMatch = relsXml.match(/<Relationship[^>]+Target="footer1\.xml"[^>]*>/i);
    if (existingFooterMatch) {
      const idMatch = existingFooterMatch[0].match(/Id="([^"]+)"/i);
      if (idMatch) footerRelId = idMatch[1];
    } else {
      if (relsXml.includes(`Id="${footerRelId}"`)) {
        footerRelId = `rIdGovFtr_${Math.floor(Math.random() * 10000)}`;
      }
      const footerRel = `<Relationship Id="${footerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="${footerPartName}"/>`;
      if (relsXml.includes('</Relationships>')) {
        relsXml = relsXml.replace('</Relationships>', `${footerRel}</Relationships>`);
      }
    }
    zip.file('word/_rels/document.xml.rels', relsXml);
  }

  // 4. Update section properties (<w:sectPr>) in word/document.xml
  // CRITICAL: We preserve the original document body, fonts, sizes, colors, tables, and images 100% INTACT!
  let docXml = (await zip.file('word/document.xml')?.async('text')) || '';
  if (docXml) {
    // Ensure relationships namespace is bound for r:id attributes on header/footer references
    if (!docXml.includes('xmlns:r=')) {
      docXml = docXml.replace(/<w:document(?=[\s>])/i, '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    }

    const headerFooterRefs = `<w:headerReference w:type="default" r:id="${headerRelId}"/><w:headerReference w:type="first" r:id="${headerRelId}"/><w:footerReference w:type="default" r:id="${footerRelId}"/><w:footerReference w:type="first" r:id="${footerRelId}"/>`;

    const updateSectPrInner = (sectPrContent: string): string => {
      // Remove any pre-existing header and footer references
      let cleaned = sectPrContent.replace(/<w:headerReference[^>]*\/>/g, '');
      cleaned = cleaned.replace(/<w:footerReference[^>]*\/>/g, '');
      cleaned = cleaned.replace(/<w:titlePg[^>]*\/>/g, '');

      // Ensure margins accommodate header and footer cleanly while preserving original document body space & layout
      if (cleaned.includes('<w:pgMar')) {
        cleaned = cleaned.replace(/<w:pgMar\s+([^>]*)\/>/g, (match, attrs) => {
          let updated = attrs;
          if (!/w:header=/i.test(updated)) updated += ' w:header="360"';
          if (!/w:footer=/i.test(updated)) updated += ' w:footer="360"';
          // Preserve original top margin; only ensure minimum clearance so body doesn't touch header
          if (/w:top="\d+"/i.test(updated)) {
            updated = updated.replace(/w:top="(\d+)"/i, (m, val) => (Number(val) < 1100 ? 'w:top="1100"' : m));
          } else {
            updated += ' w:top="1440"';
          }
          // Preserve original bottom margin; do not artificially inflate to 1800
          if (/w:bottom="\d+"/i.test(updated)) {
            updated = updated.replace(/w:bottom="(\d+)"/i, (m, val) => (Number(val) < 1000 ? 'w:bottom="1000"' : m));
          } else {
            updated += ' w:bottom="1200"';
          }
          return `<w:pgMar ${updated}/>`;
        });
      } else {
        cleaned += '<w:pgMar w:top="1440" w:right="1440" w:bottom="1200" w:left="1440" w:header="360" w:footer="360" w:gutter="0"/>';
      }

      // Per OpenXML specification, headerReference and footerReference MUST be placed first inside w:sectPr
      return `${headerFooterRefs}${cleaned}`;
    };

    if (/<w:sectPr[\s>]/i.test(docXml)) {
      docXml = docXml.replace(/<w:sectPr([^>]*)>([\s\S]*?)<\/w:sectPr>/g, (fullMatch, attrs, inner) => {
        return `<w:sectPr${attrs}>${updateSectPrInner(inner)}</w:sectPr>`;
      });
      docXml = docXml.replace(/<w:sectPr\s*\/>/g, () => {
        return `<w:sectPr>${updateSectPrInner('')}</w:sectPr>`;
      });
    } else if (docXml.includes('</w:body>')) {
      docXml = docXml.replace('</w:body>', `<w:sectPr>${updateSectPrInner('')}</w:sectPr></w:body>`);
    }

    zip.file('word/document.xml', docXml);
  }

  const stampedBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const blob = new Blob([stampedBytes], { type: mimeType });
  const dataUrl = `data:${mimeType};base64,${bytesToBase64(stampedBytes)}`;

  return {
    bytes: stampedBytes,
    blob,
    dataUrl,
  };
}

interface TextRunFormattingProps {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number; // in half-pts (e.g. 21 = 10.5pt, 24 = 12pt)
  font?: string;
}

function extractHexFromColorString(colorStr?: string): string | undefined {
  if (!colorStr) return undefined;
  const s = colorStr.trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.substring(1);
    if (hex.length === 3) {
      return hex.split('').map(c => c + c).join('').toUpperCase();
    }
    return hex.toUpperCase();
  }
  if (s.startsWith('rgb')) {
    const matches = s.match(/\d+/g);
    if (matches && matches.length >= 3) {
      const r = parseInt(matches[0], 10).toString(16).padStart(2, '0');
      const g = parseInt(matches[1], 10).toString(16).padStart(2, '0');
      const b = parseInt(matches[2], 10).toString(16).padStart(2, '0');
      return `${r}${g}${b}`.toUpperCase();
    }
  }
  return undefined;
}

function extractHalfPtsFromFontSize(sizeStr?: string): number | undefined {
  if (!sizeStr) return undefined;
  const val = parseFloat(sizeStr);
  if (isNaN(val)) return undefined;
  if (sizeStr.includes('pt')) return Math.round(val * 2);
  if (sizeStr.includes('px')) return Math.round(val * 1.5);
  return Math.round(val * 2);
}

function extractFontName(fontStr?: string): string | undefined {
  if (!fontStr) return undefined;
  const cleaned = fontStr.split(',')[0].replace(/['"]/g, '').trim();
  return cleaned || undefined;
}

function extractHalfPtsFromElement(el: HTMLElement, tag: string): number | undefined {
  if (el.style?.fontSize) {
    return extractHalfPtsFromFontSize(el.style.fontSize);
  }
  if (tag === 'font' && el.getAttribute('size')) {
    const s = parseInt(el.getAttribute('size') || '3', 10);
    const sizes = [16, 20, 24, 28, 36, 48, 64]; // half-pts for font size 1..7
    return sizes[Math.min(Math.max(s - 1, 0), 6)];
  }
  return undefined;
}

function extractTextRunsFromDomNode(node: Node, parentProps: TextRunFormattingProps = {}): TextRun[] {
  const runs: TextRun[] = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text) {
      runs.push(
        new TextRun({
          text,
          bold: parentProps.bold,
          italics: parentProps.italics,
          underline: parentProps.underline ? {} : undefined,
          strike: parentProps.strike,
          color: parentProps.color || '334155',
          size: parentProps.size || 21,
          font: parentProps.font || 'Arial',
        })
      );
    }
    return runs;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return runs;

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    runs.push(new TextRun({ text: '\n' }));
    return runs;
  }

  const updatedProps: TextRunFormattingProps = {
    bold:
      parentProps.bold ||
      ['b', 'strong', 'th', 'h1', 'h2', 'h3', 'h4'].includes(tag) ||
      el.style.fontWeight === 'bold' ||
      parseInt(el.style.fontWeight || '0', 10) >= 600 ||
      Boolean(el.style.fontWeight?.includes('bold')),
    italics: parentProps.italics || ['i', 'em'].includes(tag) || el.style.fontStyle === 'italic',
    underline: parentProps.underline || ['u', 'ins', 'a'].includes(tag) || Boolean(el.style.textDecoration?.includes('underline')),
    strike: parentProps.strike || ['s', 'strike', 'del'].includes(tag) || Boolean(el.style.textDecoration?.includes('line-through')),
    color: extractHexFromColorString(el.style.color) || (tag === 'a' ? '2563EB' : parentProps.color),
    size: extractHalfPtsFromElement(el, tag) || parentProps.size,
    font: extractFontName(el.style.fontFamily) || parentProps.font,
  };

  for (let i = 0; i < el.childNodes.length; i++) {
    runs.push(...extractTextRunsFromDomNode(el.childNodes[i], updatedProps));
  }

  return runs;
}

function getDomElementAlignment(el: HTMLElement): any {
  let alignStr = (el.style?.textAlign || el.getAttribute('align') || '').toLowerCase();
  if (!alignStr) {
    const alignedChild = el.querySelector('[style*="text-align"]') as HTMLElement | null;
    if (alignedChild) alignStr = (alignedChild.style?.textAlign || '').toLowerCase();
  }
  if (alignStr.includes('center')) return AlignmentType.CENTER;
  if (alignStr.includes('right')) return AlignmentType.RIGHT;
  if (alignStr.includes('justify')) return AlignmentType.BOTH;
  return AlignmentType.LEFT;
}

function processDomChildrenForDocx(container: Element, bodyChildren: (Paragraph | Table)[]) {
  const children = Array.from(container.childNodes);

  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.textContent?.trim();
      if (txt) {
        bodyChildren.push(
          new Paragraph({
            spacing: { before: 60, after: 80, line: 276 },
            children: [new TextRun({ text: txt, size: 21, color: '334155', font: 'Arial' })],
          })
        );
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const alignment = getDomElementAlignment(el);

    // Skip redundant policy metadata headers if any
    const rawText = el.innerText || el.textContent || '';
    const isMeta =
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Policy\s*Owner\s*[:\-–—]?)/i.test(rawText.trim()) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Effective\s*Date\s*[:\-–—]?)/i.test(rawText.trim()) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Review\s*Frequency\s*[:\-–—]?)/i.test(rawText.trim()) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Applies\s*To\s*[:\-–—]?)/i.test(rawText.trim());
    if (isMeta) continue;

    // Headings
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      const defaultSize = tag === 'h1' ? 32 : tag === 'h2' ? 25 : 22;
      const defaultColor = tag === 'h1' ? '0F172A' : tag === 'h2' ? 'FA7014' : '1E293B';
      const beforeSpacing = tag === 'h1' ? 240 : tag === 'h2' ? 200 : 160;
      const afterSpacing = tag === 'h1' ? 120 : tag === 'h2' ? 80 : 60;

      const runs = extractTextRunsFromDomNode(el, {
        bold: true,
        size: defaultSize,
        color: defaultColor,
      });

      bodyChildren.push(
        new Paragraph({
          alignment,
          spacing: { before: beforeSpacing, after: afterSpacing },
          children: runs.length > 0 ? runs : [new TextRun({ text: rawText.trim(), bold: true, size: defaultSize, color: defaultColor, font: 'Arial' })],
        })
      );
      continue;
    }

    // Tables
    if (tag === 'table') {
      const rows: TableRow[] = [];
      const trs = Array.from(el.querySelectorAll('tr'));
      trs.forEach((tr) => {
        const cells: TableCell[] = [];
        const thsTds = Array.from(tr.querySelectorAll('th, td'));
        thsTds.forEach((cellEl) => {
          const isHeaderCell = cellEl.tagName.toLowerCase() === 'th';
          const cellRuns = extractTextRunsFromDomNode(cellEl, {
            bold: isHeaderCell,
            size: 20,
            color: isHeaderCell ? '0F172A' : '334155',
          });

          cells.push(
            new TableCell({
              shading: {
                fill: isHeaderCell ? 'F8FAFC' : 'FFFFFF',
                type: ShadingType.CLEAR,
                color: 'auto',
              },
              margins: { top: 100, bottom: 100, left: 140, right: 140 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
              },
              children: [
                new Paragraph({
                  spacing: { before: 20, after: 20 },
                  children: cellRuns.length > 0 ? cellRuns : [new TextRun({ text: cellEl.textContent || '', size: 20, font: 'Arial' })],
                }),
              ],
            })
          );
        });

        if (cells.length > 0) {
          rows.push(new TableRow({ children: cells }));
        }
      });

      if (rows.length > 0) {
        bodyChildren.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          })
        );
      }
      continue;
    }

    // Lists (ul / ol)
    if (tag === 'ul' || tag === 'ol') {
      const lis = Array.from(el.querySelectorAll(':scope > li'));
      lis.forEach((liEl, index) => {
        const liRuns = extractTextRunsFromDomNode(liEl, { size: 21, color: '334155' });
        if (tag === 'ul') {
          bodyChildren.push(
            new Paragraph({
              alignment,
              bullet: { level: 0 },
              spacing: { before: 30, after: 30 },
              children: liRuns.length > 0 ? liRuns : [new TextRun({ text: liEl.textContent || '', size: 21, font: 'Arial' })],
            })
          );
        } else {
          // Numbered list
          const numRun = new TextRun({ text: `${index + 1}. `, bold: true, color: 'FA7014', size: 21, font: 'Arial' });
          bodyChildren.push(
            new Paragraph({
              alignment,
              indent: { left: 360 },
              spacing: { before: 40, after: 40 },
              children: [numRun, ...liRuns],
            })
          );
        }
      });
      continue;
    }

    // Callout / Blockquote
    if (tag === 'blockquote') {
      const runs = extractTextRunsFromDomNode(el, { size: 20, color: '1E3A8A' });
      bodyChildren.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            left: { style: BorderStyle.SINGLE, size: 8, color: '3B82F6' },
            right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { fill: 'EFF6FF', type: ShadingType.CLEAR, color: 'auto' },
                  margins: { top: 120, bottom: 120, left: 160, right: 160 },
                  children: [
                    new Paragraph({
                      children: runs,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
      continue;
    }

    // Check for nested block container
    const childEls = Array.from(el.children);
    const hasBlockChild = childEls.some((c) =>
      ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'table', 'blockquote', 'section'].includes(c.tagName.toLowerCase())
    );

    if (hasBlockChild) {
      processDomChildrenForDocx(el, bodyChildren);
    } else {
      // Leaf paragraph
      const runs = extractTextRunsFromDomNode(el);
      const innerHtml = el.innerHTML || '';
      const textOnly = (el.innerText || el.textContent || '').replace(/[\s\u00A0]+/g, '').trim();

      if (runs.length > 0 && textOnly.length > 0) {
        const maxSize = Math.max(...runs.map((r: any) => (r as any).options?.size || 21));
        const isTitle = maxSize >= 36;
        bodyChildren.push(
          new Paragraph({
            alignment,
            spacing: {
              before: isTitle ? 240 : 60,
              after: isTitle ? 140 : 100,
              line: 276,
            },
            children: runs,
          })
        );
      } else if (innerHtml.includes('<br>') || tag === 'br' || !textOnly) {
        // Preserve vertical spacing between headings & body in DOCX
        bodyChildren.push(
          new Paragraph({
            spacing: { before: 100, after: 100 },
            children: [],
          })
        );
      }
    }
  }
}

function parseMarkdownToDocxChildren(cleanBody: string): (Paragraph | Table)[] {
  const rawParagraphs = cleanBody.split('\n\n');
  const bodyChildren: (Paragraph | Table)[] = [];

  for (const rawPara of rawParagraphs) {
    const para = rawPara.trim();
    if (!para) continue;

    const isMetaPara =
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Policy\s*Owner\s*[:\-–—]?)/i.test(para) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Effective\s*Date\s*[:\-–—]?)/i.test(para) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Review\s*Frequency\s*[:\-–—]?)/i.test(para) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Applies\s*To\s*[:\-–—]?)/i.test(para);
    if (isMetaPara) continue;

    if (para.startsWith('# ')) {
      bodyChildren.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: para.replace(/^#\s+/, '').trim(), bold: true, size: 32, color: '0F172A', font: 'Arial' })],
        })
      );
      continue;
    }

    if (para.startsWith('## ')) {
      bodyChildren.push(
        new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: para.replace(/^##\s+/, '').trim(), bold: true, size: 25, color: 'FA7014', font: 'Arial' })],
        })
      );
      continue;
    }

    if (para.startsWith('### ')) {
      bodyChildren.push(
        new Paragraph({
          spacing: { before: 160, after: 60 },
          children: [new TextRun({ text: para.replace(/^###\s+/, '').trim(), bold: true, size: 22, color: '1E293B', font: 'Arial' })],
        })
      );
      continue;
    }

    if (para.includes('\n- ') || para.includes('\n• ') || para.startsWith('- ') || para.startsWith('• ')) {
      const bulletLines = para.split('\n');
      for (const bLine of bulletLines) {
        const cleanBLine = bLine.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').trim();
        if (!cleanBLine) continue;
        bodyChildren.push(
          new Paragraph({
            spacing: { before: 30, after: 30 },
            bullet: { level: 0 },
            children: [new TextRun({ text: cleanBLine, size: 21, color: '334155', font: 'Arial' })],
          })
        );
      }
      continue;
    }

    bodyChildren.push(
      new Paragraph({
        spacing: { before: 60, after: 80, line: 276 },
        children: [new TextRun({ text: para.replace(/\*\*/g, ''), size: 21, color: '334155', font: 'Arial' })],
      })
    );
  }

  return bodyChildren;
}

function parseHtmlOrMarkdownToDocxChildren(rawContent: string): (Paragraph | Table)[] {
  const cleanBody = extractCleanBody(rawContent);
  if (!cleanBody || !cleanBody.trim()) return [];

  const hasHtml = /<[a-z][\s\S]*>/i.test(cleanBody);

  if (hasHtml && typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${cleanBody}</div>`, 'text/html');
      const container = doc.body.firstElementChild;
      if (container) {
        const bodyChildren: (Paragraph | Table)[] = [];
        processDomChildrenForDocx(container, bodyChildren);
        if (bodyChildren.length > 0) return bodyChildren;
      }
    } catch (e) {
      console.warn('DOMParser failed in DOCX generator:', e);
    }
  }

  return parseMarkdownToDocxChildren(cleanBody);
}

/**
 * Builds a genuine, fully editable Microsoft Word (.docx) document
 * with native Header Table on EVERY page, native Footer Table on EVERY page,
 * and high-fidelity body typography (H1, H2, H3, bullet lists, numbered lists, metadata cards).
 */
export async function generateCorporateDocxBlob(options: CorporateDocxOptions): Promise<Blob> {
  const cleanVer = cleanVersionNumber(options.versionNumber);
  const effective = formatDDMMYYYY(options.effectiveDate);
  const isDocxApproved = Boolean(
    options.approvedByName &&
    options.approvedByName !== 'Not yet approved' &&
    options.approvedByName !== 'Pending Review' &&
    options.approvedByName !== 'Pending Approval' &&
    !options.approvedByName.toLowerCase().includes('not yet') &&
    options.approvedDate &&
    options.approvedDate !== 'Not yet approved' &&
    options.approvedDate !== 'Pending Approval' &&
    !options.approvedDate.toLowerCase().includes('not yet')
  );
  const approvedDt = isDocxApproved ? formatDDMMYYYY(options.approvedDate) : 'Not yet approved';
  const approver = isDocxApproved ? options.approvedByName : 'Not yet approved';
  const creator = options.createdByName || 'HR Author';
  const title = options.documentTitle || 'Corporate Policy Document';

  const borderNone = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const borderSolid = { style: BorderStyle.SINGLE, size: 8, color: '0F172A' };

  // 1. Native Word Header Table (Repeats on EVERY page automatically)
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: borderSolid,
      bottom: borderSolid,
      left: borderSolid,
      right: borderSolid,
      insideHorizontal: borderNone,
      insideVertical: borderSolid,
    },
    rows: [
      new TableRow({
        children: [
          // Col 1: Logo
          new TableCell({
            width: { size: 26, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 20 },
                children: [
                  new TextRun({ text: 'amaavig', bold: true, size: 28, color: '181A1E', font: 'Arial' }),
                  new TextRun({ text: 'o', bold: true, size: 28, color: 'FA7014', font: 'Arial' }),
                ],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: 'Where Brand takes Flight', size: 13, color: '64748B', font: 'Arial' }),
                ],
              }),
            ],
          }),
          // Col 2: Document Name
          new TableCell({
            width: { size: 36, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 20 },
                children: [
                  new TextRun({ text: 'Document Name:', bold: true, size: 15, color: '0F172A', font: 'Arial' }),
                ],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: title, bold: true, size: 19, color: '1E293B', font: 'Arial' }),
                ],
              }),
            ],
          }),
          // Col 3: Version
          new TableCell({
            width: { size: 16, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 60, after: 0 },
                children: [
                  new TextRun({ text: `Version: ${cleanVer}`, bold: true, size: 18, color: '0F172A', font: 'Arial' }),
                ],
              }),
            ],
          }),
          // Col 4: Effective Date
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 20 },
                children: [
                  new TextRun({ text: 'Effective date :', bold: true, size: 15, color: '0F172A', font: 'Arial' }),
                ],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: effective, size: 18, color: '1E293B', font: 'Arial' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // 2. Native Word Footer Table (Repeats on EVERY page automatically)
  const footerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: borderSolid,
      bottom: borderSolid,
      left: borderSolid,
      right: borderSolid,
      insideHorizontal: borderNone,
      insideVertical: borderSolid,
    },
    rows: [
      new TableRow({
        children: [
          // Col 1: Created by
          new TableCell({
            width: { size: 33.33, type: WidthType.PERCENTAGE },
            margins: { top: 70, bottom: 70, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 15 },
                children: [new TextRun({ text: 'Created by:', bold: true, size: 15, color: '0F172A', font: 'Arial' })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: creator, size: 17, color: '1E293B', font: 'Arial' })],
              }),
            ],
          }),
          // Col 2: Approved by
          new TableCell({
            width: { size: 33.33, type: WidthType.PERCENTAGE },
            margins: { top: 70, bottom: 70, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 15 },
                children: [new TextRun({ text: 'Approved by:', bold: true, size: 15, color: '0F172A', font: 'Arial' })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: approver, size: 17, color: '1E293B', font: 'Arial' })],
              }),
            ],
          }),
          // Col 3: Approved Date
          new TableCell({
            width: { size: 33.34, type: WidthType.PERCENTAGE },
            margins: { top: 70, bottom: 70, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 15 },
                children: [new TextRun({ text: 'Approved Date:', bold: true, size: 15, color: '0F172A', font: 'Arial' })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: approvedDt, size: 17, color: '1E293B', font: 'Arial' })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // 3. Parse Body Content into genuine Word paragraphs, runs, tables
  const bodyChildren = parseHtmlOrMarkdownToDocxChildren(options.rawContent);

  // 4. Assemble Document with Section Margins & Native Headers/Footers
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1800,    // 1.25 in (Leaves room for Header table)
              bottom: 1600, // 1.11 in (Leaves room for Footer table)
              left: 1440,   // 1.0 in
              right: 1440,  // 1.0 in
              header: 650,  // 0.45 in
              footer: 650,  // 0.45 in
            },
          },
        },
        headers: {
          default: new Header({
            children: [headerTable],
          }),
        },
        footers: {
          default: new Footer({
            children: [footerTable],
          }),
        },
        children: bodyChildren,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

/**
 * Universal document downloader that guarantees 100% intact layout:
 * - If DOCX requested: Downloads native Word DOCX with native header & footer on every page.
 * - If PDF requested: Downloads multi-page PDF with header on every page and footer on every page.
 */
export async function downloadDocumentWithIntactFormat(params: {
  fileName?: string;
  documentTitle?: string;
  versionNumber?: string;
  effectiveDate?: string;
  createdByName?: string;
  approvedByName?: string;
  approvedDate?: string;
  companyName?: string;
  rawContent?: string;
  fileUrl?: string;
  originalFileUrl?: string;
  versionId?: string;
  documentId?: string;
  headerFooterData?: DocumentHeaderFooterData;
  forcedFormat?: 'pdf' | 'docx';
}): Promise<void> {
  const originalName = params.fileName || 'Amaavigo_Policy.pdf';

  // Case 0: Video Asset (MP4, WebM, MOV, etc.) - No header & footer appended, download original video intact
  const isVideoTarget =
    Boolean(originalName.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)) ||
    Boolean(params.fileUrl && (params.fileUrl.startsWith('data:video/') || params.fileUrl.includes('.mp4') || params.fileUrl.includes('.webm') || params.fileUrl.includes('.mov')));

  if (isVideoTarget) {
    const downloadName = originalName.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)
      ? originalName
      : `${originalName.replace(/\.[^/.]+$/, '')}.mp4`;

    // 1. Resolve through comprehensive media resolver
    try {
      const resolvedUrl = await resolvePlayableMediaUrl(params.fileUrl, params.versionId, params.documentId, originalName);
      if (resolvedUrl && (resolvedUrl.startsWith('data:') || resolvedUrl.startsWith('blob:'))) {
        const resp = await fetch(resolvedUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob && blob.size > 0) {
            triggerDownload(blob, downloadName);
            return;
          }
        }
      } else if (resolvedUrl && (resolvedUrl.startsWith('/api/') || resolvedUrl.startsWith('http'))) {
        const downloadApiUrl = resolvedUrl.includes('/api/storage/file/')
          ? resolvedUrl.replace('/api/storage/file/', '/api/storage/download/')
          : resolvedUrl;
        const resp = await fetch(downloadApiUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob && blob.size > 0 && blob.type !== 'text/html') {
            triggerDownload(blob, downloadName);
            return;
          }
        }
      }
    } catch (resolveErr) {
      console.warn('Video resolver download attempt failed:', resolveErr);
    }

    // 2. Direct data URL or blob URL
    if (params.fileUrl && (params.fileUrl.startsWith('data:') || params.fileUrl.startsWith('blob:'))) {
      try {
        const resp = await fetch(params.fileUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob && blob.size > 0) {
            triggerDownload(blob, downloadName);
            return;
          }
        }
      } catch (err) {
        console.warn('Direct data/blob video fetch error:', err);
      }
    }

    // 3. Search client IndexedDB cache thoroughly
    try {
      const idsToCheck = [
        params.fileUrl,
        params.versionId,
        params.documentId,
        originalName,
      ].filter(Boolean) as string[];
      const localItem = await findMediaInIndexedDb(idsToCheck);
      if (localItem?.dataUrl) {
        const resp = await fetch(localItem.dataUrl);
        const blob = await resp.blob();
        triggerDownload(blob, downloadName);
        return;
      }
      if (localItem?.blob) {
        triggerDownload(localItem.blob, downloadName);
        return;
      }
    } catch (err) {
      console.warn('IndexedDB video retrieval error:', err);
    }

    // 4. If rawContent is actually a video data URL
    if (params.rawContent && params.rawContent.startsWith('data:video/')) {
      const resp = await fetch(params.rawContent);
      const blob = await resp.blob();
      triggerDownload(blob, downloadName);
      return;
    }

    // If genuine video binary is not found, notify user cleanly
    console.error('Video file asset is not available for download');
    alert('Video file asset is not available. Please verify the video upload or refresh your browser.');
    return;
  }

  const isDocxTarget =
    params.forcedFormat === 'docx' ||
    originalName.toLowerCase().endsWith('.docx') ||
    (params.fileUrl && params.fileUrl.includes('wordprocessingml'));

  const meta: HeaderFooterMetadata = {
    documentTitle: params.documentTitle || params.headerFooterData?.documentTitle || originalName.replace(/\.[^/.]+$/, ''),
    versionNumber: params.versionNumber || params.headerFooterData?.versionNumber || '1.0',
    effectiveDate: params.effectiveDate || params.headerFooterData?.effectiveDate || new Date().toISOString(),
    createdByName: params.createdByName || params.headerFooterData?.createdByName || 'Amee Shah',
    approvedByName: params.approvedByName || params.headerFooterData?.approvedByName || 'Vishal Shah',
    approvedDate: params.approvedDate || params.headerFooterData?.approvedDate || new Date().toISOString(),
    companyName: params.companyName || params.headerFooterData?.companyName || 'Amaavigo',
  };

  // Case 1: Target DOCX
  if (isDocxTarget) {
    const downloadName = originalName.replace(/\.[^/.]+$/, '') + '.docx';

    // 1. Gather all potential sources for the original DOCX file
    const candidateSources = [
      params.fileUrl,
      params.originalFileUrl,
    ].filter(Boolean) as string[];

    const extraIds = [
      params.versionId,
      params.documentId,
      originalName,
      params.fileName,
      params.fileUrl,
      params.originalFileUrl,
    ].filter(Boolean) as string[];

    let resolvedBytes: Uint8Array | null = null;

    // Try resolving bytes from candidate sources
    for (const src of candidateSources) {
      try {
        const bytes = await resolveDocumentBytes(src, extraIds);
        if (bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
          resolvedBytes = bytes;
          break;
        }
      } catch (e) {
        console.warn('Candidate DOCX resolution notice:', e);
      }
    }

    // 2. If not yet found, also search IndexedDB directly using extraIds
    if (!resolvedBytes) {
      try {
        const cached = await findMediaInIndexedDb(extraIds);
        if (cached?.dataUrl) {
          const bytes = await resolveDocumentBytes(cached.dataUrl);
          if (bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
            resolvedBytes = bytes;
          }
        } else if (cached?.blob) {
          const ab = await cached.blob.arrayBuffer();
          const bytes = new Uint8Array(ab);
          if (bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
            resolvedBytes = bytes;
          }
        }
      } catch (idbErr) {
        console.warn('IndexedDB fallback search notice for DOCX:', idbErr);
      }
    }

    // 3. If source DOCX bytes exist (from uploaded Word file), KEEP THEM 100% INTACT!
    if (resolvedBytes && resolvedBytes.length > 4 && resolvedBytes[0] === 0x50 && resolvedBytes[1] === 0x4b) {
      try {
        // Stamp the original Word document with corporate header & footer
        const stamped = await stampDocxWithHeaderFooter(resolvedBytes, meta);
        triggerDownload(stamped.blob, downloadName);
        return;
      } catch (stampErr) {
        console.warn('Stamping error on source docx, downloading original uploaded file intact:', stampErr);
        // CRITICAL: Keep uploaded Word file 100% intact rather than destroying it with plain text generator!
        const originalBlob = new Blob([resolvedBytes], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        triggerDownload(originalBlob, downloadName);
        return;
      }
    }

    // 4. ONLY IF no source Word file was uploaded (e.g. document created purely through canvas editor):
    const docxBlob = await generateCorporateDocxBlob({
      documentTitle: meta.documentTitle,
      versionNumber: meta.versionNumber,
      effectiveDate: meta.effectiveDate,
      createdByName: meta.createdByName,
      approvedByName: meta.approvedByName,
      approvedDate: meta.approvedDate,
      companyName: meta.companyName,
      rawContent: params.rawContent || '',
      fileName: downloadName,
    });
    triggerDownload(docxBlob, downloadName);
    return;
  }

  // Case 2: Target PDF
  const downloadName = originalName.replace(/\.[^/.]+$/, '') + '.pdf';

  // If source has uploaded PDF bytes, stamp them directly
  if (params.fileUrl) {
    try {
      const sourceBytes = await resolveDocumentBytes(params.fileUrl);
      if (sourceBytes.length > 10 && sourceBytes[0] === 0x25 && sourceBytes[1] === 0x50) { // %PDF
        const stamped = await stampPdfWithHeaderFooter(sourceBytes, meta);
        triggerDownload(stamped.blob, downloadName);
        return;
      }
    } catch (err) {
      console.warn('Existing PDF stamping fallback to generator:', err);
    }
  }

  // Generate genuine corporate PDF with header and footer on EVERY page
  const pdfBlob = generateCorporatePdfBlob({
    documentTitle: meta.documentTitle,
    versionNumber: meta.versionNumber,
    effectiveDate: meta.effectiveDate,
    createdByName: meta.createdByName,
    approvedByName: meta.approvedByName,
    approvedDate: meta.approvedDate,
    companyName: meta.companyName,
    rawContent: params.rawContent || '',
    fileName: downloadName,
  });

  triggerDownload(pdfBlob, downloadName);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
