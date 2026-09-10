import React from 'react';
import { AmaavigoLogo } from '../components/AmaavigoLogo';

export interface DocumentHeaderFooterData {
  companyName: string;
  documentTitle: string;
  versionNumber: string;
  effectiveDate: string; // DD/MM/YYYY
  createdByName: string;
  approvedByName: string;
  approvedDate: string; // DD/MM/YYYY
}

export const HEADER_START_TAG = '<!-- AMAAVIGO_DOCUMENT_HEADER_START -->';
export const HEADER_END_TAG = '<!-- AMAAVIGO_DOCUMENT_HEADER_END -->';
export const FOOTER_START_TAG = '<!-- AMAAVIGO_DOCUMENT_FOOTER_START -->';
export const FOOTER_END_TAG = '<!-- AMAAVIGO_DOCUMENT_FOOTER_END -->';

/**
 * Normalizes any date into DD/MM/YYYY format (e.g. 09/09/2026).
 */
export function formatDDMMYYYY(dateInput: string | number | Date | null | undefined, fallback: string = ''): string {
  if (!dateInput) {
    if (fallback !== undefined && fallback !== '') return fallback;
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  const str = String(dateInput).trim();
  if (
    str === 'Not yet approved' ||
    str === 'Pending Approval' ||
    str === 'Pending Review' ||
    str.toLowerCase().includes('not yet')
  ) {
    return 'Not yet approved';
  }
  // Already in DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    return str;
  }
  // Standard ISO date YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const parts = str.slice(0, 10).split('-');
    if (parts.length === 3) {
      const [yyyy, mm, dd] = parts;
      return `${dd}/${mm}/${yyyy}`;
    }
  }

  try {
    const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return str;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return str;
  }
}

export function cleanVersionNumber(ver: string): string {
  if (!ver) return '1.0';
  return ver.startsWith('v') || ver.startsWith('V') ? ver.slice(1) : ver;
}

/**
 * Generates official HTML Table Header block with official Amaavigo Logo.
 */
export function generateHeaderHtml(data: DocumentHeaderFooterData): string {
  const ver = cleanVersionNumber(data.versionNumber);
  const title = data.documentTitle || 'Corporate Governance Document';
  const effective = formatDDMMYYYY(data.effectiveDate);

  return `${HEADER_START_TAG}
<table class="amaavigo-document-header" style="width: 100%; border-collapse: collapse; border: 2px solid #0f172a; margin-bottom: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">
  <tr>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 24%; vertical-align: middle; text-align: center; background: #ffffff;">
      <div style="display: inline-block; text-align: center;">
        <svg viewBox="0 0 240 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="height: 34px; width: auto; max-width: 165px; display: block; margin: 0 auto;" aria-label="Amaavigo - Where Brand takes Flight">
          <g id="amaavigo-wordmark">
            <text x="0" y="28" fill="#181A1E" style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 900; font-size: 32px; letter-spacing: -0.035em;">amaavig</text>
            <g transform="translate(196, 0)">
              <rect x="-10" y="2" width="8" height="8" rx="1.2" fill="#FA7014" />
              <circle cx="14" cy="18.5" r="11.5" stroke="#FA7014" stroke-width="6.5" fill="none" />
            </g>
          </g>
          <g id="amaavigo-tagline" transform="translate(1, 46)">
            <text x="0" y="0" fill="#6B7280" style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 600; font-size: 10.5px; letter-spacing: 0.075em;">Where Brand takes Flight</text>
          </g>
        </svg>
      </div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 12px 18px; width: 34%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Document Name:</div>
      <div style="font-size: 14px; font-weight: 600; color: #1e293b; line-height: 1.3;">${title}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 12px 18px; width: 18%; vertical-align: middle;">
      <div style="font-size: 14px; font-weight: 700; color: #0f172a;">Version: ${ver}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 12px 18px; width: 24%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Effective date :</div>
      <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${effective}</div>
    </td>
  </tr>
</table>
${HEADER_END_TAG}`;
}

/**
 * Generates official HTML Table Footer block.
 */
export function generateFooterHtml(data: DocumentHeaderFooterData): string {
  const creator = data.createdByName || 'HR Author';
  const isApproved = Boolean(
    data.approvedByName &&
    data.approvedByName !== 'Not yet approved' &&
    data.approvedByName !== 'Pending Review' &&
    data.approvedByName !== 'Pending Approval' &&
    !data.approvedByName.toLowerCase().includes('not yet') &&
    data.approvedDate &&
    data.approvedDate !== 'Not yet approved' &&
    data.approvedDate !== 'Pending Approval' &&
    !data.approvedDate.toLowerCase().includes('not yet')
  );

  const approver = isApproved ? data.approvedByName : 'Not yet approved';
  const approvedDate = isApproved ? formatDDMMYYYY(data.approvedDate) : 'Not yet approved';

  return `${FOOTER_START_TAG}
<table class="amaavigo-document-footer" style="width: 100%; border-collapse: collapse; border: 2px solid #0f172a; margin-top: 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">
  <tr>
    <td style="border: 1px solid #0f172a; padding: 12px 18px; width: 33.33%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Created by:</div>
      <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${creator}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 12px 18px; width: 33.33%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Approved by:</div>
      <div style="font-size: 14px; font-weight: ${isApproved ? '600' : '500'}; color: ${isApproved ? '#1e293b' : '#64748b'};">${approver}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 12px 18px; width: 33.33%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Approved Date:</div>
      <div style="font-size: 14px; font-weight: ${isApproved ? '600' : '500'}; color: ${isApproved ? '#1e293b' : '#64748b'};">${approvedDate}</div>
    </td>
  </tr>
</table>
${FOOTER_END_TAG}`;
}

/**
 * Strips obsolete, unneeded policy metadata header blocks such as:
 * - Policy Owner: Human Resources
 * - Effective Date: 26 August 2026
 * - Review Frequency: Annual or as required
 * - Applies To: All employees, subject to role and business requirements
 * Official corporate headers and governance footers are dynamically injected by the system,
 * so redundant document metadata headers must be excluded.
 */
export function stripPolicyMetadataHeader(text: string): string {
  if (!text) return '';
  let res = text;

  // 1. Remove HTML table blocks containing policy metadata
  res = res.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (tbl) => {
    if (
      /Policy\s*Owner/i.test(tbl) &&
      (/Effective\s*Date/i.test(tbl) || /Review\s*Frequency/i.test(tbl) || /Applies\s*To/i.test(tbl))
    ) {
      return '';
    }
    return tbl;
  });

  // 2. Remove Markdown table rows containing policy metadata
  res = res.replace(
    /^[ \t]*\|?[ \t]*(?:(?:\*{1,2}|<[^>]+>)*)(?:Policy\s*Owner|Effective\s*Date|Review\s*Frequency|Applies\s*To)[\s\S]*?\|?[ \t]*$/gim,
    ''
  );

  // 3. Remove HTML paragraph/div/td blocks containing policy metadata
  res = res.replace(
    /<(?:p|div|tr|td)[^>]*>(?:[\s\S]*?)(?:Policy\s*Owner|Effective\s*Date|Review\s*Frequency|Applies\s*To)[\s\S]*?<\/(?:p|div|tr|td)>/gi,
    ''
  );

  // 4. Line-by-line filtering for multi-line documents
  const lines = res.split(/\r?\n/);
  const filteredLines: string[] = [];
  let skipNextValue = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      if (!skipNextValue) {
        filteredLines.push('');
      }
      continue;
    }

    const normalized = trimmed
      .replace(/^[-*•#|>\s]+/, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*/g, '')
      .trim();

    // Check if line is purely a metadata label (e.g. "Policy Owner:" or "Policy Owner")
    const isPureLabel = /^(?:Policy\s*Owner|Effective\s*Date|Review\s*Frequency|Applies\s*To)\s*[:\-–—]?$/i.test(normalized);
    if (isPureLabel) {
      skipNextValue = true;
      continue;
    }

    // Check if line is a metadata line with value (e.g. "Policy Owner: Human Resources")
    const isMetaLine = /^(?:Policy\s*Owner|Effective\s*Date|Review\s*Frequency|Applies\s*To)\s*[:\-–—]/i.test(normalized);
    if (isMetaLine) {
      continue;
    }

    // If previous line was a pure label, this line is the value (unless it looks like a heading)
    if (skipNextValue) {
      skipNextValue = false;
      if (!/^(?:[0-9]+\.|#|\bPurpose\b|\bScope\b)/i.test(normalized)) {
        continue;
      }
    }

    filteredLines.push(line);
  }
  res = filteredLines.join('\n');

  // 5. Full multi-field metadata block removal (works across single-line or compressed paragraphs)
  res = res.replace(
    /(?:^|\s+)(?:\*{0,2})Policy\s*Owner\s*:?[\s\S]*?(?:Applies\s*To\s*:?[^\n\r]*?(?:business\s*requirements|requirements|employees[^\n\r]*?|All\s*employees))(?=\s*(?:1\.|\bPurpose\b|\n\n|##|\bScope\b|$))/gi,
    '\n\n'
  );

  // 6. Isolated inline phrases if present on the same line as titles
  res = res.replace(/(?:^|\s+)(?:\*{0,2}|<[^>]+>)*Policy\s*Owner\s*[:\-–—]?\s*[^,\n\r]+(?:\.|\,|\n|$|\s+(?=Effective|Review|Applies|1\.))/gi, ' ');
  res = res.replace(/(?:^|\s+)(?:\*{0,2}|<[^>]+>)*Effective\s*Date\s*[:\-–—]?\s*[0-9A-Za-z\s,/-]+(?=\s*(?:Review|Applies|1\.|\n|$))/gi, ' ');
  res = res.replace(/(?:^|\s+)(?:\*{0,2}|<[^>]+>)*Review\s*Frequency\s*[:\-–—]?\s*[^,\n\r]+(?:\.|\,|\n|$|\s+(?=Applies|Effective|1\.))/gi, ' ');
  res = res.replace(/(?:^|\s+)(?:\*{0,2}|<[^>]+>)*Applies\s*To\s*[:\-–—]?\s*[^.\n\r]+(?:\.|\,|\n|$|\s+(?=1\.|\bPurpose\b))/gi, ' ');

  // 7. Remove any remnant label strings on a line by themselves
  res = res.replace(/^[ \t]*(?:(?:\*{1,2}|<[^>]+>)*)(?:Policy\s*Owner|Effective\s*Date|Review\s*Frequency|Applies\s*To)\s*[:\-–—]?[ \t]*$/gim, '');

  // 8. Format clean line-breaks before numbered headings (e.g. "1. Purpose", "2. Eligibility") if single-line
  res = res.replace(/([^\n])\s+(?=[0-9]+\.\s+[A-Z])/g, '$1\n\n');

  return res.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strips previous header/footer HTML blocks and redundant metadata headers to avoid duplicate insertions.
 */
export function extractCleanBody(content: string): string {
  if (!content) return '';
  let clean = content;
  // Remove tagged header block
  const headerRegex = new RegExp(
    `${HEADER_START_TAG}[\\s\\S]*?${HEADER_END_TAG}\\n*`,
    'gi'
  );
  clean = clean.replace(headerRegex, '');

  // Remove tagged footer block
  const footerRegex = new RegExp(
    `\\n*${FOOTER_START_TAG}[\\s\\S]*?${FOOTER_END_TAG}`,
    'gi'
  );
  clean = clean.replace(footerRegex, '');

  // Remove any legacy untagged amaavigo header tables if present
  clean = clean.replace(
    /<table[^>]*class="[^"]*amaavigo-document-header[^"]*"[\s\S]*?<\/table>\n*/gi,
    ''
  );
  clean = clean.replace(
    /\n*<table[^>]*class="[^"]*amaavigo-document-footer[^"]*"[\s\S]*?<\/table>/gi,
    ''
  );

  // Strip unneeded redundant policy metadata header
  clean = stripPolicyMetadataHeader(clean);

  return clean.trim();
}

/**
 * Prepends the dynamic Header and appends the dynamic Footer to raw document content.
 */
export function appendApprovedHeaderAndFooter(
  rawContent: string,
  data: DocumentHeaderFooterData
): string {
  const cleanBody = extractCleanBody(rawContent);
  const header = generateHeaderHtml(data);
  const footer = generateFooterHtml(data);

  return `${header}\n\n${cleanBody}\n\n${footer}`;
}

/**
 * Detects if the rawContent already has an embedded header/footer block.
 */
export function hasEmbeddedHeaderFooter(content: string): boolean {
  if (!content) return false;
  return (
    content.includes(HEADER_START_TAG) ||
    content.includes('amaavigo-document-header') ||
    content.includes('Document Name:')
  );
}

/**
 * Parses header & footer dynamic fields from HTML or rawContent if present.
 */
export function extractHeaderFooterData(content: string): DocumentHeaderFooterData | null {
  if (!content) return null;

  const hasHeader =
    content.includes(HEADER_START_TAG) || content.includes('amaavigo-document-header');
  const hasFooter =
    content.includes(FOOTER_START_TAG) || content.includes('amaavigo-document-footer');

  if (!hasHeader && !hasFooter && !content.includes('Document Name:')) {
    return null;
  }

  let companyName = 'Amaavigo';
  let documentTitle = '';
  let versionNumber = '1.0';
  let effectiveDate = '';
  let createdByName = '';
  let approvedByName = '';
  let approvedDate = '';

  const docNameMatch = content.match(/Document Name:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (docNameMatch) documentTitle = docNameMatch[1].trim();

  const verMatch = content.match(/Version:\s*([0-9.a-zA-Z]+)/i);
  if (verMatch) versionNumber = verMatch[1].trim();

  const effMatch = content.match(/Effective date\s*:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (effMatch) effectiveDate = effMatch[1].trim();

  const creatorMatch = content.match(/Created by:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (creatorMatch) createdByName = creatorMatch[1].trim();

  const approverMatch = content.match(/Approved by:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (approverMatch) approvedByName = approverMatch[1].trim();

  const appDateMatch = content.match(/Approved Date:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (appDateMatch) approvedDate = appDateMatch[1].trim();

  const isApproved = Boolean(
    approvedByName &&
    approvedByName !== 'Not yet approved' &&
    approvedByName !== 'Pending Review' &&
    approvedByName !== 'Pending Approval' &&
    !approvedByName.toLowerCase().includes('not yet') &&
    approvedDate &&
    approvedDate !== 'Not yet approved' &&
    approvedDate !== 'Pending Approval' &&
    !approvedDate.toLowerCase().includes('not yet')
  );

  return {
    companyName,
    documentTitle: documentTitle || 'Document',
    versionNumber: versionNumber || '1.0',
    effectiveDate: effectiveDate || formatDDMMYYYY(new Date()),
    createdByName: createdByName || 'HR Author',
    approvedByName: isApproved ? approvedByName : 'Not yet approved',
    approvedDate: isApproved ? formatDDMMYYYY(approvedDate) : 'Not yet approved',
  };
}

/**
 * React Component: Dynamic Document Header Table matching the provided screenshot specification.
 */
export const DocumentHeaderTable: React.FC<{
  data: DocumentHeaderFooterData;
  className?: string;
}> = ({ data, className = '' }) => {
  const company = data.companyName || 'Amaavigo';
  const ver = cleanVersionNumber(data.versionNumber);
  const title = data.documentTitle || 'Document';
  const effective = formatDDMMYYYY(data.effectiveDate);

  return (
    <div
      className={`w-full border-2 border-slate-900 bg-white text-slate-900 overflow-hidden font-sans mt-2 mb-6 sm:mb-8 shadow-2xs ${className}`}
    >
      <div className="grid grid-cols-12 text-xs divide-x divide-slate-900 items-stretch">
        {/* Col 1: Brand Logo */}
        <div className="col-span-3 sm:col-span-3 p-2 sm:p-3 flex items-center justify-center text-center bg-white">
          <AmaavigoLogo size="sm" variant="full" height={36} showTagline={true} align="center" />
        </div>

        {/* Col 2: Document Name - Full display with generous column width */}
        <div className="col-span-5 sm:col-span-5 p-3 sm:p-4 flex flex-col justify-center bg-white">
          <span className="text-[11px] sm:text-xs font-bold text-slate-900 block uppercase tracking-wide">
            Document Name:
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-1 leading-snug break-words">
            {title}
          </span>
        </div>

        {/* Col 3: Version */}
        <div className="col-span-2 sm:col-span-2 p-3 sm:p-4 flex items-center justify-center text-center bg-white">
          <span className="text-xs sm:text-sm font-bold text-slate-900 whitespace-nowrap">
            Version: {ver}
          </span>
        </div>

        {/* Col 4: Effective Date */}
        <div className="col-span-2 sm:col-span-2 p-3 sm:p-4 flex flex-col justify-center bg-white">
          <span className="text-[11px] sm:text-xs font-bold text-slate-900 block uppercase tracking-wide whitespace-nowrap">
            Effective date :
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-1 font-mono whitespace-nowrap">
            {effective}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * React Component: Dynamic Document Footer Table matching the provided screenshot specification.
 */
export const DocumentFooterTable: React.FC<{
  data: DocumentHeaderFooterData;
  className?: string;
}> = ({ data, className = '' }) => {
  const creator = data.createdByName || 'HR Author';
  const isApproved = Boolean(
    data.approvedByName &&
    data.approvedByName !== 'Not yet approved' &&
    data.approvedByName !== 'Pending Review' &&
    data.approvedByName !== 'Pending Approval' &&
    !data.approvedByName.toLowerCase().includes('not yet') &&
    data.approvedDate &&
    data.approvedDate !== 'Not yet approved' &&
    data.approvedDate !== 'Pending Approval' &&
    !data.approvedDate.toLowerCase().includes('not yet')
  );

  const approver = isApproved ? data.approvedByName : 'Not yet approved';
  const approvedDate = isApproved ? formatDDMMYYYY(data.approvedDate) : 'Not yet approved';

  return (
    <div
      className={`w-full border-2 border-slate-900 bg-white text-slate-900 overflow-hidden font-sans my-4 shadow-2xs ${className}`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 text-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-900 items-stretch">
        {/* Col 1: Created by */}
        <div className="p-3 sm:p-4 flex flex-col justify-center bg-white">
          <span className="text-[11px] sm:text-xs font-bold text-slate-900 block uppercase tracking-wide">
            Created by:
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-1">
            {creator}
          </span>
        </div>

        {/* Col 2: Approved by */}
        <div className="p-3 sm:p-4 flex flex-col justify-center bg-white">
          <span className="text-[11px] sm:text-xs font-bold text-slate-900 block uppercase tracking-wide">
            Approved by:
          </span>
          <span
            className={`text-xs sm:text-sm mt-1 ${
              isApproved ? 'font-semibold text-slate-800' : 'font-medium text-slate-500 italic'
            }`}
          >
            {approver}
          </span>
        </div>

        {/* Col 3: Approved Date */}
        <div className="p-3 sm:p-4 flex flex-col justify-center bg-white">
          <span className="text-[11px] sm:text-xs font-bold text-slate-900 block uppercase tracking-wide">
            Approved Date:
          </span>
          <span
            className={`text-xs sm:text-sm mt-1 font-mono ${
              isApproved ? 'font-semibold text-slate-800' : 'font-medium text-slate-500 italic'
            }`}
          >
            {approvedDate}
          </span>
        </div>
      </div>
    </div>
  );
};
