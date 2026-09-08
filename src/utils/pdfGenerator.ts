import { jsPDF } from 'jspdf';
import {
  DocumentHeaderFooterData,
  cleanVersionNumber,
  formatDDMMYYYY,
  extractCleanBody,
  extractHeaderFooterData,
} from './documentHeaderFooter';

export interface CorporatePdfOptions {
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

/**
 * Draws the official Amaavigo Corporate Header Table on any given page.
 * Table Dimensions: marginX = 40pt, width = 515.28pt, y = 32pt, height = 52pt.
 */
export function drawCorporateHeaderTable(
  doc: jsPDF,
  meta: {
    title: string;
    version: string;
    effectiveDate: string;
  },
  marginX: number,
  contentWidth: number,
  headerY = 32,
  headerHeight = 52
) {
  // Outer border & background
  doc.setFillColor(255, 255, 255);
  doc.rect(marginX, headerY, contentWidth, headerHeight, 'F');
  doc.setDrawColor(15, 23, 42); // slate-900
  doc.setLineWidth(1.3);
  doc.rect(marginX, headerY, contentWidth, headerHeight, 'S');

  // Column Boundaries
  const col1W = 125; // Logo
  const col2W = 175; // Document Name
  const col3W = 82;  // Version
  const col4W = contentWidth - col1W - col2W - col3W; // ~133.28 pt Effective Date

  const col1X = marginX;
  const col2X = col1X + col1W;
  const col3X = col2X + col2W;
  const col4X = col3X + col3W;

  // Column Dividers
  doc.setLineWidth(0.8);
  doc.line(col2X, headerY, col2X, headerY + headerHeight);
  doc.line(col3X, headerY, col3X, headerY + headerHeight);
  doc.line(col4X, headerY, col4X, headerY + headerHeight);

  // Column 1: Amaavigo Brand Logo (Wordmark + Pip Notch + Ring)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(24, 26, 30);
  doc.text('amaavig', col1X + 10, headerY + 25);

  // Brand Orange Mark: "o" ring and pip notch (#FA7014 -> 250, 112, 20)
  doc.setFillColor(250, 112, 20);
  doc.setDrawColor(250, 112, 20);
  // Pip notch
  doc.rect(col1X + 70, headerY + 14, 3.2, 3.2, 'F');
  // Ring
  doc.setLineWidth(2.2);
  doc.circle(col1X + 77, headerY + 22, 4.2, 'S');

  // Brand Tagline
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('Where Brand takes Flight', col1X + 10, headerY + 39);

  // Column 2: Document Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Document Name:', col2X + 8, headerY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59); // slate-800
  const titleLines = doc.splitTextToSize(meta.title, col2W - 16);
  doc.text(titleLines.slice(0, 2), col2X + 8, headerY + 29);

  // Column 3: Version
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Version: ${meta.version}`, col3X + 8, headerY + 30);

  // Column 4: Effective Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Effective date :', col4X + 8, headerY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(meta.effectiveDate, col4X + 8, headerY + 30);
}

/**
 * Draws the official Amaavigo Governance Approval Footer Table on any given page.
 * Table Dimensions: marginX = 40pt, width = 515.28pt, y = 760pt, height = 40pt.
 */
export function drawCorporateFooterTable(
  doc: jsPDF,
  meta: {
    creator: string;
    approver: string;
    approvedDate: string;
  },
  marginX: number,
  contentWidth: number,
  footerY = 760,
  footerHeight = 40
) {
  // Outer border & background
  doc.setFillColor(255, 255, 255);
  doc.rect(marginX, footerY, contentWidth, footerHeight, 'F');
  doc.setDrawColor(15, 23, 42); // slate-900
  doc.setLineWidth(1.3);
  doc.rect(marginX, footerY, contentWidth, footerHeight, 'S');

  const fColW = contentWidth / 3;
  const fCol1X = marginX;
  const fCol2X = fCol1X + fColW;
  const fCol3X = fCol2X + fColW;

  // Footer Column Dividers
  doc.setLineWidth(0.8);
  doc.line(fCol2X, footerY, fCol2X, footerY + footerHeight);
  doc.line(fCol3X, footerY, fCol3X, footerY + footerHeight);

  // Col 1: Created by
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Created by:', fCol1X + 10, footerY + 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(meta.creator, fCol1X + 10, footerY + 29);

  // Col 2: Approved by
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Approved by:', fCol2X + 10, footerY + 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(meta.approver, fCol2X + 10, footerY + 29);

  // Col 3: Approved Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Approved Date:', fCol3X + 10, footerY + 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(meta.approvedDate, fCol3X + 10, footerY + 29);
}

/**
 * Generates a fully compliant, production-grade PDF document
 * with official Amaavigo corporate header table on EVERY page,
 * official governance approval footer sign-off on EVERY page,
 * and body content flowing naturally between them without overlapping or compression.
 */
export function generateCorporatePdfBlob(options: CorporatePdfOptions): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // 841.89 pt
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2; // ~515.28 pt

  const headerY = 32;
  const headerHeight = 52;
  const footerHeight = 40;
  const footerY = 760;

  // Content flow boundaries (zero overlap with header or footer)
  const contentStartY = 100; // 16pt below header
  const contentEndY = 746;   // 14pt above footer

  const cleanVer = cleanVersionNumber(options.versionNumber);
  const effective = formatDDMMYYYY(options.effectiveDate);
  const isPdfApproved = Boolean(
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
  const approvedDt = isPdfApproved ? formatDDMMYYYY(options.approvedDate) : 'Not yet approved';
  const approver = isPdfApproved ? options.approvedByName : 'Not yet approved';
  const creator = options.createdByName || 'HR Author';
  const title = options.documentTitle || 'Corporate Policy Document';

  const headerMeta = { title, version: cleanVer, effectiveDate: effective };
  const footerMeta = { creator, approver, approvedDate: approvedDt };

  // Helper to decorate any active page with official Header & Footer
  const decoratePage = () => {
    drawCorporateHeaderTable(doc, headerMeta, marginX, contentWidth, headerY, headerHeight);
    drawCorporateFooterTable(doc, footerMeta, marginX, contentWidth, footerY, footerHeight);
  };

  // Draw Page 1 decoration
  decoratePage();

  let cursorY = contentStartY;

  const addNewPage = () => {
    doc.addPage();
    decoratePage();
    cursorY = contentStartY;
  };

  // Extract clean body content (stripping any accidental duplicate HTML table markers)
  const cleanBody = extractCleanBody(options.rawContent);
  const rawParagraphs = cleanBody.split('\n\n');

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

    // Check for Document Metadata properties (e.g. **Document ID:** ... \n **Version:** ...)
    if (para.includes('**Document ID:**') || (para.startsWith('**') && para.includes('**Version:**'))) {
      const metaLines = para.split('\n').filter(l => l.trim().length > 0);
      const boxHeight = metaLines.length * 16 + 16;

      if (cursorY + boxHeight > contentEndY) {
        addNewPage();
      }

      // Draw subtle metadata card
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(marginX, cursorY, contentWidth, boxHeight, 'F');
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(1);
      doc.rect(marginX, cursorY, contentWidth, boxHeight, 'S');

      let mY = cursorY + 16;
      for (const mLine of metaLines) {
        const cleanLine = mLine.replace(/\*\*/g, '').trim();
        const colonIdx = cleanLine.indexOf(':');
        if (colonIdx > -1) {
          const key = cleanLine.substring(0, colonIdx + 1);
          const val = cleanLine.substring(colonIdx + 1).trim();

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(15, 23, 42); // slate-900
          doc.text(key, marginX + 14, mY);

          const keyWidth = doc.getTextWidth(key);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(71, 85, 105); // slate-600
          doc.text(val, marginX + 18 + keyWidth, mY);
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(71, 85, 105);
          doc.text(cleanLine, marginX + 14, mY);
        }
        mY += 16;
      }

      cursorY += boxHeight + 14;
      continue;
    }

    // Check for Heading 1 (# ...)
    if (para.startsWith('# ')) {
      const headingText = para.replace(/^#\s+/, '').trim();
      const headingHeight = 28;

      if (cursorY + headingHeight + 20 > contentEndY) {
        addNewPage();
      } else if (cursorY > contentStartY + 10) {
        cursorY += 8;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14.5);
      doc.setTextColor(15, 23, 42); // slate-900
      const lines = doc.splitTextToSize(headingText, contentWidth);
      doc.text(lines, marginX, cursorY + 14);
      cursorY += lines.length * 18 + 4;

      // Divider below H1
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(1);
      doc.line(marginX, cursorY, marginX + contentWidth, cursorY);
      cursorY += 12;
      continue;
    }

    // Check for Heading 2 (## ...)
    if (para.startsWith('## ')) {
      const headingText = para.replace(/^##\s+/, '').trim();
      const headingHeight = 24;

      if (cursorY + headingHeight + 16 > contentEndY) {
        addNewPage();
      } else if (cursorY > contentStartY + 10) {
        cursorY += 10;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(250, 112, 20); // Amaavigo Brand Orange accent for H2
      const lines = doc.splitTextToSize(headingText, contentWidth);
      doc.text(lines, marginX, cursorY + 12);
      cursorY += lines.length * 15 + 6;
      continue;
    }

    // Check for Heading 3 (### ...)
    if (para.startsWith('### ')) {
      const headingText = para.replace(/^###\s+/, '').trim();
      const headingHeight = 20;

      if (cursorY + headingHeight + 12 > contentEndY) {
        addNewPage();
      } else if (cursorY > contentStartY + 10) {
        cursorY += 6;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(30, 41, 59); // slate-800
      const lines = doc.splitTextToSize(headingText, contentWidth);
      doc.text(lines, marginX, cursorY + 10);
      cursorY += lines.length * 14 + 4;
      continue;
    }

    // Check for Numbered list items (e.g. 1. ... \n 2. ...)
    if (/^\d+\.\s+/.test(para)) {
      const listLines = para.split('\n');
      for (const item of listLines) {
        const numMatch = item.match(/^(\d+\.)\s+(.*)/);
        if (numMatch) {
          const numPrefix = numMatch[1];
          const textContent = numMatch[2].replace(/\*\*/g, '');

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.8);
          const wrapped = doc.splitTextToSize(textContent, contentWidth - 24);
          const itemHeight = wrapped.length * 14 + 4;

          if (cursorY + itemHeight > contentEndY) {
            addNewPage();
          }

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(250, 112, 20); // Amaavigo Orange
          doc.text(numPrefix, marginX + 4, cursorY + 10);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85); // slate-700
          doc.text(wrapped, marginX + 24, cursorY + 10);

          cursorY += itemHeight;
        } else {
          // Standard line within numbered block
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.8);
          doc.setTextColor(51, 65, 85);
          const wrapped = doc.splitTextToSize(item, contentWidth - 24);
          const itemHeight = wrapped.length * 14 + 4;

          if (cursorY + itemHeight > contentEndY) {
            addNewPage();
          }

          doc.text(wrapped, marginX + 24, cursorY + 10);
          cursorY += itemHeight;
        }
      }
      cursorY += 8;
      continue;
    }

    // Check for bullet list block (- ... or • ...)
    if (para.includes('\n- ') || para.includes('\n• ') || para.startsWith('- ') || para.startsWith('• ')) {
      const bulletLines = para.split('\n');
      for (const bLine of bulletLines) {
        const cleanBLine = bLine.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').trim();
        if (!cleanBLine) continue;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.8);
        const wrapped = doc.splitTextToSize(cleanBLine, contentWidth - 20);
        const blockHeight = wrapped.length * 14 + 4;

        if (cursorY + blockHeight > contentEndY) {
          addNewPage();
        }

        // Draw bullet dot
        doc.setFillColor(250, 112, 20); // Amaavigo Orange
        doc.circle(marginX + 6, cursorY + 6, 2, 'F');

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        doc.text(wrapped, marginX + 18, cursorY + 9);
        cursorY += blockHeight;
      }
      cursorY += 8;
      continue;
    }

    // Standard body paragraph
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85); // slate-700
    const cleanParaText = para.replace(/\*\*/g, '');
    const lines = doc.splitTextToSize(cleanParaText, contentWidth);
    const blockHeight = lines.length * 14.5;

    if (cursorY + blockHeight > contentEndY) {
      addNewPage();
    }

    doc.text(lines, marginX, cursorY + 10);
    cursorY += blockHeight + 10;
  }

  // --- RUNNING BOTTOM FOOTER NOTE ON ALL PAGES ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text('Amaavigo HR Governance & Compliance System • Controlled Document', marginX, 818);
    doc.text(`Page ${p} of ${totalPages}`, marginX + contentWidth, 818, { align: 'right' });
  }

  return doc.output('blob');
}

/**
 * Downloads a document as a genuine, valid PDF.
 */
export async function downloadDocumentAsPdf(params: {
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
}): Promise<void> {
  const effectiveName = (params.fileName || 'Amaavigo_Policy.pdf').replace(/\.(txt|md|docx)$/i, '.pdf');
  const ensuredPdfName = effectiveName.endsWith('.pdf') ? effectiveName : `${effectiveName}.pdf`;
  const raw = params.rawContent || '';

  const meta = params.headerFooterData || extractHeaderFooterData(raw);

  const pdfBlob = generateCorporatePdfBlob({
    documentTitle: params.documentTitle || meta?.documentTitle || ensuredPdfName.replace('.pdf', ''),
    versionNumber: params.versionNumber || meta?.versionNumber || '1.0',
    effectiveDate: params.effectiveDate || meta?.effectiveDate || new Date().toISOString(),
    createdByName: params.createdByName || meta?.createdByName || 'Amee Shah',
    approvedByName: params.approvedByName || meta?.approvedByName || 'Vishal Shah',
    approvedDate: params.approvedDate || meta?.approvedDate || new Date().toISOString(),
    companyName: params.companyName || meta?.companyName || 'Amaavigo',
    rawContent: raw,
    fileName: ensuredPdfName,
  });

  triggerBrowserDownload(pdfBlob, ensuredPdfName);
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
