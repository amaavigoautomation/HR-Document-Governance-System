import React, { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
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
  Heading1,
  Heading2,
  Heading3,
  ChevronDown,
} from 'lucide-react';

export interface WysiwygDocumentEditorProps {
  id?: string;
  value: string;
  onChange: (htmlValue: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  required?: boolean;
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

function parseInlineMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: #2563eb; text-decoration: underline;">$1</a>');
}

// Helper to convert plain Markdown headings, lists & inline styles into clean HTML for initial loading
function markdownToHtml(md: string): string {
  if (!md) return '';
  // If already contains HTML tags, return as-is
  if (/<[a-z][\s\S]*>/i.test(md)) return md;

  const lines = md.split('\n');
  const result: string[] = [];
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push('<p><br></p>');
      continue;
    }

    if (trimmed.startsWith('# ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h1 style="font-size: 24px; font-weight: bold; color: #0f172a; margin-top: 16px; margin-bottom: 8px;">${parseInlineMarkdown(trimmed.substring(2))}</h1>`);
    } else if (trimmed.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h2 style="font-size: 18px; font-weight: bold; color: #FA7014; margin-top: 14px; margin-bottom: 6px;">${parseInlineMarkdown(trimmed.substring(3))}</h2>`);
    } else if (trimmed.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h3 style="font-size: 15px; font-weight: bold; color: #334155; margin-top: 12px; margin-bottom: 4px;">${parseInlineMarkdown(trimmed.substring(4))}</h3>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        result.push('<ul style="list-style-type: disc; padding-left: 24px; margin: 8px 0;">');
        inList = true;
      }
      result.push(`<li>${parseInlineMarkdown(trimmed.substring(2))}</li>`);
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<p style="margin-bottom: 8px; line-height: 1.6;">${parseInlineMarkdown(trimmed)}</p>`);
    }
  }

  if (inList) {
    result.push('</ul>');
  }

  return result.join('');
}

export const WysiwygDocumentEditor: React.FC<WysiwygDocumentEditorProps> = ({
  id,
  value,
  onChange,
  placeholder = 'Type, paste, or format document text here like in Microsoft Word...',
  minHeight = '240px',
  className = '',
  required = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  // Keep editor DOM in sync with value prop
  useEffect(() => {
    if (editorRef.current) {
      const formattedHtml = markdownToHtml(value);
      if (editorRef.current.innerHTML !== formattedHtml && editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = formattedHtml || '';
      }
    }
  }, [value]);

  // Handle content input
  const handleEditorInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      onChange(html);
    }
  };

  // Execute browser native formatting command
  const exec = (command: string, arg: string | undefined = undefined) => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, arg);
    handleEditorInput();
  };

  // Font Family
  const handleFontFamilyChange = (font: string) => {
    if (!font) return;
    if (editorRef.current) {
      editorRef.current.focus();
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    if (sel.isCollapsed) {
      const node = sel.anchorNode;
      const element = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
      if (element && element !== editorRef.current && editorRef.current.contains(element)) {
        element.style.fontFamily = font;
        handleEditorInput();
        return;
      }
    }

    try {
      document.execCommand('fontName', false, font);
      if (editorRef.current) {
        const fontTags = editorRef.current.querySelectorAll(`font[face="${font}"]`);
        fontTags.forEach((fontEl) => {
          const span = document.createElement('span');
          span.style.fontFamily = font;
          span.innerHTML = fontEl.innerHTML;
          fontEl.parentNode?.replaceChild(span, fontEl);
        });
      }
    } catch (e) {
      console.warn('Font family application error:', e);
    }
    handleEditorInput();
  };

  // Font Size
  const handleFontSizeChange = (size: string) => {
    if (!size) return;
    if (editorRef.current) {
      editorRef.current.focus();
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    if (sel.isCollapsed) {
      const node = sel.anchorNode;
      const element = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
      if (element && element !== editorRef.current && editorRef.current.contains(element)) {
        element.style.fontSize = size;
        handleEditorInput();
        return;
      }
    }

    try {
      document.execCommand('fontSize', false, '7');
      if (editorRef.current) {
        const fontTags = editorRef.current.querySelectorAll('font[size="7"]');
        if (fontTags.length > 0) {
          fontTags.forEach((fontEl) => {
            const span = document.createElement('span');
            span.style.fontSize = size;
            span.innerHTML = fontEl.innerHTML;
            fontEl.parentNode?.replaceChild(span, fontEl);
          });
          handleEditorInput();
          return;
        }
      }
    } catch (e) {
      // Fallback
    }

    try {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = size;
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch (e) {
      console.warn('Font size application error:', e);
    }
    handleEditorInput();
  };

  // Text Color
  const handleSelectColor = (hex: string) => {
    exec('foreColor', hex);
    setShowColorPicker(false);
  };

  // Highlight Color
  const handleSelectHighlight = (hex: string) => {
    try {
      exec('hiliteColor', hex);
    } catch (e) {
      exec('backColor', hex);
    }
    setShowHighlightPicker(false);
  };

  // Insert HTML Element Node at Selection Range
  const insertNodeAtSelection = (node: Node) => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.collapse(false);
    } else if (editorRef.current) {
      editorRef.current.appendChild(node);
    }
    handleEditorInput();
  };

  // Confirm Link Insertion
  const handleConfirmInsertLink = () => {
    if (!linkUrl) return;
    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    const textToUse = linkText || linkUrl;

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.color = '#2563eb';
    a.style.textDecoration = 'underline';
    a.innerText = textToUse;

    insertNodeAtSelection(a);
    setShowLinkModal(false);
    setLinkUrl('');
    setLinkText('');
  };

  // Insert Table
  const handleInsertTable = () => {
    const tableContainer = document.createElement('div');
    tableContainer.className = 'my-3 overflow-x-auto';
    tableContainer.innerHTML = `
      <table style="width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; text-align: left;">
        <thead>
          <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
            <th style="padding: 8px 12px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">Clause / Section</th>
            <th style="padding: 8px 12px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">Policy Provision</th>
            <th style="padding: 8px 12px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">Responsible Department</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">1.0 Purpose</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Define workplace guidelines and operational compliance</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Human Resources</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">2.0 Eligibility</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">All full-time and part-time staff members</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">Operations & Governance</td>
          </tr>
        </tbody>
      </table>
      <p><br></p>
    `;
    insertNodeAtSelection(tableContainer);
  };

  // Insert Callout Box
  const handleInsertCallout = () => {
    const callout = document.createElement('div');
    callout.style.backgroundColor = '#eff6ff';
    callout.style.borderLeft = '4px solid #3b82f6';
    callout.style.padding = '12px 16px';
    callout.style.margin = '12px 0';
    callout.style.borderRadius = '8px';
    callout.style.color = '#1e3a8a';
    callout.style.fontSize = '13px';
    callout.innerHTML = `
      <strong style="display: block; margin-bottom: 4px; color: #1d4ed8;">📌 COMPLIANCE NOTE:</strong>
      All employees must acknowledge this section within 14 business days of publication.
    `;
    insertNodeAtSelection(callout);
  };

  // Word & Character count calculation
  const textOnly = editorRef.current ? (editorRef.current.innerText || '') : '';
  const wordCount = textOnly.trim() ? textOnly.trim().split(/\s+/).length : 0;
  const charCount = textOnly.length;

  return (
    <div className={`bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs ${className}`}>
      {/* WORD TOOLBAR TOP STRIP */}
      <div className="bg-slate-50 border-b border-slate-200 p-2 space-y-2 select-none">
        {/* ROW 1: FONTS, HEADINGS, SIZES */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* FONT FAMILY DROPDOWN */}
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

            {/* FONT SIZE DROPDOWN */}
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

            <div className="h-4 w-px bg-slate-300 mx-0.5" />

            {/* HEADINGS */}
            <button
              type="button"
              onClick={() => exec('formatBlock', '<h1>')}
              className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
              title="Heading 1"
            >
              <Heading1 className="w-4 h-4 text-slate-900" />
            </button>
            <button
              type="button"
              onClick={() => exec('formatBlock', '<h2>')}
              className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
              title="Heading 2"
            >
              <Heading2 className="w-4 h-4 text-[#FA7014]" />
            </button>
            <button
              type="button"
              onClick={() => exec('formatBlock', '<h3>')}
              className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
              title="Heading 3"
            >
              <Heading3 className="w-4 h-4 text-slate-700" />
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-400 flex items-center space-x-2 shrink-0">
            <span>{wordCount} words</span>
            <span>•</span>
            <span>{charCount} chars</span>
          </div>
        </div>

        {/* ROW 2: FORMATTING, COLORS, ALIGNMENT, INSERTS */}
        <div className="flex flex-wrap items-center gap-1">
          {/* BOLD */}
          <button
            type="button"
            onClick={() => exec('bold')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg font-black transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>

          {/* ITALIC */}
          <button
            type="button"
            onClick={() => exec('italic')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg italic transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>

          {/* UNDERLINE */}
          <button
            type="button"
            onClick={() => exec('underline')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg underline transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Underline (Ctrl+U)"
          >
            <Underline className="w-4 h-4" />
          </button>

          {/* STRIKETHROUGH */}
          <button
            type="button"
            onClick={() => exec('strikeThrough')}
            className="p-1.5 text-slate-800 hover:bg-white rounded-lg line-through transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Strikethrough"
          >
            <Strikethrough className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* COLOR PICKER */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowHighlightPicker(false);
              }}
              className="p-1.5 text-slate-800 hover:bg-white rounded-lg flex items-center space-x-1 transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
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

          {/* HIGHLIGHT COLOR PICKER */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowHighlightPicker(!showHighlightPicker);
                setShowColorPicker(false);
              }}
              className="p-1.5 text-slate-800 hover:bg-white rounded-lg flex items-center space-x-1 transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
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
            onClick={() => exec('justifyLeft')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Align Left"
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyCenter')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Align Center"
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyRight')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Align Right"
          >
            <AlignRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('justifyFull')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Justify Text"
          >
            <AlignJustify className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* LISTS */}
          <button
            type="button"
            onClick={() => exec('insertUnorderedList')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Bulleted List"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => exec('insertOrderedList')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* INSERTS: LINK, TABLE, CALLOUT, RULE */}
          <button
            type="button"
            onClick={() => setShowLinkModal(true)}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Insert Hyperlink"
          >
            <LinkIcon className="w-4 h-4 text-blue-600" />
          </button>
          <button
            type="button"
            onClick={handleInsertTable}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Insert Structured Table"
          >
            <TableIcon className="w-4 h-4 text-emerald-600" />
          </button>
          <button
            type="button"
            onClick={handleInsertCallout}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Insert Compliance Callout Box"
          >
            <AlertCircle className="w-4 h-4 text-[#FA7014]" />
          </button>
          <button
            type="button"
            onClick={() => exec('insertHorizontalRule')}
            className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Insert Horizontal Divider Line"
          >
            <Minus className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* CLEAR FORMATTING */}
          <button
            type="button"
            onClick={() => exec('removeFormat')}
            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer"
            title="Clear Formatting on Selected Text"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* RICH WYSIWYG EDITABLE CANVAS (WORD-LIKE EXPERIENCE) */}
      <div
        id={id}
        ref={editorRef}
        contentEditable
        onInput={handleEditorInput}
        onBlur={handleEditorInput}
        style={{ minHeight }}
        className="p-4 bg-white text-slate-900 text-sm font-sans leading-relaxed focus:outline-hidden overflow-y-auto max-h-[420px] document-html-content"
        data-placeholder={placeholder}
      />

      {/* Hidden textarea to preserve standard form submission & required state checks */}
      <textarea
        value={value}
        onChange={() => {}}
        required={required}
        className="sr-only opacity-0 w-0 h-0 pointer-events-none"
        tabIndex={-1}
      />

      {/* LINK MODAL */}
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
