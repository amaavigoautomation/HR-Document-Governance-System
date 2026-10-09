import React, { useState, useRef } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Type,
  Palette,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  ListTodo,
  Link as LinkIcon,
  Table as TableIcon,
  AlertCircle,
  Minus,
  RotateCcw,
  Eye,
  Edit3,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Sparkles,
  ChevronDown,
} from 'lucide-react';

export interface DocumentEditorToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (newValue: string) => void;
  showPreviewToggle?: boolean;
  isPreviewMode?: boolean;
  onTogglePreview?: () => void;
}

const COLOR_SWATCHES = [
  { name: 'Dark Slate', hex: '#0f172a' },
  { name: 'Amaavigo Orange', hex: '#FA7014' },
  { name: 'Royal Blue', hex: '#2563eb' },
  { name: 'Emerald Green', hex: '#059669' },
  { name: 'Crimson Red', hex: '#dc2626' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Gray', hex: '#64748b' },
];

const HIGHLIGHT_SWATCHES = [
  { name: 'Yellow', hex: '#fef08a' },
  { name: 'Green', hex: '#bbf7d0' },
  { name: 'Cyan', hex: '#a5f3fc' },
  { name: 'Pink', hex: '#fbcfe8' },
  { name: 'Orange', hex: '#fed7aa' },
];

const FONT_FAMILIES = [
  { label: 'Sans-Serif (Default)', value: 'Inter, system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Courier New (Monospace)', value: "'Courier New', Courier, monospace" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
];

const FONT_SIZES = [
  { label: '10px (Very Small)', value: '10px' },
  { label: '12px (Small)', value: '12px' },
  { label: '14px (Normal Body)', value: '14px' },
  { label: '16px (Medium)', value: '16px' },
  { label: '18px (Large Subhead)', value: '18px' },
  { label: '20px (X-Large)', value: '20px' },
  { label: '24px (Title / H2)', value: '24px' },
  { label: '28px (Main Heading)', value: '28px' },
  { label: '32px (Banner Title)', value: '32px' },
];

export const DocumentEditorToolbar: React.FC<DocumentEditorToolbarProps> = ({
  textareaRef,
  value,
  onChange,
  showPreviewToggle = true,
  isPreviewMode = false,
  onTogglePreview,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  // Helper to wrap or insert text at cursor position in textarea
  const applyFormatting = (prefix: string, suffix: string = '', fallbackText: string = 'text') => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + `${prefix}${fallbackText}${suffix}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = value;
    const selected = text.substring(start, end) || fallbackText;

    const replacement = `${prefix}${selected}${suffix}`;
    const newText = text.substring(0, start) + replacement + text.substring(end);

    onChange(newText);

    // Restore focus and selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  // Line-based formatting (lists, quotes, headings)
  const applyLinePrefix = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = value;

    // Find start of line
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', end);
    const actualEnd = lineEnd === -1 ? text.length : lineEnd;

    const selectedLines = text.substring(lineStart, actualEnd);
    const updatedLines = selectedLines
      .split('\n')
      .map((line) => {
        if (line.startsWith(prefix)) {
          return line.substring(prefix.length); // toggle off
        }
        return `${prefix}${line}`;
      })
      .join('\n');

    const newText = text.substring(0, lineStart) + updatedLines + text.substring(actualEnd);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + updatedLines.length);
    }, 0);
  };

  // Font family change
  const handleFontFamilyChange = (fontVal: string) => {
    if (!fontVal) return;
    applyFormatting(`<span style="font-family: ${fontVal};">`, '</span>', 'Formatted Text');
  };

  // Font size change
  const handleFontSizeChange = (sizeVal: string) => {
    if (!sizeVal) return;
    applyFormatting(`<span style="font-size: ${sizeVal};">`, '</span>', 'Custom Size Text');
  };

  // Color picker selection
  const handleSelectColor = (hex: string) => {
    applyFormatting(`<span style="color: ${hex};">`, '</span>', 'Colored Text');
    setShowColorPicker(false);
  };

  // Highlight picker selection
  const handleSelectHighlight = (hex: string) => {
    applyFormatting(`<mark style="background-color: ${hex}; padding: 0 4px; border-radius: 4px;">`, '</mark>', 'Highlighted Text');
    setShowHighlightPicker(false);
  };

  // Insert Link
  const handleConfirmInsertLink = () => {
    if (!linkUrl) return;
    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    const textToUse = linkText || 'Click here';
    applyFormatting(`<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">`, `</a>`, textToUse);
    setShowLinkModal(false);
    setLinkUrl('');
    setLinkText('');
  };

  // Insert Table
  const handleInsertTable = () => {
    const tableTemplate = `\n<table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px;">
  <thead>
    <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0;">
      <th style="padding: 8px 12px; text-align: left; border: 1px solid #e2e8f0; font-weight: bold;">Section / Clause</th>
      <th style="padding: 8px 12px; text-align: left; border: 1px solid #e2e8f0; font-weight: bold;">Compliance Requirement</th>
      <th style="padding: 8px 12px; text-align: left; border: 1px solid #e2e8f0; font-weight: bold;">Responsible Dept</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">1.0 Scope</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">All full-time employees and contractors</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Human Resources</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">2.0 Procedure</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Annual policy review and acknowledgement</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Compliance & Legal</td>
    </tr>
  </tbody>
</table>\n`;
    applyFormatting(tableTemplate, '', '');
  };

  // Insert Callout Box
  const handleInsertCallout = () => {
    const calloutTemplate = `\n<div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 12px 0; border-radius: 8px; color: #1e3a8a; font-size: 13px;">
  <strong style="display: block; margin-bottom: 4px; color: #1d4ed8;">📌 COMPLIANCE NOTE:</strong>
  All employees must review and acknowledge this requirement within 14 calendar days of policy publication.
</div>\n`;
    applyFormatting(calloutTemplate, '', '');
  };

  // Clear Formatting
  const handleClearFormatting = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;

    const selected = value.substring(start, end);
    // Strip HTML tags and markdown markers
    const stripped = selected
      .replace(/<[^>]*>/g, '')
      .replace(/[*_~#`>]/g, '');

    const newText = value.substring(0, start) + stripped + value.substring(end);
    onChange(newText);
  };

  // Words & Characters calculation
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const charCount = value.length;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-t-2xl p-2 sm:p-2.5 space-y-2 select-none shadow-2xs">
      {/* TOOLBAR ROW 1: FONT, SIZE, HEADINGS & TOGGLES */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* FONT FAMILY DROPDOWN */}
          <div className="relative">
            <select
              onChange={(e) => handleFontFamilyChange(e.target.value)}
              defaultValue=""
              className="text-xs bg-white border border-slate-200 text-slate-800 rounded-lg px-2 py-1 focus:ring-2 focus:ring-[#FA7014] focus:outline-hidden cursor-pointer"
              title="Font Family"
            >
              <option value="" disabled>Font Family</option>
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* FONT SIZE DROPDOWN */}
          <div className="relative">
            <select
              onChange={(e) => handleFontSizeChange(e.target.value)}
              defaultValue=""
              className="text-xs bg-white border border-slate-200 text-slate-800 rounded-lg px-2 py-1 focus:ring-2 focus:ring-[#FA7014] focus:outline-hidden cursor-pointer"
              title="Font Size"
            >
              <option value="" disabled>Font Size</option>
              {FONT_SIZES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* HEADINGS PRESETS */}
          <button
            type="button"
            onClick={() => applyLinePrefix('# ')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Heading 1 (# Title)"
          >
            <Heading1 className="w-4 h-4 text-slate-800" />
          </button>
          <button
            type="button"
            onClick={() => applyLinePrefix('## ')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Heading 2 (## Section)"
          >
            <Heading2 className="w-4 h-4 text-[#FA7014]" />
          </button>
          <button
            type="button"
            onClick={() => applyLinePrefix('### ')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Heading 3 (### Subsection)"
          >
            <Heading3 className="w-4 h-4 text-slate-700" />
          </button>
        </div>

        {/* EDITOR / PREVIEW TOGGLE (IF ENABLED) */}
        {showPreviewToggle && onTogglePreview && (
          <button
            type="button"
            onClick={onTogglePreview}
            className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl text-xs font-bold transition-all shadow-2xs ${
              isPreviewMode
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            {isPreviewMode ? (
              <>
                <Edit3 className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>Return to Editor</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>Word Live Preview</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* TOOLBAR ROW 2: FORMATTING, COLORS, ALIGNMENT & INSERTS */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {/* BOLD */}
          <button
            type="button"
            onClick={() => applyFormatting('<b>', '</b>', 'Bold Text')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg font-black transition-colors border border-transparent hover:border-slate-200"
            title="Bold (Ctrl+B / <b>)"
          >
            <Bold className="w-4 h-4" />
          </button>

          {/* ITALIC */}
          <button
            type="button"
            onClick={() => applyFormatting('<i>', '</i>', 'Italic Text')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg italic transition-colors border border-transparent hover:border-slate-200"
            title="Italic (Ctrl+I / <i>)"
          >
            <Italic className="w-4 h-4" />
          </button>

          {/* UNDERLINE */}
          <button
            type="button"
            onClick={() => applyFormatting('<u>', '</u>', 'Underlined Text')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg underline transition-colors border border-transparent hover:border-slate-200"
            title="Underline (<u>)"
          >
            <Underline className="w-4 h-4" />
          </button>

          {/* STRIKETHROUGH */}
          <button
            type="button"
            onClick={() => applyFormatting('<s>', '</s>', 'Strikethrough Text')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg line-through transition-colors border border-transparent hover:border-slate-200"
            title="Strikethrough (<s>)"
          >
            <Strikethrough className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* TEXT COLOR PICKER DROPDOWN */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowHighlightPicker(false);
              }}
              className="p-1.5 text-slate-800 hover:bg-white rounded-lg flex items-center space-x-1 transition-colors border border-transparent hover:border-slate-200"
              title="Text Color"
            >
              <Palette className="w-4 h-4 text-[#FA7014]" />
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showColorPicker && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 w-48 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Select Text Color</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => handleSelectColor(c.hex)}
                      className="w-8 h-8 rounded-lg border border-slate-200 hover:scale-110 transition-transform cursor-pointer shadow-2xs"
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
                <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-600">Custom Color:</span>
                  <input
                    type="color"
                    onChange={(e) => handleSelectColor(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border-0"
                  />
                </div>
              </div>
            )}
          </div>

          {/* HIGHLIGHT COLOR PICKER DROPDOWN */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowHighlightPicker(!showHighlightPicker);
                setShowColorPicker(false);
              }}
              className="p-1.5 text-slate-800 hover:bg-white rounded-lg flex items-center space-x-1 transition-colors border border-transparent hover:border-slate-200"
              title="Text Highlight / Background Color"
            >
              <Highlighter className="w-4 h-4 text-amber-500" />
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showHighlightPicker && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 w-48 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Text Highlight Color</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {HIGHLIGHT_SWATCHES.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => handleSelectHighlight(c.hex)}
                      className="w-7 h-7 rounded-lg border border-slate-200 hover:scale-110 transition-transform cursor-pointer shadow-2xs"
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* ALIGNMENT */}
          <button
            type="button"
            onClick={() => applyFormatting('<div align="left">\n', '\n</div>', 'Left Aligned Paragraph')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Align Left"
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('<div align="center">\n', '\n</div>', 'Centered Paragraph')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Align Center"
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('<div align="right">\n', '\n</div>', 'Right Aligned Paragraph')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Align Right"
          >
            <AlignRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('<div align="justify">\n', '\n</div>', 'Justified Text Paragraph')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Justify Text"
          >
            <AlignJustify className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* LISTS */}
          <button
            type="button"
            onClick={() => applyLinePrefix('- ')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Bulleted List (- Item)"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => applyLinePrefix('1. ')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Numbered List (1. Item)"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => applyLinePrefix('- [ ] ')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Checklist (- [ ] Task)"
          >
            <ListTodo className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* INSERTS: LINK, TABLE, CALLOUT, RULE */}
          <button
            type="button"
            onClick={() => setShowLinkModal(true)}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Insert Hyperlink"
          >
            <LinkIcon className="w-4 h-4 text-blue-600" />
          </button>
          <button
            type="button"
            onClick={handleInsertTable}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Insert Structured Table"
          >
            <TableIcon className="w-4 h-4 text-emerald-600" />
          </button>
          <button
            type="button"
            onClick={handleInsertCallout}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Insert Compliance Callout Box"
          >
            <AlertCircle className="w-4 h-4 text-[#FA7014]" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('\n---\n', '', '')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Insert Horizontal Divider Line"
          >
            <Minus className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* CLEAR FORMATTING */}
          <button
            type="button"
            onClick={handleClearFormatting}
            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200"
            title="Clear Formatting on Selected Text"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* COUNTER STRIP */}
        <div className="text-[11px] font-mono text-slate-400 flex items-center space-x-2 shrink-0">
          <span>{wordCount} words</span>
          <span>•</span>
          <span>{charCount} chars</span>
        </div>
      </div>

      {/* INSERT LINK MODAL */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-blue-600" />
                <span>Insert Web Hyperlink</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Display Text:</label>
                <input
                  type="text"
                  placeholder="e.g. Employee Portal Guide"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#FA7014] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Target URL / Web Link:</label>
                <input
                  type="url"
                  placeholder="e.g. https://amaavigo.com/policy-guide"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#FA7014] focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmInsertLink}
                disabled={!linkUrl}
                className="px-4 py-2 bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50"
              >
                Insert Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
