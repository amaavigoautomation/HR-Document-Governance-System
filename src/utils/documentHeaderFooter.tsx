import React from 'react';
import { AmaavigoLogo } from '../components/AmaavigoLogo';

export interface DocumentHeaderFooterData {
  companyName: string;
  documentTitle: string;
  versionNumber: string;
  effectiveDate: string; // DD/MM/YYYY
  reReviewDate?: string; // DD/MM/YYYY
  createdByName: string;
  creationDate?: string; // DD/MM/YYYY
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
  const reReview = formatDDMMYYYY(data.reReviewDate, '');

  return `${HEADER_START_TAG}
<table class="amaavigo-document-header" style="width: 100%; border-collapse: collapse; border: 2px solid #0f172a; margin-top: 36px; margin-bottom: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff;">
  <tr>
    <td style="border: 1px solid #0f172a; padding: 10px 12px; width: 22%; vertical-align: middle; text-align: center; background: #ffffff;">
      <div style="display: inline-block; text-align: center;">
        <svg viewBox="0 0 240 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="height: 32px; width: auto; max-width: 155px; display: block; margin: 0 auto;" aria-label="Amaavigo - Where Brand takes Flight">
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
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 30%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Document Name:</div>
      <div style="font-size: 13px; font-weight: 600; color: #1e293b; line-height: 1.3;">${title}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 14%; vertical-align: middle;">
      <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Version: ${ver}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 17%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Effective date :</div>
      <div style="font-size: 13px; font-weight: 600; color: #1e293b;">${effective}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 17%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Re-review date :</div>
      <div style="font-size: 13px; font-weight: 600; color: #1e293b;">${reReview || 'Annual / As req.'}</div>
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
  const creationDate = formatDDMMYYYY(data.creationDate || (data as any).createdAt, formatDDMMYYYY(new Date()));
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
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 25%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Created by:</div>
      <div style="font-size: 13px; font-weight: 600; color: #1e293b;">${creator}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 25%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Creation date:</div>
      <div style="font-size: 13px; font-weight: 600; color: #1e293b;">${creationDate}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 25%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Approved by:</div>
      <div style="font-size: 13px; font-weight: ${isApproved ? '600' : '500'}; color: ${isApproved ? '#1e293b' : '#64748b'};">${approver}</div>
    </td>
    <td style="border: 1px solid #0f172a; padding: 10px 14px; width: 25%; vertical-align: middle;">
      <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 3px;">Approved Date:</div>
      <div style="font-size: 13px; font-weight: ${isApproved ? '600' : '500'}; color: ${isApproved ? '#1e293b' : '#64748b'};">${approvedDate}</div>
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

  // 1. Strip tagged header/footer blocks
  res = res.replace(/<!--AMAAVIGO_HEADER_START-->[\s\S]*?<!--AMAAVIGO_HEADER_END-->\n*/gi, '');
  res = res.replace(/\n*<!--AMAAVIGO_FOOTER_START-->[\s\S]*?<!--AMAAVIGO_FOOTER_END-->/gi, '');

  // 2. Strip legacy header/footer tables
  res = res.replace(/<table[^>]*class="[^"]*amaavigo-document-header[^"]*"[\s\S]*?<\/table>\n*/gi, '');
  res = res.replace(/\n*<table[^>]*class="[^"]*amaavigo-document-footer[^"]*"[\s\S]*?<\/table>/gi, '');

  return res;
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

  const reRevMatch = content.match(/Re-review date\s*:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  let reReviewDate = '';
  if (reRevMatch) reReviewDate = reRevMatch[1].trim();

  const creatorMatch = content.match(/Created by:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (creatorMatch) createdByName = creatorMatch[1].trim();

  const createDateMatch = content.match(/Creation date\s*:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  let creationDate = '';
  if (createDateMatch) creationDate = createDateMatch[1].trim();

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
    reReviewDate: reReviewDate || '',
    createdByName: createdByName || 'HR Author',
    creationDate: creationDate || formatDDMMYYYY(new Date()),
    approvedByName: isApproved ? approvedByName : 'Not yet approved',
    approvedDate: isApproved ? formatDDMMYYYY(approvedDate) : 'Not yet approved',
  };
}

/**
 * React Component: Dynamic Document Header Table matching the provided screenshot specification.
 * Features 5 balanced columns: Logo, Document Name, Version, Effective Date, and Re-review Date.
 * Includes ample top breathing room to avoid edge touching / print clipping.
 */
export const DocumentHeaderTable: React.FC<{
  data: DocumentHeaderFooterData;
  className?: string;
}> = ({ data, className = '' }) => {
  const company = data.companyName || 'Amaavigo';
  const ver = cleanVersionNumber(data.versionNumber);
  const title = data.documentTitle || 'Document';
  const effective = formatDDMMYYYY(data.effectiveDate);
  const reReview = formatDDMMYYYY(data.reReviewDate, '');

  return (
    <div
      className={`w-full border-2 border-slate-900 bg-white text-slate-900 overflow-hidden font-sans mt-6 sm:mt-8 pt-1 mb-6 sm:mb-8 shadow-2xs print:mt-6 print:mb-6 print:break-inside-avoid ${className}`}
    >
      <div className="grid grid-cols-12 text-xs divide-x divide-slate-900 items-stretch">
        {/* Col 1: Brand Logo */}
        <div className="col-span-3 sm:col-span-3 p-2 sm:p-2.5 flex items-center justify-center text-center bg-white min-w-0 overflow-hidden">
          <AmaavigoLogo size="sm" variant="full" height={32} showTagline={true} align="center" />
        </div>

        {/* Col 2: Document Name - Full display with ample space, zero overlap */}
        <div className="col-span-3 sm:col-span-3 p-2 sm:p-2.5 flex flex-col justify-center bg-white min-w-0 overflow-hidden">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide truncate">
            Document Name:
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5 leading-snug break-words">
            {title}
          </span>
        </div>

        {/* Col 3: Version */}
        <div className="col-span-2 sm:col-span-2 p-2 sm:p-2 flex flex-col justify-center items-center text-center bg-white min-w-0 overflow-hidden">
          <span className="text-[11px] sm:text-xs font-bold text-slate-900 break-words leading-tight">
            Version: {ver}
          </span>
        </div>

        {/* Col 4: Effective Date */}
        <div className="col-span-2 sm:col-span-2 p-2 sm:p-2.5 flex flex-col justify-center bg-white min-w-0 overflow-hidden">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide truncate">
            Effective date :
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5 font-mono truncate">
            {effective}
          </span>
        </div>

        {/* Col 5: Re-review Date (beside effective date on right!) */}
        <div className="col-span-2 sm:col-span-2 p-2 sm:p-2.5 flex flex-col justify-center bg-white min-w-0 overflow-hidden">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide truncate">
            Re-review date :
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5 font-mono truncate">
            {reReview || 'Annual / As req.'}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * React Component: Dynamic Document Footer Table matching the provided specification.
 * Features 4 balanced columns: Created by, Creation date (intact from creation), Approved by, and Approved Date.
 */
export const DocumentFooterTable: React.FC<{
  data: DocumentHeaderFooterData;
  className?: string;
}> = ({ data, className = '' }) => {
  const creator = data.createdByName || 'HR Author';
  const creationDate = formatDDMMYYYY(data.creationDate || (data as any).createdAt, formatDDMMYYYY(new Date()));
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
      <div className="grid grid-cols-2 sm:grid-cols-4 text-xs divide-y sm:divide-y-0 sm:divide-x divide-slate-900 items-stretch">
        {/* Col 1: Created by */}
        <div className="p-2.5 sm:p-3 flex flex-col justify-center bg-white">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide">
            Created by:
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5">
            {creator}
          </span>
        </div>

        {/* Col 2: Creation date (in between Created by and Approved by!) */}
        <div className="p-2.5 sm:p-3 flex flex-col justify-center bg-white">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide">
            Creation date:
          </span>
          <span className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5 font-mono">
            {creationDate}
          </span>
        </div>

        {/* Col 3: Approved by */}
        <div className="p-2.5 sm:p-3 flex flex-col justify-center bg-white">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide">
            Approved by:
          </span>
          <span
            className={`text-xs sm:text-sm mt-0.5 ${
              isApproved ? 'font-semibold text-slate-800' : 'font-medium text-slate-500 italic'
            }`}
          >
            {approver}
          </span>
        </div>

        {/* Col 4: Approved Date */}
        <div className="p-2.5 sm:p-3 flex flex-col justify-center bg-white">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-900 block uppercase tracking-wide">
            Approved Date:
          </span>
          <span
            className={`text-xs sm:text-sm mt-0.5 font-mono ${
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
