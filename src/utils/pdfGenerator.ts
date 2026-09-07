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
 * Generates a fully compliant, production-grade PDF document
 * with official Amaavigo corporate header table (including logo)
 * and governance approval footer sign-off.
 */
export function generateCorporatePdfBlob(options: CorporatePdfOptions): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // ~595.28 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // ~841.89 pt
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2; // ~515.28 pt
  const maxContentY = pageHeight - 65; // Leave room for running footer

  const cleanVer = cleanVersionNumber(options.versionNumber);
  const effective = formatDDMMYYYY(options.effectiveDate);
  const approvedDt = formatDDMMYYYY(options.approvedDate || options.effectiveDate);
  const creator = options.createdByName || 'Amee Shah';
  const approver = options.approvedByName || 'Vishal Shah';
  const title = options.documentTitle || 'Document';

  // --- DRAW PAGE 1 HEADER TABLE ---
  const headerY = 40;
  const headerHeight = 58;

  // Outer border & background
  doc.setFillColor(255, 255, 255);
  doc.rect(marginX, headerY, contentWidth, headerHeight, 'F');
  doc.setDrawColor(15, 23, 42); // slate-900
  doc.setLineWidth(1.5);
  doc.rect(marginX, headerY, contentWidth, headerHeight, 'S');

  // Column Boundaries
  const col1W = 125; // Logo
  const col2W = 175; // Document Name
  const col3W = 80;  // Version
  const col4W = contentWidth - col1W - col2W - col3W; // ~135.28 pt Effective Date

  const col1X = marginX;
  const col2X = col1X + col1W;
  const col3X = col2X + col2W;
  const col4X = col3X + col3W;

  // Column Dividers
  doc.setLineWidth(1);
  doc.line(col2X, headerY, col2X, headerY + headerHeight);
  doc.line(col3X, headerY, col3X, headerY + headerHeight);
  doc.line(col4X, headerY, col4X, headerY + headerHeight);

  // Column 1: Amaavigo Brand Logo (Wordmark + Pip Notch + Ring)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(24, 26, 30);
  doc.text('amaavig', col1X + 12, headerY + 28);

  // Brand Orange Mark: "o" ring and pip notch (#FA7014 -> 250, 112, 20)
  doc.setFillColor(250, 112, 20);
  doc.setDrawColor(250, 112, 20);
  // Pip notch
  doc.rect(col1X + 75, headerY + 16, 3.5, 3.5, 'F');
  // Ring
  doc.setLineWidth(2.5);
  doc.circle(col1X + 83, headerY + 24, 4.5, 'S');

  // Brand Tagline
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('Where Brand takes Flight', col1X + 12, headerY + 44);

  // Column 2: Document Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Document Name:', col2X + 10, headerY + 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59); // slate-800
  const titleLines = doc.splitTextToSize(title, col2W - 20);
  doc.text(titleLines.slice(0, 2), col2X + 10, headerY + 32);

  // Column 3: Version
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Version: ${cleanVer}`, col3X + 10, headerY + 34);

  // Column 4: Effective Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Effective date :', col4X + 10, headerY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text(effective, col4X + 10, headerY + 34);

  // --- RENDER CLEAN BODY CONTENT ---
  let cursorY = headerY + headerHeight + 28;
  const cleanBody = extractCleanBody(options.rawContent);
  const paragraphs = cleanBody.split('\n\n');

  for (const rawPara of paragraphs) {
    const para = rawPara.trim();
    if (!para) continue;

    // Check for Heading 1 (# ...)
    if (para.startsWith('# ')) {
      const headingText = para.replace(/^#\s+/, '').trim();
      if (cursorY + 35 > maxContentY) {
        doc.addPage();
        cursorY = 50;
      } else {
        cursorY += 12;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42); // slate-900
      const lines = doc.splitTextToSize(headingText, contentWidth);
      doc.text(lines, marginX, cursorY);
      cursorY += lines.length * 16 + 8;

      // Divider below H1
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(1);
      doc.line(marginX, cursorY - 4, marginX + contentWidth, cursorY - 4);
      cursorY += 6;
      continue;
    }

    // Check for Heading 2 (## ...)
    if (para.startsWith('## ')) {
      const headingText = para.replace(/^##\s+/, '').trim();
      if (cursorY + 30 > maxContentY) {
        doc.addPage();
        cursorY = 50;
      } else {
        cursorY += 10;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(30, 41, 59); // slate-800
      const lines = doc.splitTextToSize(headingText, contentWidth);
      doc.text(lines, marginX, cursorY);
      cursorY += lines.length * 14 + 6;
      continue;
    }

    // Check for Heading 3 (### ...)
    if (para.startsWith('### ')) {
      const headingText = para.replace(/^###\s+/, '').trim();
      if (cursorY + 25 > maxContentY) {
        doc.addPage();
        cursorY = 50;
      } else {
        cursorY += 8;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85); // slate-700
      const lines = doc.splitTextToSize(headingText, contentWidth);
      doc.text(lines, marginX, cursorY);
      cursorY += lines.length * 13 + 4;
      continue;
    }

    // Check for bullet list block
    if (para.includes('\n- ') || para.includes('\n• ') || para.startsWith('- ') || para.startsWith('• ')) {
      const bulletLines = para.split('\n');
      for (const bLine of bulletLines) {
        const cleanBLine = bLine.replace(/^[-*•]\s+/, '').trim();
        if (!cleanBLine) continue;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        const wrapped = doc.splitTextToSize(cleanBLine, contentWidth - 20);
        const blockHeight = wrapped.length * 13 + 4;

        if (cursorY + blockHeight > maxContentY) {
          doc.addPage();
          cursorY = 50;
        }

        // Draw bullet dot
        doc.setFillColor(250, 112, 20); // Amaavigo Orange
        doc.circle(marginX + 5, cursorY + 4, 2, 'F');
        doc.text(wrapped, marginX + 16, cursorY + 7);
        cursorY += blockHeight;
      }
      cursorY += 6;
      continue;
    }

    // Standard body paragraph
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    doc.setTextColor(51, 65, 85); // slate-700
    const lines = doc.splitTextToSize(para, contentWidth);
    const blockHeight = lines.length * 13.5;

    if (cursorY + blockHeight > maxContentY) {
      doc.addPage();
      cursorY = 50;
    }

    doc.text(lines, marginX, cursorY);
    cursorY += blockHeight + 8;
  }

  // --- DRAW FOOTER TABLE (Governance Approval Sign-Off) ---
  const footerHeight = 48;
  if (cursorY + footerHeight + 15 > maxContentY) {
    doc.addPage();
    cursorY = 50;
  } else {
    cursorY += 15;
  }

  const footerY = cursorY;
  doc.setFillColor(255, 255, 255);
  doc.rect(marginX, footerY, contentWidth, footerHeight, 'F');
  doc.setDrawColor(15, 23, 42); // slate-900
  doc.setLineWidth(1.5);
  doc.rect(marginX, footerY, contentWidth, footerHeight, 'S');

  const fColW = contentWidth / 3;
  const fCol1X = marginX;
  const fCol2X = fCol1X + fColW;
  const fCol3X = fCol2X + fColW;

  // Footer Column Dividers
  doc.setLineWidth(1);
  doc.line(fCol2X, footerY, fCol2X, footerY + footerHeight);
  doc.line(fCol3X, footerY, fCol3X, footerY + footerHeight);

  // Col 1: Created by
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Created by:', fCol1X + 12, footerY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text(creator, fCol1X + 12, footerY + 34);

  // Col 2: Approved by
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Approved by:', fCol2X + 12, footerY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text(approver, fCol2X + 12, footerY + 34);

  // Col 3: Approved Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Approved Date:', fCol3X + 12, footerY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text(approvedDt, fCol3X + 12, footerY + 34);

  // --- RUNNING FOOTER ON ALL PAGES ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text('Amaavigo HR Governance & Compliance System • Controlled Document', marginX, pageHeight - 25);
    doc.text(`Page ${p} of ${totalPages}`, marginX + contentWidth, pageHeight - 25, { align: 'right' });
  }

  return doc.output('blob');
}

/**
 * Downloads a document as a genuine, valid PDF.
 * If rawContent is already a binary PDF (starts with %PDF), it downloads that.
 * Otherwise, it generates a full corporate PDF with header table, logo, and approval footer.
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

  // Check if rawContent is already a binary PDF (%PDF-...)
  if (raw.startsWith('%PDF') || (raw.length > 10 && raw.substring(0, 10).includes('%PDF'))) {
    try {
      const len = raw.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = raw.charCodeAt(i) & 0xff;
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      triggerBrowserDownload(blob, ensuredPdfName);
      return;
    } catch (e) {
      console.warn('Binary PDF download fallback:', e);
    }
  }

  // If fileUrl is a valid Base64 data:application/pdf
  if (params.fileUrl && params.fileUrl.startsWith('data:application/pdf;base64,')) {
    try {
      const base64Data = params.fileUrl.split(',')[1];
      const binaryString = atob(base64Data);
      if (binaryString.startsWith('%PDF')) {
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        triggerBrowserDownload(blob, ensuredPdfName);
        return;
      }
    } catch (e) {
      console.warn('Base64 PDF download fallback:', e);
    }
  }

  // Otherwise, synthesize an authentic, standard PDF document with official header and footer
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
