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

export interface FormattedPdfRun {
  text: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  fontSizePt?: number;
  colorHex?: string;
  bgHex?: string;
}

export interface FormattedPdfBlock {
  type: 'title' | 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'emptyLine' | 'list' | 'table' | 'callout' | 'hr';
  text?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  isBold?: boolean;
  isItalic?: boolean;
  fontSizePt?: number;
  colorHex?: string;
  bgHex?: string;
  spacingBefore?: number;
  spacingAfter?: number;
  runs?: FormattedPdfRun[];
  listItems?: { runs: FormattedPdfRun[]; isNumbered?: boolean; numberIndex?: number }[];
  tableRows?: { text: string; isHeader?: boolean; runs?: FormattedPdfRun[] }[][];
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
  const col1W = 108; // Logo
  const col3W = 74;  // Version
  const col4W = 98;  // Effective Date
  const col2W = contentWidth - col1W - col3W - col4W; // Document Name

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
  doc.text('amaavig', col1X + 8, headerY + 25);

  // Brand Orange Mark: "o" ring and pip notch (#FA7014 -> 250, 112, 20)
  doc.setFillColor(250, 112, 20);
  doc.setDrawColor(250, 112, 20);
  // Pip notch
  doc.rect(col1X + 68, headerY + 14, 3.2, 3.2, 'F');
  // Ring
  doc.setLineWidth(2.2);
  doc.circle(col1X + 75, headerY + 22, 4.2, 'S');

  // Brand Tagline
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('Where Brand takes Flight', col1X + 8, headerY + 39);

  // Column 2: Document Name (displays full document name without title overlapping)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 23, 42);
  doc.text('Document Name:', col2X + 8, headerY + 14);

  let titleFontSize = 8.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(titleFontSize);
  doc.setTextColor(30, 41, 59); // slate-800

  // Normalize tokens so hyphens/underscores/compound words wrap cleanly without overflowing col2
  const safeTitle = (meta.title || 'Document').replace(/[_-]/g, ' ');
  let titleLines = doc.splitTextToSize(safeTitle, col2W - 16);
  if (titleLines.length > 2) {
    titleFontSize = 7.5;
    doc.setFontSize(titleFontSize);
    titleLines = doc.splitTextToSize(safeTitle, col2W - 16);
  }
  if (titleLines.length > 3) {
    titleFontSize = 6.8;
    doc.setFontSize(titleFontSize);
    titleLines = doc.splitTextToSize(safeTitle, col2W - 16);
  }

  if (titleLines.length === 1) {
    doc.text(titleLines[0], col2X + 8, headerY + 31);
  } else if (titleLines.length === 2) {
    doc.text(titleLines[0], col2X + 8, headerY + 26);
    doc.text(titleLines[1], col2X + 8, headerY + 38);
  } else {
    doc.text(titleLines[0], col2X + 8, headerY + 24);
    doc.text(titleLines[1], col2X + 8, headerY + 33);
    doc.text(titleLines[2], col2X + 8, headerY + 42);
  }

  // Column 3: Version
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`Version: ${meta.version}`, col3X + 8, headerY + 30);

  // Column 4: Effective Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 23, 42);
  doc.text('Effective date :', col4X + 8, headerY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
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
 * Parses raw HTML / WYSIWYG markup or Markdown content into clean, structured PDF layout blocks.
 * Eliminates all raw HTML tags (e.g. <div>, <b>, <span>, <br>) from appearing as text on PDF pages.
 */
export function parseHtmlToPdfBlocks(rawContent: string): FormattedPdfBlock[] {
  let cleanBody = extractCleanBody(rawContent);
  if (!cleanBody || !cleanBody.trim()) return [];

  // Strip out inline style blocks, scripts, xml metadata, head tags & HTML comments left by Word/RichText
  cleanBody = cleanBody
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, '')
    .replace(/<!\[endif\]>/gi, '')
    .replace(/<\/?(?:o:p|w:[^>]+|m:[^>]+)>/gi, '')
    .replace(/page-break-(?:before|after|inside)\s*:\s*always;?/gi, '')
    .replace(/break-(?:before|after|inside)\s*:\s*page;?/gi, '');

  let rawBlocks: FormattedPdfBlock[] = [];
  const hasHtml = /<[a-z][\s\S]*>/i.test(cleanBody);

  if (hasHtml && typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${cleanBody}</div>`, 'text/html');
      const container = doc.body.firstElementChild;
      if (container) {
        extractBlocksFromDomNode(container, rawBlocks);
      }
    } catch (e) {
      console.warn('DOMParser note in PDF Generator:', e);
    }
  }

  if (rawBlocks.length === 0) {
    rawBlocks = parseMarkdownOrFallbackToBlocks(cleanBody);
  }

  // Clean Post-Processing Pass: Filter out empty paragraphs, zero-width spaces & consecutive emptyLines
  const cleanBlocks: FormattedPdfBlock[] = [];
  for (const block of rawBlocks) {
    if (block.type === 'emptyLine') {
      if (cleanBlocks.length === 0) continue; // Don't start document with empty line
      if (cleanBlocks[cleanBlocks.length - 1].type === 'emptyLine') continue; // Collapse consecutive empty lines
      cleanBlocks.push(block);
      continue;
    }

    if (['paragraph', 'heading1', 'heading2', 'heading3'].includes(block.type)) {
      const hasText = block.runs?.some(
        (r) => r.text && r.text.replace(/[\s\u00A0\u200B\uFEFF\r\n\t]+/g, '').length > 0
      );
      if (!hasText) continue; // Throw away empty paragraph/heading blocks
    }

    cleanBlocks.push(block);
  }

  // Trim trailing emptyLines
  while (cleanBlocks.length > 0 && cleanBlocks[cleanBlocks.length - 1].type === 'emptyLine') {
    cleanBlocks.pop();
  }

  return cleanBlocks;
}

export function extractHexColor(colorStr?: string): string | undefined {
  if (!colorStr) return undefined;
  const s = colorStr.trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.substring(1);
    if (hex.length === 3) {
      return ('#' + hex.split('').map((c) => c + c).join('')).toUpperCase();
    }
    if (hex.length === 6) {
      return ('#' + hex).toUpperCase();
    }
  }
  if (s.startsWith('rgb')) {
    const matches = s.match(/\d+/g);
    if (matches && matches.length >= 3) {
      const r = parseInt(matches[0], 10).toString(16).padStart(2, '0');
      const g = parseInt(matches[1], 10).toString(16).padStart(2, '0');
      const b = parseInt(matches[2], 10).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`.toUpperCase();
    }
  }
  const namedColors: Record<string, string> = {
    orange: '#FA7014',
    blue: '#2563EB',
    red: '#DC2626',
    green: '#059669',
    purple: '#9333EA',
    gray: '#64748B',
    grey: '#64748B',
    black: '#0F172A',
    slate: '#0F172A',
  };
  if (namedColors[s]) {
    return namedColors[s];
  }
  return undefined;
}

export function hexToRgb(hex?: string): [number, number, number] {
  if (!hex) return [51, 65, 85];
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [isNaN(r) ? 51 : r, isNaN(g) ? 65 : g, isNaN(b) ? 85 : b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return [isNaN(r) ? 51 : r, isNaN(g) ? 65 : g, isNaN(b) ? 85 : b];
  }
  return [51, 65, 85];
}

export function extractFontSizePt(sizeStr?: string): number | undefined {
  if (!sizeStr) return undefined;
  const s = sizeStr.trim();
  const val = parseFloat(s);
  if (isNaN(val)) return undefined;
  if (s.includes('pt')) return Math.round(val);
  if (s.includes('px')) return Math.round(val * 0.75);
  if (s.includes('rem') || s.includes('em')) return Math.round(val * 12);
  return Math.round(val * 0.75);
}

function fontAttrToPt(sizeStr: string): number {
  const s = parseInt(sizeStr, 10);
  const sizes = [9, 10, 12, 14, 18, 24, 30];
  return sizes[Math.min(Math.max(s - 1, 0), 6)];
}

interface RunInheritedProps {
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  fontSizePt?: number;
  colorHex?: string;
  bgHex?: string;
}

function extractRunsFromDom(node: Node, inherited: RunInheritedProps): FormattedPdfRun[] {
  const runs: FormattedPdfRun[] = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text) {
      runs.push({
        text,
        isBold: Boolean(inherited.isBold),
        isItalic: Boolean(inherited.isItalic),
        isUnderline: Boolean(inherited.isUnderline),
        fontSizePt: inherited.fontSizePt || 10.5,
        colorHex: inherited.colorHex || '#334155',
        bgHex: inherited.bgHex,
      });
    }
    return runs;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return runs;

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    runs.push({
      text: '\n',
      isBold: Boolean(inherited.isBold),
      fontSizePt: inherited.fontSizePt || 10.5,
      colorHex: inherited.colorHex || '#334155',
    });
    return runs;
  }

  const isTagBold = ['b', 'strong', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
  const isStyleBold =
    el.style?.fontWeight === 'bold' ||
    parseInt(el.style?.fontWeight || '0', 10) >= 600 ||
    Boolean(el.style?.fontWeight?.includes('bold'));
  const isElementBold = isTagBold || isStyleBold;

  const isTagItalic = ['i', 'em'].includes(tag);
  const isStyleItalic = el.style?.fontStyle === 'italic';
  const isElementItalic = isTagItalic || isStyleItalic;

  const isTagUnderline = ['u', 'ins'].includes(tag);
  const isStyleUnderline = Boolean(el.style?.textDecoration?.includes('underline'));

  const defaultTagFontSize =
    tag === 'h1' ? 22 : tag === 'h2' ? 16 : tag === 'h3' ? 13 : tag === 'h4' ? 11.5 : undefined;

  const defaultTagColor =
    tag === 'h1' ? '#0F172A' : tag === 'h2' ? '#FA7014' : tag === 'h3' ? '#1E293B' : undefined;

  const elColor =
    extractHexColor(el.style?.color) ||
    (tag === 'font' && el.getAttribute('color') ? extractHexColor(el.getAttribute('color')!) : undefined) ||
    (tag === 'a' ? '#2563EB' : undefined) ||
    defaultTagColor;

  const elFontSize =
    extractFontSizePt(el.style?.fontSize) ||
    (tag === 'font' && el.getAttribute('size') ? fontAttrToPt(el.getAttribute('size')!) : undefined) ||
    defaultTagFontSize;

  const elBgColor =
    extractHexColor(el.style?.backgroundColor) ||
    ((el.style as any)?.background ? extractHexColor((el.style as any).background) : undefined);

  const nextInherited: RunInheritedProps = {
    isBold: inherited.isBold || isElementBold,
    isItalic: inherited.isItalic || isElementItalic,
    isUnderline: inherited.isUnderline || isTagUnderline || isStyleUnderline,
    colorHex: elColor || inherited.colorHex,
    fontSizePt: elFontSize || inherited.fontSizePt,
    bgHex: elBgColor || inherited.bgHex,
  };

  for (let i = 0; i < el.childNodes.length; i++) {
    runs.push(...extractRunsFromDom(el.childNodes[i], nextInherited));
  }

  return runs;
}

function extractBlocksFromDomNode(node: Node, blocks: FormattedPdfBlock[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const txt = node.textContent?.replace(/[\u200B\r\n\t]+/g, '').trim();
    if (txt && txt.replace(/[\s\u00A0]+/g, '').length > 0) {
      blocks.push({
        type: 'paragraph',
        runs: [{ text: txt, isBold: false, fontSizePt: 10.5, colorHex: '#334155' }],
        align: 'left',
        spacingAfter: 8,
      });
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  const ignoredTags = [
    'style',
    'script',
    'xml',
    'head',
    'meta',
    'link',
    'title',
    'noscript',
    'svg',
    'iframe',
    'object',
    'embed',
    'applet',
    'm:omath',
    'o:p',
    'w:worddocument',
  ];
  if (ignoredTags.includes(tag)) return;

  const isHeaderFooterTable =
    tag === 'table' &&
    (el.classList.contains('amaavigo-document-header') ||
      el.classList.contains('amaavigo-document-footer') ||
      el.getAttribute('data-amaavigo-header') === 'true');
  if (isHeaderFooterTable) return;

  // Horizontal Rule
  if (tag === 'hr') {
    blocks.push({ type: 'hr', spacingBefore: 10, spacingAfter: 14 });
    return;
  }

  // Alignment
  let align: 'left' | 'center' | 'right' | 'justify' = 'left';
  const textAlign = (el.style?.textAlign || el.getAttribute('align') || '').toLowerCase();
  if (textAlign.includes('center')) align = 'center';
  else if (textAlign.includes('right')) align = 'right';
  else if (textAlign.includes('justify')) align = 'justify';

  // Table
  if (tag === 'table') {
    const tableRows: { text: string; isHeader?: boolean; runs?: FormattedPdfRun[] }[][] = [];
    const trs = Array.from(el.querySelectorAll('tr'));
    for (const tr of trs) {
      const row: { text: string; isHeader?: boolean; runs?: FormattedPdfRun[] }[] = [];
      const cells = Array.from(tr.querySelectorAll('th, td'));
      for (const cell of cells) {
        const isHeader = cell.tagName.toLowerCase() === 'th';
        const cellRuns = extractRunsFromDom(cell, {
          isBold: isHeader,
          fontSizePt: 8.5,
          colorHex: isHeader ? '#0F172A' : '#334155',
        });
        const cellText = (cell as HTMLElement).innerText || cell.textContent || '';
        row.push({ text: cellText.trim(), isHeader, runs: cellRuns });
      }
      if (row.length > 0) tableRows.push(row);
    }
    if (tableRows.length > 0) {
      blocks.push({
        type: 'table',
        tableRows,
        spacingBefore: 12,
        spacingAfter: 14,
      });
    }
    return;
  }

  // Lists (ul / ol)
  if (tag === 'ul' || tag === 'ol') {
    const isNumbered = tag === 'ol';
    const listItems: { runs: FormattedPdfRun[]; isNumbered?: boolean; numberIndex?: number }[] = [];
    const lis = Array.from(el.querySelectorAll(':scope > li'));
    lis.forEach((li, index) => {
      const runs = extractRunsFromDom(li, {
        isBold: false,
        fontSizePt: 10,
        colorHex: '#334155',
      });
      listItems.push({ runs, isNumbered, numberIndex: index + 1 });
    });
    if (listItems.length > 0) {
      blocks.push({
        type: 'list',
        listItems,
        align,
        spacingBefore: 8,
        spacingAfter: 10,
      });
    }
    return;
  }

  // Callout Box
  if (tag === 'blockquote' || (el.style?.borderLeft && el.style?.backgroundColor)) {
    const runs = extractRunsFromDom(el, {
      isBold: false,
      fontSizePt: 10,
      colorHex: '#1E3A8A',
    });
    blocks.push({
      type: 'callout',
      runs,
      align,
      spacingBefore: 12,
      spacingAfter: 14,
    });
    return;
  }

  // Empty Spacer Paragraph (<p><br></p>, <div><br></div>, <br>, <p>&nbsp;</p>)
  const innerHtml = el.innerHTML || '';
  const trimmedText = (el.innerText || el.textContent || '').replace(/[\s\u00A0]+/g, '').trim();
  const isOnlyBr = /^(?:<br\s*\/?>|\s|&nbsp;)*$/i.test(innerHtml.trim());
  if (tag === 'br' || (['p', 'div'].includes(tag) && (!trimmedText || isOnlyBr))) {
    if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'emptyLine') {
      blocks.push({ type: 'emptyLine', spacingAfter: 12 });
    }
    return;
  }

  // Headings
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    const defaultSize = tag === 'h1' ? 22 : tag === 'h2' ? 16 : 13;
    const defaultColor = tag === 'h1' ? '#0F172A' : tag === 'h2' ? '#FA7014' : '#1E293B';
    const spacingBefore = tag === 'h1' ? 20 : tag === 'h2' ? 16 : 12;
    const spacingAfter = tag === 'h1' ? 14 : tag === 'h2' ? 10 : 8;

    const runs = extractRunsFromDom(el, {
      isBold: true,
      fontSizePt: defaultSize,
      colorHex: defaultColor,
    });

    blocks.push({
      type: tag === 'h1' ? 'heading1' : tag === 'h2' ? 'heading2' : 'heading3',
      runs,
      align,
      spacingBefore,
      spacingAfter,
    });
    return;
  }

  // Check for nested block children
  const childElements = Array.from(el.children);
  const hasBlockChildren = childElements.some((child) =>
    ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'section', 'article', 'hr'].includes(
      child.tagName.toLowerCase()
    )
  );

  if (hasBlockChildren) {
    childElements.forEach((child) => extractBlocksFromDomNode(child, blocks));
    return;
  }

  // Leaf paragraph or container
  const runs = extractRunsFromDom(el, {
    isBold: false,
    fontSizePt: 10.5,
    colorHex: '#334155',
  });

  const hasVisibleText = runs.some(
    (r) => r.text && r.text.replace(/[\s\u00A0\u200B\r\n\t]+/g, '').length > 0
  );

  if (hasVisibleText) {
    // For normal body paragraphs, normalize run font sizes so body text stays standard 10.5pt
    const normalizedRuns = runs.map((r) => ({
      ...r,
      fontSizePt: Math.min(r.fontSizePt || 10.5, 12),
    }));

    blocks.push({
      type: 'paragraph',
      runs: normalizedRuns,
      align,
      spacingBefore: 0,
      spacingAfter: 6,
    });
  } else if (innerHtml.includes('<br>')) {
    if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'emptyLine') {
      blocks.push({ type: 'emptyLine', spacingAfter: 8 });
    }
  }
}

function parseMarkdownOrFallbackToBlocks(content: string): FormattedPdfBlock[] {
  const blocks: FormattedPdfBlock[] = [];
  const rawParagraphs = content.split('\n\n');

  for (const rawPara of rawParagraphs) {
    const para = rawPara.trim();
    if (!para) {
      blocks.push({ type: 'emptyLine', spacingAfter: 14 });
      continue;
    }

    const cleanParaText = stripHtmlTags(para);
    if (!cleanParaText) continue;

    const isMetaPara =
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Policy\s*Owner\s*[:\-–—]?)/i.test(cleanParaText) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Effective\s*Date\s*[:\-–—]?)/i.test(cleanParaText) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Review\s*Frequency\s*[:\-–—]?)/i.test(cleanParaText) ||
      /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Applies\s*To\s*[:\-–—]?)/i.test(cleanParaText);
    if (isMetaPara) continue;

    if (para.startsWith('# ')) {
      const titleTxt = para.replace(/^#\s+/, '').trim();
      blocks.push({
        type: 'heading1',
        runs: [{ text: titleTxt, isBold: true, fontSizePt: 22, colorHex: '#0F172A' }],
        align: 'left',
        spacingBefore: 18,
        spacingAfter: 14,
      });
      continue;
    }

    if (para.startsWith('## ')) {
      const h2Txt = para.replace(/^##\s+/, '').trim();
      blocks.push({
        type: 'heading2',
        runs: [{ text: h2Txt, isBold: true, fontSizePt: 16, colorHex: '#FA7014' }],
        align: 'left',
        spacingBefore: 16,
        spacingAfter: 10,
      });
      continue;
    }

    if (para.startsWith('### ')) {
      const h3Txt = para.replace(/^###\s+/, '').trim();
      blocks.push({
        type: 'heading3',
        runs: [{ text: h3Txt, isBold: true, fontSizePt: 13, colorHex: '#1E293B' }],
        align: 'left',
        spacingBefore: 12,
        spacingAfter: 8,
      });
      continue;
    }

    if (para.includes('\n- ') || para.includes('\n• ') || para.startsWith('- ') || para.startsWith('• ')) {
      const items = para
        .split('\n')
        .map((l) => stripHtmlTags(l.replace(/^[-*•]\s+/, '')))
        .filter(Boolean);
      blocks.push({
        type: 'list',
        listItems: items.map((it) => ({
          runs: parseInlineMarkdownToRuns(it, 10, '#334155'),
        })),
        align: 'left',
        spacingBefore: 8,
        spacingAfter: 10,
      });
      continue;
    }

    blocks.push({
      type: 'paragraph',
      runs: parseInlineMarkdownToRuns(para, 10.5, '#334155'),
      align: 'left',
      spacingBefore: 4,
      spacingAfter: 10,
    });
  }

  return blocks;
}

function parseInlineMarkdownToRuns(text: string, defaultSize = 10.5, defaultColor = '#334155'): FormattedPdfRun[] {
  const runs: FormattedPdfRun[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|\[.*?\]\(.*?\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({
        text: text.substring(lastIndex, match.index),
        isBold: false,
        isItalic: false,
        fontSizePt: defaultSize,
        colorHex: defaultColor,
      });
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      runs.push({
        text: token.slice(2, -2),
        isBold: true,
        isItalic: false,
        fontSizePt: defaultSize,
        colorHex: defaultColor,
      });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      runs.push({
        text: token.slice(1, -1),
        isBold: false,
        isItalic: true,
        fontSizePt: defaultSize,
        colorHex: defaultColor,
      });
    } else if (token.startsWith('[') && token.includes('](')) {
      const linkText = token.substring(1, token.indexOf(']('));
      runs.push({
        text: linkText,
        isBold: false,
        isItalic: false,
        fontSizePt: defaultSize,
        colorHex: '#2563EB',
      });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push({
      text: text.substring(lastIndex),
      isBold: false,
      isItalic: false,
      fontSizePt: defaultSize,
      colorHex: defaultColor,
    });
  }

  return runs;
}

function stripHtmlTags(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Renders structured runs with individual styling, bold, colors, font sizes,
 * word wrapping, line heights, and spacing without colliding or overflowing.
 */
function drawParagraphWithRuns(
  doc: jsPDF,
  runs: FormattedPdfRun[],
  marginX: number,
  initialCursorY: number,
  contentWidth: number,
  contentEndY: number,
  align: 'left' | 'center' | 'right' | 'justify' = 'left',
  addNewPage: () => number,
  spacingAfter = 10,
  contentStartY = 96
): number {
  if (!runs || runs.length === 0) {
    return initialCursorY;
  }

  const hasVisibleText = runs.some(
    (r) => r.text && r.text.replace(/[\s\u00A0\u200B\r\n\t]+/g, '').length > 0
  );
  if (!hasVisibleText) {
    return initialCursorY;
  }

  interface LayoutToken {
    text: string;
    isBold: boolean;
    isItalic: boolean;
    fontSizePt: number;
    colorHex: string;
    bgHex?: string;
    width: number;
    isNewline: boolean;
    isSpace: boolean;
  }

  const tokens: LayoutToken[] = [];

  for (const run of runs) {
    if (!run.text) continue;
    const isBold = Boolean(run.isBold);
    const isItalic = Boolean(run.isItalic);
    const fontSizePt = run.fontSizePt && run.fontSizePt > 0 ? run.fontSizePt : 10.5;
    const colorHex = run.colorHex || '#334155';
    const bgHex = run.bgHex;

    const parts = run.text.split(/(\r?\n|[^\S\r\n]+)/);

    for (const part of parts) {
      if (!part) continue;
      if (part.includes('\n')) {
        tokens.push({
          text: '\n',
          isBold,
          isItalic,
          fontSizePt,
          colorHex,
          bgHex,
          width: 0,
          isNewline: true,
          isSpace: false,
        });
        continue;
      }

      const isSpace = /^[^\S\r\n]+$/.test(part);

      doc.setFont('helvetica', isBold ? (isItalic ? 'bolditalic' : 'bold') : (isItalic ? 'italic' : 'normal'));
      doc.setFontSize(fontSizePt);
      const width = doc.getStringUnitWidth(part) * fontSizePt;

      tokens.push({
        text: part,
        isBold,
        isItalic,
        fontSizePt,
        colorHex,
        bgHex,
        width,
        isNewline: false,
        isSpace,
      });
    }
  }

  if (tokens.length === 0) {
    return initialCursorY + spacingAfter;
  }

  const lines: LayoutToken[][] = [];
  let currentLine: LayoutToken[] = [];
  let currentLineWidth = 0;

  for (const token of tokens) {
    if (token.isNewline) {
      lines.push(currentLine);
      currentLine = [];
      currentLineWidth = 0;
      continue;
    }

    if (currentLine.length === 0 && token.isSpace) {
      continue;
    }

    if (currentLine.length > 0 && currentLineWidth + token.width > contentWidth) {
      lines.push(currentLine);
      currentLine = [];
      currentLineWidth = 0;
      if (token.isSpace) continue;
    }

    currentLine.push(token);
    currentLineWidth += token.width;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Trim leading and trailing empty lines to prevent unwanted vertical gaps or false page triggers
  while (lines.length > 0 && lines[0].length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }

  if (lines.length === 0) {
    return initialCursorY;
  }

  // Collapse consecutive empty lines
  const cleanedLines: LayoutToken[][] = [];
  let lastWasEmpty = false;
  for (const line of lines) {
    if (line.length === 0) {
      if (!lastWasEmpty) {
        cleanedLines.push(line);
        lastWasEmpty = true;
      }
    } else {
      cleanedLines.push(line);
      lastWasEmpty = false;
    }
  }

  let currentCursorY = initialCursorY;

  for (const lineTokens of cleanedLines) {
    if (lineTokens.length === 0) {
      // Empty line spacer inside a paragraph: never trigger page break for a blank line!
      if (currentCursorY + 12 <= contentEndY && currentCursorY > contentStartY + 10) {
        currentCursorY += 10;
      }
      continue;
    }

    const maxFontSize = Math.max(...lineTokens.map((t) => t.fontSizePt), 9);
    const lineHeight = Math.max(Math.round(maxFontSize * 1.35), 14);
    const fontOffset = Math.round(maxFontSize * 0.9);

    if (currentCursorY + lineHeight + fontOffset > contentEndY && currentCursorY > contentStartY) {
      currentCursorY = addNewPage();
    }

    const totalLineWidth = lineTokens.reduce((sum, t) => sum + t.width, 0);
    let lineX = marginX;
    if (align === 'center') {
      lineX = marginX + Math.max((contentWidth - totalLineWidth) / 2, 0);
    } else if (align === 'right') {
      lineX = marginX + Math.max(contentWidth - totalLineWidth, 0);
    }

    for (const token of lineTokens) {
      if (token.bgHex) {
        const [br, bg, bb] = hexToRgb(token.bgHex);
        doc.setFillColor(br, bg, bb);
        doc.rect(lineX, currentCursorY + fontOffset - maxFontSize + 1, token.width, maxFontSize + 2, 'F');
      }

      doc.setFont(
        'helvetica',
        token.isBold ? (token.isItalic ? 'bolditalic' : 'bold') : (token.isItalic ? 'italic' : 'normal')
      );
      doc.setFontSize(token.fontSizePt);
      const [r, g, b] = hexToRgb(token.colorHex);
      doc.setTextColor(r, g, b);
      doc.text(token.text, lineX, currentCursorY + fontOffset);

      lineX += token.width;
    }

    currentCursorY += lineHeight;
  }

  currentCursorY += spacingAfter;
  return currentCursorY;
}

/**
 * Generates a fully compliant, production-grade PDF document
 * with official Amaavigo corporate header table on EVERY page,
 * official governance approval footer sign-off on EVERY page,
 * and body content matching the WYSIWYG editor's exact typography, colors,
 * font sizes, and natural paragraph/header spacing without overlapping.
 */
export function generateCorporatePdfBlob(options: CorporatePdfOptions): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2; // 523.28 pt

  const headerY = 32;
  const headerHeight = 52;
  const footerHeight = 40;
  const footerY = 760;

  // Content flow boundaries (40pt safety clearance above footer table)
  const contentStartY = 96; // 12pt clean vertical clearance below header
  const contentEndY = 720; // 40pt safety buffer above footer table (footerY = 760)

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

  doc.setProperties({
    title,
    author: 'Amaavigo Governance Engine',
    subject: 'AmaavigoGovernanceStamped',
    keywords: 'AmaavigoGovernanceStamped, corporate-governance',
    creator: creator,
  });

  let isFirstBlockOnPage = true;

  const decoratePage = () => {
    drawCorporateHeaderTable(doc, headerMeta, marginX, contentWidth, headerY, headerHeight);
    drawCorporateFooterTable(doc, footerMeta, marginX, contentWidth, footerY, footerHeight);
  };

  // Draw Page 1 decoration
  decoratePage();

  let cursorY = contentStartY;

  const addNewPage = (): number => {
    doc.addPage();
    decoratePage();
    cursorY = contentStartY;
    isFirstBlockOnPage = true;
    return contentStartY;
  };

  // Parse HTML or Markdown content into clean, structured PDF layout blocks
  const blocks = parseHtmlToPdfBlocks(options.rawContent);

  for (const block of blocks) {
    // 1. Empty Line / Spacer (preserves vertical spacing between paragraphs without forcing empty pages)
    if (block.type === 'emptyLine') {
      const space = block.spacingAfter || 12;
      if (cursorY + space > contentEndY || isFirstBlockOnPage || cursorY <= contentStartY + 5) {
        // Skip empty lines at page boundaries to avoid empty pages
        continue;
      }
      cursorY += space;
      continue;
    }

    // 2. Horizontal Rule
    if (block.type === 'hr') {
      const before = isFirstBlockOnPage ? 0 : (block.spacingBefore || 10);
      const after = block.spacingAfter || 14;
      if (cursorY + before + after > contentEndY && !isFirstBlockOnPage) {
        cursorY = addNewPage();
      }
      cursorY += (isFirstBlockOnPage ? 0 : (block.spacingBefore || 10));
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(1);
      doc.line(marginX, cursorY, marginX + contentWidth, cursorY);
      cursorY += after;
      isFirstBlockOnPage = false;
      continue;
    }

    // 3. Callout Box
    if (block.type === 'callout' && block.runs && block.runs.length > 0) {
      const calloutText = block.runs.map((r) => r.text).join('').trim();
      if (calloutText) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        const wrapped = doc.splitTextToSize(calloutText, contentWidth - 28);
        const boxHeight = wrapped.length * 14 + 16;

        if (cursorY + boxHeight > contentEndY && !isFirstBlockOnPage) {
          cursorY = addNewPage();
        }

        doc.setFillColor(239, 246, 255);
        doc.rect(marginX, cursorY, contentWidth, boxHeight, 'F');
        doc.setFillColor(59, 130, 246);
        doc.rect(marginX, cursorY, 4, boxHeight, 'F');

        doc.setTextColor(30, 58, 138);
        for (let w = 0; w < wrapped.length; w++) {
          doc.text(wrapped[w], marginX + 16, cursorY + 14 + w * 14);
        }

        cursorY += boxHeight + 12;
        isFirstBlockOnPage = false;
      }
      continue;
    }

    // 4. Structured Table
    if (block.type === 'table' && block.tableRows) {
      const rows = block.tableRows;
      const numCols = rows[0]?.length || 1;
      const colWidth = contentWidth / numCols;
      const rowHeight = 22;

      const totalTableHeight = rows.length * rowHeight + 10;
      if (cursorY + totalTableHeight > contentEndY && !isFirstBlockOnPage && rows.length > 2) {
        cursorY = addNewPage();
      }

      doc.setLineWidth(0.8);
      doc.setDrawColor(203, 213, 225);

      rows.forEach((row, rIdx) => {
        if (cursorY + rowHeight > contentEndY && !isFirstBlockOnPage) {
          cursorY = addNewPage();
        }
        const isHeader = rIdx === 0;
        doc.setFillColor(isHeader ? 248 : 255, isHeader ? 250 : 255, isHeader ? 252 : 255);
        doc.rect(marginX, cursorY, contentWidth, rowHeight, 'F');
        doc.rect(marginX, cursorY, contentWidth, rowHeight, 'S');

        row.forEach((cell, cIdx) => {
          const cellX = marginX + cIdx * colWidth;
          if (cIdx > 0) {
            doc.line(cellX, cursorY, cellX, cursorY + rowHeight);
          }
          const isCellHeader = cell.isHeader || isHeader;
          doc.setFont('helvetica', isCellHeader ? 'bold' : 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(isCellHeader ? 15 : 51, isCellHeader ? 23 : 65, isCellHeader ? 42 : 85);

          const truncated = doc.splitTextToSize(cell.text, colWidth - 8)[0] || '';
          doc.text(truncated, cellX + 4, cursorY + 14);
        });

        cursorY += rowHeight;
      });

      cursorY += 12;
      isFirstBlockOnPage = false;
      continue;
    }

    // 5. Bullet & Numbered Lists
    if (block.type === 'list' && block.listItems) {
      for (const item of block.listItems) {
        const itemText = item.runs.map((r) => r.text).join('').trim();
        if (!itemText) continue;

        const maxItemFontSize = Math.max(...item.runs.map((r) => r.fontSizePt || 10), 9.5);
        const itemLineHeight = Math.max(Math.round(maxItemFontSize * 1.35), 14);

        if (cursorY + itemLineHeight > contentEndY && !isFirstBlockOnPage) {
          cursorY = addNewPage();
        }

        if (item.isNumbered && item.numberIndex) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(maxItemFontSize);
          doc.setTextColor(250, 112, 20); // Amaavigo Orange
          doc.text(`${item.numberIndex}.`, marginX + 4, cursorY + Math.round(maxItemFontSize * 0.95));
        } else {
          doc.setFillColor(250, 112, 20); // Amaavigo Orange
          doc.circle(marginX + 6, cursorY + 6, 2, 'F');
        }

        cursorY = drawParagraphWithRuns(
          doc,
          item.runs,
          marginX + 18,
          cursorY,
          contentWidth - 18,
          contentEndY,
          'left',
          addNewPage,
          4,
          contentStartY
        );
        isFirstBlockOnPage = false;
      }
      cursorY += 6;
      continue;
    }

    // 6. Styled Headings, Titles & Paragraphs with Rich Runs
    if (block.runs && block.runs.length > 0) {
      // Heading Orphan Prevention ("Keep with next paragraph")
      const isHeading = ['heading1', 'heading2', 'heading3'].includes(block.type);
      if (isHeading && cursorY > contentEndY - 50 && !isFirstBlockOnPage) {
        cursorY = addNewPage();
      }

      const beforeSpace = isFirstBlockOnPage ? 0 : (block.spacingBefore || 0);
      if (beforeSpace > 0 && cursorY + beforeSpace <= contentEndY) {
        cursorY += beforeSpace;
      }

      cursorY = drawParagraphWithRuns(
        doc,
        block.runs,
        marginX,
        cursorY,
        contentWidth,
        contentEndY,
        block.align || 'left',
        addNewPage,
        block.spacingAfter || 10,
        contentStartY
      );

      // Subtle accent line under Heading 1
      if (block.type === 'heading1') {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(1);
        doc.line(marginX, cursorY - 6, marginX + contentWidth, cursorY - 6);
        cursorY += 6;
      }
      isFirstBlockOnPage = false;
      continue;
    }
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
