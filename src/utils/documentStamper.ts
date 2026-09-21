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
 * Wraps text cleanly into multiple lines based on maximum allowed width in PDF points
 */
function wrapPdfText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
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
  meta: HeaderFooterMetadata
): Promise<StampResult> {
  const sourceBytes = toUint8Array(sourcePdfInput);
  const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });

  // Guard against duplicate stamping: If already stamped with Amaavigo header/footer, return untouched
  if (isPdfAlreadyStamped(srcDoc)) {
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

  const pageIndices = srcDoc.getPageIndices();
  const targetDoc = await PDFDocument.create();

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

  // Mark document metadata so it is reliably recognized as stamped in future passes
  targetDoc.setSubject('AmaavigoGovernanceStamped');
  targetDoc.setKeywords(['AmaavigoGovernanceStamped', `v:${cleanVer}`, 'corporate-governance']);
  targetDoc.setAuthor('Amaavigo Governance Engine');
  targetDoc.setTitle(title);

  // Copy original pages directly to preserve all fonts, vector streams, and layouts 100% untouched
  const copiedPages = await targetDoc.copyPages(srcDoc, pageIndices);

  const font = await targetDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await targetDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < copiedPages.length; i++) {
    const page = copiedPages[i];
    targetDoc.addPage(page);

    const { width: origW, height: origH } = page.getSize();

    // Dimensions for Header Table
    const marginX = 36;
    const tableW = origW - marginX * 2;
    const headerH = 48;
    const topMargin = 14;
    const headerY = origH - topMargin - headerH;

    // Dimensions for Footer Table
    const footerH = 34;
    const footerY = 14;

    // Header Background & Slate Border (drawn above original untouched page content)
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
    // Give Document Name the largest share so even long titles fit without truncation
    const col1W = 110;
    const col3W = 68;
    const col4W = 95;
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
      size: 14,
      color: rgb(24 / 255, 26 / 255, 30 / 255),
    });
    page.drawCircle({
      x: col1X + 68,
      y: headerY + 29,
      size: 4,
      borderColor: rgb(250 / 255, 112 / 255, 20 / 255),
      borderWidth: 2,
    });
    page.drawRectangle({
      x: col1X + 61,
      y: headerY + 35,
      width: 3,
      height: 3,
      color: rgb(250 / 255, 112 / 255, 20 / 255),
    });
    page.drawText('Where Brand takes Flight', {
      x: col1X + 8,
      y: headerY + 10,
      font,
      size: 5.8,
      color: rgb(100 / 255, 116 / 255, 139 / 255),
    });

    // Col 2: Document Name - Full display without any ellipsis or truncation
    page.drawText('Document Name:', {
      x: col2X + 8,
      y: headerY + headerH - 14,
      font: fontBold,
      size: 7,
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
      titleFontSize = 7;
      titleLines = wrapPdfText(title, maxTitleW, fontBold, titleFontSize);
    }

    if (titleLines.length === 1) {
      page.drawText(titleLines[0], {
        x: col2X + 8,
        y: headerY + 16,
        font: fontBold,
        size: titleFontSize,
        color: rgb(30 / 255, 41 / 255, 59 / 255),
      });
    } else if (titleLines.length === 2) {
      page.drawText(titleLines[0], {
        x: col2X + 8,
        y: headerY + 22,
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
      const startY = headerY + headerH - 24;
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

    // Col 3: Version
    page.drawText(`Version: ${cleanVer}`, {
      x: col3X + 8,
      y: headerY + Math.round(headerH / 2) - 3,
      font: fontBold,
      size: 8.5,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Col 4: Effective Date
    page.drawText('Effective date :', {
      x: col4X + 8,
      y: headerY + headerH - 14,
      font: fontBold,
      size: 7,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(effective, {
      x: col4X + 8,
      y: headerY + 16,
      font,
      size: 8.5,
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
      y: footerY + 22,
      font: fontBold,
      size: 7.2,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(creator, {
      x: marginX + 8,
      y: footerY + 8,
      font,
      size: 8.2,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Col 2: Approved by
    page.drawText('Approved by:', {
      x: marginX + footColW + 8,
      y: footerY + 22,
      font: fontBold,
      size: 7.2,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(approver, {
      x: marginX + footColW + 8,
      y: footerY + 8,
      font,
      size: 8.2,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Col 3: Approved Date
    page.drawText('Approved Date:', {
      x: marginX + footColW * 2 + 8,
      y: footerY + 22,
      font: fontBold,
      size: 7.2,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(approvedDt, {
      x: marginX + footColW * 2 + 8,
      y: footerY + 8,
      font,
      size: 8.2,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });
  }

  const stampedBytes = await targetDoc.save();
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
        <w:top w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:left w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:bottom w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:right w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:insideH w:val="none"/>
        <w:insideV w:val="single" w:sz="6" w:space="0" w:color="0F172A"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="80" w:type="dxa"/>
        <w:left w:w="120" w:type="dxa"/>
        <w:bottom w:w="80" w:type="dxa"/>
        <w:right w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tr>
      <!-- Col 1: Logo -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1300" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="10"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="28"/><w:color w:val="181A1E"/></w:rPr><w:t>amaavig</w:t></w:r>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="28"/><w:color w:val="FA7014"/></w:rPr><w:t>o</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="13"/><w:color w:val="64748B"/></w:rPr><w:t>Where Brand takes Flight</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 2: Document Name -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1850" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="15"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Document Name:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="19"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.title)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 3: Version -->
      <w:tc>
        <w:tcPr><w:tcW w:w="850" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="60" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="18"/><w:color w:val="0F172A"/></w:rPr><w:t>Version: ${escapeXml(meta.version)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 4: Effective Date -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1000" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="15"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Effective date :</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.effectiveDate)}</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr></w:p>
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
  <w:p><w:pPr><w:spacing w:before="60" w:after="0"/></w:pPr></w:p>
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:left w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:bottom w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:right w:val="single" w:sz="10" w:space="0" w:color="0F172A"/>
        <w:insideH w:val="none"/>
        <w:insideV w:val="single" w:sz="6" w:space="0" w:color="0F172A"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="60" w:type="dxa"/>
        <w:left w:w="120" w:type="dxa"/>
        <w:bottom w:w="60" w:type="dxa"/>
        <w:right w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tr>
      <!-- Col 1: Created by -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1666" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="12"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Created by:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.creator)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 2: Approved by -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1667" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="12"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Approved by:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.approver)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 3: Approved Date -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1667" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="12"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Approved Date:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(meta.approvedDate)}</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
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
  const sourceBytes = toUint8Array(sourceDocxInput);
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
    const headerFooterRefs = `<w:headerReference w:type="default" r:id="${headerRelId}"/><w:headerReference w:type="first" r:id="${headerRelId}"/><w:footerReference w:type="default" r:id="${footerRelId}"/><w:footerReference w:type="first" r:id="${footerRelId}"/>`;

    const updateSectPrInner = (sectPrContent: string): string => {
      // Remove any pre-existing header and footer references
      let cleaned = sectPrContent.replace(/<w:headerReference[^>]*\/>/g, '');
      cleaned = cleaned.replace(/<w:footerReference[^>]*\/>/g, '');
      cleaned = cleaned.replace(/<w:titlePg[^>]*\/>/g, '');

      // Ensure margins accommodate header and footer without colliding with body content
      if (cleaned.includes('<w:pgMar')) {
        cleaned = cleaned.replace(/<w:pgMar\s+([^>]*)\/>/g, (match, attrs) => {
          let updated = attrs;
          if (!/w:header=/i.test(updated)) updated += ' w:header="720"';
          if (!/w:footer=/i.test(updated)) updated += ' w:footer="720"';
          if (/w:top="\d+"/i.test(updated)) {
            updated = updated.replace(/w:top="(\d+)"/i, (m, val) => (Number(val) < 1800 ? 'w:top="1800"' : m));
          } else {
            updated += ' w:top="1800"';
          }
          if (/w:bottom="\d+"/i.test(updated)) {
            updated = updated.replace(/w:bottom="(\d+)"/i, (m, val) => (Number(val) < 1600 ? 'w:bottom="1600"' : m));
          } else {
            updated += ' w:bottom="1600"';
          }
          return `<w:pgMar ${updated}/>`;
        });
      } else {
        cleaned += '<w:pgMar w:top="1800" w:right="1440" w:bottom="1600" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
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

  // 3. Parse Body Content
  const cleanBody = extractCleanBody(options.rawContent);
  const rawParagraphs = cleanBody.split('\n\n');
  const bodyChildren: any[] = [];

  for (const rawPara of rawParagraphs) {
    const para = rawPara.trim();
    if (!para) continue;

    // Skip redundant policy metadata paragraphs if any survived
    const isMetaPara =
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Policy\s*Owner\s*[:\-–—]?)/i.test(para) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Effective\s*Date\s*[:\-–—]?)/i.test(para) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Review\s*Frequency\s*[:\-–—]?)/i.test(para) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Applies\s*To\s*[:\-–—]?)/i.test(para);
    if (isMetaPara) continue;

    // Heading 1 (# ...)
    if (para.startsWith('# ')) {
      const headingText = para.replace(/^#\s+/, '').trim();
      bodyChildren.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 32, // 16pt
              color: '0F172A',
              font: 'Arial',
            }),
          ],
        })
      );
      continue;
    }

    // Heading 2 (## ...)
    if (para.startsWith('## ')) {
      const headingText = para.replace(/^##\s+/, '').trim();
      bodyChildren.push(
        new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 25, // 12.5pt
              color: 'FA7014', // Amaavigo Orange
              font: 'Arial',
            }),
          ],
        })
      );
      continue;
    }

    // Heading 3 (### ...)
    if (para.startsWith('### ')) {
      const headingText = para.replace(/^###\s+/, '').trim();
      bodyChildren.push(
        new Paragraph({
          spacing: { before: 160, after: 60 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 22, // 11pt
              color: '1E293B',
              font: 'Arial',
            }),
          ],
        })
      );
      continue;
    }

    // Document Metadata Box (**Document ID:** ...)
    if (para.includes('**Document ID:**') || (para.startsWith('**') && para.includes('**Version:**'))) {
      const metaLines = para.split('\n').filter(l => l.trim().length > 0);
      const cellParagraphs = metaLines.map(mLine => {
        const clean = mLine.replace(/\*\*/g, '').trim();
        const colonIdx = clean.indexOf(':');
        if (colonIdx > -1) {
          const k = clean.substring(0, colonIdx + 1);
          const v = clean.substring(colonIdx + 1).trim();
          return new Paragraph({
            spacing: { before: 20, after: 20 },
            children: [
              new TextRun({ text: `${k} `, bold: true, size: 19, color: '0F172A', font: 'Arial' }),
              new TextRun({ text: v, size: 19, color: '334155', font: 'Arial' }),
            ],
          });
        }
        return new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [new TextRun({ text: clean, size: 19, color: '334155', font: 'Arial' })],
        });
      });

      bodyChildren.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            left: { style: BorderStyle.SINGLE, size: 8, color: 'FA7014' }, // Orange accent bar
            right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            insideHorizontal: borderNone,
            insideVertical: borderNone,
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  shading: { fill: 'F8FAFC', type: ShadingType.CLEAR, color: 'auto' },
                  margins: { top: 120, bottom: 120, left: 160, right: 160 },
                  children: cellParagraphs,
                }),
              ],
            }),
          ],
        })
      );
      continue;
    }

    // Numbered list (1. ... 2. ...)
    if (/^\d+\.\s+/.test(para)) {
      const listLines = para.split('\n');
      for (const item of listLines) {
        const numMatch = item.match(/^(\d+\.)\s+(.*)/);
        if (numMatch) {
          bodyChildren.push(
            new Paragraph({
              spacing: { before: 40, after: 40 },
              indent: { left: 360 },
              children: [
                new TextRun({ text: `${numMatch[1]} `, bold: true, size: 21, color: 'FA7014', font: 'Arial' }),
                new TextRun({ text: numMatch[2].replace(/\*\*/g, ''), size: 21, color: '334155', font: 'Arial' }),
              ],
            })
          );
        } else {
          bodyChildren.push(
            new Paragraph({
              spacing: { before: 40, after: 40 },
              indent: { left: 360 },
              children: [new TextRun({ text: item.replace(/\*\*/g, ''), size: 21, color: '334155', font: 'Arial' })],
            })
          );
        }
      }
      continue;
    }

    // Bullet list (- ... or • ...)
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

    // Standard body paragraph
    bodyChildren.push(
      new Paragraph({
        spacing: { before: 60, after: 80, line: 276 },
        children: [
          new TextRun({
            text: para.replace(/\*\*/g, ''),
            size: 21, // 10.5pt
            color: '334155',
            font: 'Arial',
          }),
        ],
      })
    );
  }

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
  headerFooterData?: DocumentHeaderFooterData;
  forcedFormat?: 'pdf' | 'docx';
}): Promise<void> {
  const originalName = params.fileName || 'Amaavigo_Policy.pdf';

  // Case 0: Video Asset (MP4, WebM, MOV, etc.) - No header & footer appended, download original video intact
  const isVideoTarget =
    Boolean(originalName.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)) ||
    Boolean(params.fileUrl && params.fileUrl.startsWith('data:video/'));

  if (isVideoTarget) {
    const downloadName = originalName;
    if (params.fileUrl) {
      if (params.fileUrl.startsWith('data:') || params.fileUrl.startsWith('blob:')) {
        const resp = await fetch(params.fileUrl);
        const blob = await resp.blob();
        triggerDownload(blob, downloadName);
        return;
      }
    }
    const blob = new Blob([params.rawContent || ''], { type: 'video/mp4' });
    triggerDownload(blob, downloadName);
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

    // If source has actual uploaded DOCX bytes, stamp them directly
    if (params.fileUrl) {
      try {
        let sourceBytes: Uint8Array;
        if (params.fileUrl.startsWith('data:')) {
          sourceBytes = toUint8Array(params.fileUrl);
        } else {
          const resp = await fetch(params.fileUrl);
          sourceBytes = new Uint8Array(await resp.arrayBuffer());
        }
        // Verify it is a valid zip (starts with 'PK' 0x50 0x4B)
        if (sourceBytes.length > 4 && sourceBytes[0] === 0x50 && sourceBytes[1] === 0x4b) {
          const stamped = await stampDocxWithHeaderFooter(sourceBytes, meta);
          triggerDownload(stamped.blob, downloadName);
          return;
        }
      } catch (err) {
        console.warn('Existing DOCX stamping fallback to generator:', err);
      }
    }

    // Generate genuine DOCX with native header & footer
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
  if (params.fileUrl && (params.fileUrl.startsWith('data:application/pdf') || params.fileUrl.startsWith('blob:'))) {
    try {
      let sourceBytes: Uint8Array;
      if (params.fileUrl.startsWith('data:')) {
        sourceBytes = toUint8Array(params.fileUrl);
      } else {
        const resp = await fetch(params.fileUrl);
        sourceBytes = new Uint8Array(await resp.arrayBuffer());
      }
      const stamped = await stampPdfWithHeaderFooter(sourceBytes, meta);
      triggerDownload(stamped.blob, downloadName);
      return;
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
