import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import {
  DocumentHeaderFooterData,
  cleanVersionNumber,
  formatDDMMYYYY,
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
    // If it's a data URL
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
      // If string is raw binary characters
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
 * Stamping engine for PDF documents:
 * Preserves the original document 100% INTACT (all vectors, pages, fonts, graphics, layouts).
 * Injects the official Amaavigo Header Table at the top of EVERY page
 * and the Governance Approval Footer Sign-Off at the bottom of EVERY page.
 */
export async function stampPdfWithHeaderFooter(
  sourcePdfInput: Uint8Array | ArrayBuffer | string,
  meta: HeaderFooterMetadata
): Promise<StampResult> {
  const sourceBytes = toUint8Array(sourcePdfInput);
  const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pageIndices = srcDoc.getPageIndices();

  const targetDoc = await PDFDocument.create();
  const embeddedPages = await targetDoc.embedPdf(srcDoc, pageIndices);

  const font = await targetDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await targetDoc.embedFont(StandardFonts.HelveticaBold);

  const cleanVer = cleanVersionNumber(meta.versionNumber);
  const effective = formatDDMMYYYY(meta.effectiveDate);
  const approvedDt = formatDDMMYYYY(meta.approvedDate || meta.effectiveDate);
  const creator = meta.createdByName || 'Amee Shah';
  const approver = meta.approvedByName || 'Vishal Shah';
  const title = meta.documentTitle || 'Document';

  for (let i = 0; i < embeddedPages.length; i++) {
    const emb = embeddedPages[i];
    const { width: origW, height: origH } = emb;

    const page = targetDoc.addPage([origW, origH]);

    // Calculate vertical scaling to guarantee the original document content
    // sits neatly between the header and footer without being clipped or overlapped.
    const topReserved = 96; // margin + header height + breathing room
    const bottomReserved = 76; // margin + footer height + breathing room
    const availableH = origH - topReserved - bottomReserved;
    const scale = Math.min(1, availableH / origH);

    const scaledW = origW * scale;
    const scaledH = origH * scale;
    const offsetX = (origW - scaledW) / 2;
    const offsetY = bottomReserved + (availableH - scaledH) / 2;

    // 1. Draw original intact document page
    page.drawPage(emb, {
      x: offsetX,
      y: offsetY,
      xScale: scale,
      yScale: scale,
    });

    // 2. Draw Official Amaavigo Header Table on EVERY page
    const marginX = 36;
    const tableW = origW - 72;
    const headerH = 50;
    const headerY = origH - 32 - headerH;

    // Header Background & Slate Border
    page.drawRectangle({
      x: marginX,
      y: headerY,
      width: tableW,
      height: headerH,
      borderColor: rgb(15 / 255, 23 / 255, 42 / 255),
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });

    // Column boundaries
    const col1W = 125;
    const col2W = 175;
    const col3W = 80;
    const col4W = tableW - col1W - col2W - col3W;

    const col1X = marginX;
    const col2X = col1X + col1W;
    const col3X = col2X + col2W;
    const col4X = col3X + col3W;

    // Column Divider Lines
    page.drawLine({
      start: { x: col2X, y: headerY },
      end: { x: col2X, y: headerY + headerH },
      thickness: 1,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawLine({
      start: { x: col3X, y: headerY },
      end: { x: col3X, y: headerY + headerH },
      thickness: 1,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawLine({
      start: { x: col4X, y: headerY },
      end: { x: col4X, y: headerY + headerH },
      thickness: 1,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Column 1: Amaavigo Logo + Flight Ring + Pip Notch + Tagline
    page.drawText('amaavig', {
      x: col1X + 10,
      y: headerY + 24,
      font: fontBold,
      size: 15,
      color: rgb(24 / 255, 26 / 255, 30 / 255),
    });
    // Orange flight ring "o"
    page.drawCircle({
      x: col1X + 76,
      y: headerY + 29,
      size: 4.5,
      borderColor: rgb(250 / 255, 112 / 255, 20 / 255),
      borderWidth: 2.2,
    });
    // Orange pip notch
    page.drawRectangle({
      x: col1X + 68,
      y: headerY + 36,
      width: 3.2,
      height: 3.2,
      color: rgb(250 / 255, 112 / 255, 20 / 255),
    });
    // Brand Tagline
    page.drawText('Where Brand takes Flight', {
      x: col1X + 10,
      y: headerY + 10,
      font,
      size: 6,
      color: rgb(100 / 255, 116 / 255, 139 / 255),
    });

    // Column 2: Document Name
    page.drawText('Document Name:', {
      x: col2X + 8,
      y: headerY + 32,
      font: fontBold,
      size: 8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    const safeTitle = title.length > 28 ? `${title.substring(0, 26)}...` : title;
    page.drawText(safeTitle, {
      x: col2X + 8,
      y: headerY + 16,
      font: fontBold,
      size: 9.5,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Column 3: Version
    page.drawText(`Version: ${cleanVer}`, {
      x: col3X + 8,
      y: headerY + 22,
      font: fontBold,
      size: 9,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Column 4: Effective Date
    page.drawText('Effective date :', {
      x: col4X + 8,
      y: headerY + 32,
      font: fontBold,
      size: 8,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(effective, {
      x: col4X + 8,
      y: headerY + 16,
      font,
      size: 9,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // 3. Draw Official Governance Approval Footer Table on EVERY page
    const footerH = 36;
    const footerY = 28;

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
      thickness: 1,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawLine({
      start: { x: marginX + footColW * 2, y: footerY },
      end: { x: marginX + footColW * 2, y: footerY + footerH },
      thickness: 1,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });

    // Footer Col 1: Created by
    page.drawText('Created by:', {
      x: marginX + 8,
      y: footerY + 22,
      font: fontBold,
      size: 7.5,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(creator, {
      x: marginX + 8,
      y: footerY + 8,
      font,
      size: 8.5,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Footer Col 2: Approved by
    page.drawText('Approved by:', {
      x: marginX + footColW + 8,
      y: footerY + 22,
      font: fontBold,
      size: 7.5,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(approver, {
      x: marginX + footColW + 8,
      y: footerY + 8,
      font,
      size: 8.5,
      color: rgb(30 / 255, 41 / 255, 59 / 255),
    });

    // Footer Col 3: Approved Date
    page.drawText('Approved Date:', {
      x: marginX + footColW * 2 + 8,
      y: footerY + 22,
      font: fontBold,
      size: 7.5,
      color: rgb(15 / 255, 23 / 255, 42 / 255),
    });
    page.drawText(approvedDt, {
      x: marginX + footColW * 2 + 8,
      y: footerY + 8,
      font,
      size: 8.5,
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
 * Stamping engine for DOCX Word documents:
 * Preserves the original word/document.xml content, formatting, tables, and styles 100% INTACT.
 * Injects OpenXML header1.xml and footer1.xml containing the official Header & Footer tables.
 */
export async function stampDocxWithHeaderFooter(
  sourceDocxInput: Uint8Array | ArrayBuffer | string,
  meta: HeaderFooterMetadata
): Promise<StampResult> {
  const sourceBytes = toUint8Array(sourceDocxInput);
  const zip = await JSZip.loadAsync(sourceBytes);

  const cleanVer = cleanVersionNumber(meta.versionNumber);
  const effective = formatDDMMYYYY(meta.effectiveDate);
  const approvedDt = formatDDMMYYYY(meta.approvedDate || meta.effectiveDate);
  const creator = meta.createdByName || 'Amee Shah';
  const approver = meta.approvedByName || 'Vishal Shah';
  const title = meta.documentTitle || 'Document';

  // 1. Generate Header XML in WordprocessingML
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:left w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:bottom w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:right w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:insideH w:val="none"/>
        <w:insideV w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
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
        <w:tcPr><w:tcW w:w="1350" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="20"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="181A1E"/></w:rPr><w:t>amaavig</w:t></w:r>
          <w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="FA7014"/></w:rPr><w:t>o</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="14"/><w:color w:val="64748B"/></w:rPr><w:t>Where Brand takes Flight</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 2: Document Name -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1850" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="20"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Document Name:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 3: Version -->
      <w:tc>
        <w:tcPr><w:tcW w:w="800" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="60" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="0F172A"/></w:rPr><w:t>Version: ${escapeXml(cleanVer)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 4: Effective Date -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1000" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="20"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Effective date :</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="18"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(effective)}</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>
</w:hdr>`;

  // 2. Generate Footer XML in WordprocessingML
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p><w:pPr><w:spacing w:before="80" w:after="0"/></w:pPr></w:p>
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:left w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:bottom w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:right w:val="single" w:sz="12" w:space="0" w:color="0F172A"/>
        <w:insideH w:val="none"/>
        <w:insideV w:val="single" w:sz="8" w:space="0" w:color="0F172A"/>
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
          <w:pPr><w:spacing w:before="0" w:after="15"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Created by:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(creator)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 2: Approved by -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1667" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="15"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Approved by:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(approver)}</w:t></w:r>
        </w:p>
      </w:tc>
      <!-- Col 3: Approved Date -->
      <w:tc>
        <w:tcPr><w:tcW w:w="1667" w:type="pct"/></w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="15"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="15"/><w:color w:val="0F172A"/></w:rPr><w:t>Approved Date:</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>${escapeXml(approvedDt)}</w:t></w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:ftr>`;

  // Place header & footer files into zip
  zip.file('word/header1.xml', headerXml);
  zip.file('word/footer1.xml', footerXml);

  // 3. Register Header & Footer in [Content_Types].xml
  let contentTypesXml = (await zip.file('[Content_Types].xml')?.async('text')) || '';
  if (!contentTypesXml.includes('/word/header1.xml')) {
    contentTypesXml = contentTypesXml.replace(
      '</Types>',
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
    );
    zip.file('[Content_Types].xml', contentTypesXml);
  }

  // 4. Register Header & Footer in word/_rels/document.xml.rels
  let relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('text')) || '';
  if (!relsXml.includes('Target="header1.xml"')) {
    const headerRel =
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>';
    const footerRel =
      '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>';

    if (relsXml.includes('</Relationships>')) {
      relsXml = relsXml.replace('</Relationships>', `${headerRel}${footerRel}</Relationships>`);
    } else {
      relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${headerRel}${footerRel}</Relationships>`;
    }
    zip.file('word/_rels/document.xml.rels', relsXml);
  }

  // 5. Link Header & Footer inside word/document.xml section properties (<w:sectPr>)
  // KEEPING ALL OTHER DOCUMENT CONTENT COMPLETELY INTACT!
  let docXml = (await zip.file('word/document.xml')?.async('text')) || '';
  if (!docXml.includes('r:id="rIdHeader1"')) {
    const headerFooterRefs =
      '<w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/>';

    if (docXml.includes('<w:sectPr>')) {
      docXml = docXml.replace('<w:sectPr>', `<w:sectPr>${headerFooterRefs}`);
    } else if (docXml.includes('<w:sectPr ')) {
      docXml = docXml.replace(/(<w:sectPr[^>]*>)/, `$1${headerFooterRefs}`);
    } else if (docXml.includes('</w:body>')) {
      docXml = docXml.replace('</w:body>', `<w:sectPr>${headerFooterRefs}</w:sectPr></w:body>`);
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
 * Universal document downloader that preserves original formatting 100%:
 * - If PDF: Stamped with pdf-lib so original document layout is intact with Header & Footer on every page.
 * - If DOCX: Stamped with JSZip so original Word layout is intact with Header & Footer tables.
 * - If Text / Markdown: Renders via corporate PDF generator.
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
  const isDocx = originalName.toLowerCase().endsWith('.docx') || (params.fileUrl && params.fileUrl.includes('wordprocessingml'));
  const isPdf = originalName.toLowerCase().endsWith('.pdf') || (params.fileUrl && (params.fileUrl.includes('application/pdf') || params.fileUrl.startsWith('data:application/pdf')));

  const meta: HeaderFooterMetadata = {
    documentTitle: params.documentTitle || params.headerFooterData?.documentTitle || originalName.replace(/\.[^/.]+$/, ''),
    versionNumber: params.versionNumber || params.headerFooterData?.versionNumber || '1.0',
    effectiveDate: params.effectiveDate || params.headerFooterData?.effectiveDate || new Date().toISOString(),
    createdByName: params.createdByName || params.headerFooterData?.createdByName || 'Amee Shah',
    approvedByName: params.approvedByName || params.headerFooterData?.approvedByName || 'Vishal Shah',
    approvedDate: params.approvedDate || params.headerFooterData?.approvedDate || new Date().toISOString(),
    companyName: params.companyName || params.headerFooterData?.companyName || 'Amaavigo',
  };

  // Case 1: PDF Document (Intact modification via pdf-lib)
  if (isPdf && params.forcedFormat !== 'docx') {
    const downloadName = originalName.endsWith('.pdf') ? originalName : `${originalName.replace(/\.[^/.]+$/, '')}.pdf`;

    // Retrieve original PDF bytes
    let sourceBytes: Uint8Array | null = null;
    if (params.fileUrl && (params.fileUrl.startsWith('data:') || params.fileUrl.startsWith('blob:'))) {
      if (params.fileUrl.startsWith('data:')) {
        sourceBytes = toUint8Array(params.fileUrl);
      } else {
        const resp = await fetch(params.fileUrl);
        const buf = await resp.arrayBuffer();
        sourceBytes = new Uint8Array(buf);
      }
    } else if (params.rawContent && (params.rawContent.startsWith('%PDF') || params.rawContent.includes('%PDF'))) {
      sourceBytes = toUint8Array(params.rawContent);
    }

    if (sourceBytes) {
      try {
        const stamped = await stampPdfWithHeaderFooter(sourceBytes, meta);
        triggerDownload(stamped.blob, downloadName);
        return;
      } catch (err) {
        console.warn('PDF-lib stamping error, falling back to corporate generator:', err);
      }
    }
  }

  // Case 2: DOCX Document (Intact OpenXML modification via JSZip)
  if (isDocx && params.forcedFormat !== 'pdf') {
    const downloadName = originalName.endsWith('.docx') ? originalName : `${originalName.replace(/\.[^/.]+$/, '')}.docx`;

    let sourceBytes: Uint8Array | null = null;
    if (params.fileUrl && (params.fileUrl.startsWith('data:') || params.fileUrl.startsWith('blob:'))) {
      if (params.fileUrl.startsWith('data:')) {
        sourceBytes = toUint8Array(params.fileUrl);
      } else {
        const resp = await fetch(params.fileUrl);
        const buf = await resp.arrayBuffer();
        sourceBytes = new Uint8Array(buf);
      }
    }

    if (sourceBytes) {
      try {
        const stamped = await stampDocxWithHeaderFooter(sourceBytes, meta);
        triggerDownload(stamped.blob, downloadName);
        return;
      } catch (err) {
        console.warn('DOCX stamping error, falling back to corporate generator:', err);
      }
    }
  }

  // Fallback: Synthesize corporate PDF from content
  const fallbackPdfBlob = generateCorporatePdfBlob({
    documentTitle: meta.documentTitle,
    versionNumber: meta.versionNumber,
    effectiveDate: meta.effectiveDate,
    createdByName: meta.createdByName,
    approvedByName: meta.approvedByName,
    approvedDate: meta.approvedDate,
    companyName: meta.companyName,
    rawContent: params.rawContent || '',
    fileName: originalName,
  });

  const finalPdfName = originalName.replace(/\.[^/.]+$/, '') + '.pdf';
  triggerDownload(fallbackPdfBlob, finalPdfName);
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
