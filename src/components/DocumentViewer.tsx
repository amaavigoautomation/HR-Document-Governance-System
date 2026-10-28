import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  Eye,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileCode,
  Sparkles,
  AlertCircle,
  FileCheck,
  Printer,
  ShieldCheck,
  Clock,
  Video,
  Download,
  RefreshCw,
  MessageSquare,
  MessageSquarePlus,
  Trash2,
  Quote,
  X,
  Check,
} from 'lucide-react';
import { extractTextFromRawPdfStream, isRawPdfStream, getBrowserPdfjs } from '../utils/fileParser';
import {
  DocumentHeaderTable,
  DocumentFooterTable,
  DocumentHeaderFooterData,
  extractHeaderFooterData,
  extractCleanBody,
  stripPolicyMetadataHeader,
} from '../utils/documentHeaderFooter';
import { generateCorporatePdfBlob } from '../utils/pdfGenerator';
import {
  stampPdfWithHeaderFooter,
  stampDocxWithHeaderFooter,
  toUint8Array,
  downloadDocumentWithIntactFormat,
  resolveDocumentBytes,
  generateCorporateDocxBlob,
} from '../utils/documentStamper';
import { renderAsync } from 'docx-preview';
import { resolvePlayableMediaUrl } from '../services/mediaStorage';
import { InlineRevisionComment, User } from '../types';

interface DocumentViewerProps {
  fileName: string;
  rawContent: string;
  fileUrl?: string;
  originalFileUrl?: string;
  mimeType?: string;
  className?: string;
  versionId?: string;
  documentId?: string;
  headerFooterData?: DocumentHeaderFooterData;
  enableInlineComments?: boolean;
  inlineComments?: InlineRevisionComment[];
  onAddInlineComment?: (comment: Omit<InlineRevisionComment, 'id' | 'createdAt'>) => void;
  onDeleteInlineComment?: (commentId: string) => void;
  currentUser?: User;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  fileName,
  rawContent,
  fileUrl,
  originalFileUrl,
  mimeType,
  className = '',
  versionId,
  documentId,
  headerFooterData,
  enableInlineComments = false,
  inlineComments = [],
  onAddInlineComment,
  onDeleteInlineComment,
  currentUser,
}) => {
  const effectiveFileUrl = originalFileUrl || fileUrl;

  const isDocx =
    fileName?.toLowerCase().endsWith('.docx') ||
    mimeType?.includes('wordprocessingml') ||
    (effectiveFileUrl && effectiveFileUrl.includes('wordprocessingml'));

  const isPdf =
    fileName?.toLowerCase().endsWith('.pdf') ||
    mimeType === 'application/pdf' ||
    isRawPdfStream(rawContent) ||
    effectiveFileUrl?.startsWith('data:application/pdf');

  const isVideo =
    Boolean(fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)) ||
    Boolean(mimeType?.startsWith('video/')) ||
    Boolean(effectiveFileUrl && effectiveFileUrl.startsWith('data:video/'));

  const [viewMode, setViewMode] = useState<'video' | 'docx' | 'pdf' | 'formatted' | 'raw'>(
    isVideo ? 'video' : isPdf ? 'pdf' : isDocx ? 'docx' : 'formatted'
  );
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [loadingPdf, setLoadingPdf] = useState<boolean>(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [stampedPdfUrl, setStampedPdfUrl] = useState<string | null>(null);

  // DOCX Interactive View State & Sizing
  const [loadingDocx, setLoadingDocx] = useState<boolean>(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const [stampedDocxBlob, setStampedDocxBlob] = useState<Blob | null>(null);
  const [docxScale, setDocxScale] = useState<number>(1.0);
  const [isFitDocxWidth, setIsFitDocxWidth] = useState<boolean>(true);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const docxOuterWrapperRef = useRef<HTMLDivElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  const [activeVideoUrl, setActiveVideoUrl] = useState<string>(effectiveFileUrl || '');

  // Revision inline comments state
  // Revision inline comments state
  const [selectedText, setSelectedText] = useState<string>('');
  const [showCommentModal, setShowCommentModal] = useState<boolean>(false);
  const [commentInput, setCommentInput] = useState<string>('');
  const [showCommentsSidebar, setShowCommentsSidebar] = useState<boolean>(
    Boolean(inlineComments && inlineComments.length > 0)
  );
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [floatingButtonPos, setFloatingButtonPos] = useState<{ x: number; y: number; showBelow?: boolean } | null>(null);
  const viewerWrapperRef = useRef<HTMLDivElement | null>(null);

  // Synchronize sidebar if comments change
  useEffect(() => {
    if (inlineComments && inlineComments.length > 0) {
      setShowCommentsSidebar(true);
    }
  }, [inlineComments.length]);

  // Update selection coordinates and text
  const updateSelectionState = useCallback(() => {
    if (!enableInlineComments) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      return;
    }

    const rawText = sel.toString().trim();
    if (rawText.length >= 2) {
      setSelectedText(rawText);
      try {
        const range = sel.getRangeAt(0);
        let rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && range.getClientRects().length > 0) {
          rect = range.getClientRects()[0];
        }
        if (rect && (rect.width > 0 || rect.height > 0)) {
          const centerX = rect.left + rect.width / 2;
          const showBelow = rect.top < 110;
          const targetY = showBelow ? rect.bottom + 8 : rect.top - 8;
          setFloatingButtonPos({
            x: Math.max(120, Math.min(window.innerWidth - 120, centerX)),
            y: targetY,
            showBelow,
          });
        }
      } catch {
        // Fallback
      }
    }
  }, [enableInlineComments]);

  const handleContainerMouseUp = () => {
    setTimeout(updateSelectionState, 20);
  };

  // Global mouseup / mousedown listeners so selection button works smoothly and reliably every time
  useEffect(() => {
    if (!enableInlineComments) return;
    const handleDocMouseUp = () => {
      setTimeout(updateSelectionState, 20);
    };
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('.comment-floating-btn') ||
        target?.closest('.comment-modal-dialog') ||
        target?.closest('#btn-comment-selection-top')
      ) {
        return;
      }
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setFloatingButtonPos(null);
          setSelectedText('');
        }
      }, 50);
    };

    document.addEventListener('mouseup', handleDocMouseUp);
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleDocMouseUp);
      document.removeEventListener('mousedown', handleDocMouseDown);
    };
  }, [enableInlineComments, updateSelectionState]);

  // Keyboard shortcut listener: Pressing 'C' when text is selected immediately opens comment modal
  useEffect(() => {
    if (!enableInlineComments) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'c' || e.key === 'C') &&
        !showCommentModal &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        const sel = window.getSelection();
        const rawText = sel?.toString().trim();
        if (rawText && rawText.length >= 2) {
          e.preventDefault();
          updateSelectionState();
          setShowCommentModal(true);
        }
      } else if (e.key === 'Escape') {
        setShowCommentModal(false);
        setFloatingButtonPos(null);
        setSelectedText('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableInlineComments, showCommentModal, updateSelectionState]);

  const handleSaveComment = () => {
    if (!commentInput.trim() || !selectedText) return;
    if (onAddInlineComment) {
      onAddInlineComment({
        selectedText: selectedText.trim(),
        comment: commentInput.trim(),
        createdById: currentUser?.id || 'reviewer-1',
        createdByName: currentUser?.name || 'Authorized Reviewer',
        createdByTitle: currentUser?.title || 'Approver',
      });
    }
    setCommentInput('');
    setShowCommentModal(false);
    setFloatingButtonPos(null);
    setSelectedText('');
    setShowCommentsSidebar(true);
    window.getSelection()?.removeAllRanges();
  };

  // Helper to escape HTML entities
  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Helper to highlight ONLY the exact selected text in the DOM
  const highlightSingleComment = useCallback(
    (container: HTMLElement, comment: InlineRevisionComment, idx: number) => {
      if (!comment.selectedText) return;
      const cleanTarget = comment.selectedText.trim();
      if (cleanTarget.length < 2) return;

      // Don't duplicate if already highlighted with marks
      if (container.querySelector(`mark[data-comment-id="${comment.id}"]`)) return;

      // Exclude non-content nodes
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (
            parent.closest('.comment-table-badge-bar') ||
            parent.closest('.comment-number-badge') ||
            parent.closest('.amaavigo-document-header') ||
            parent.closest('.amaavigo-document-footer') ||
            parent.classList.contains('docx-revision-highlight')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      interface TextNodeSpan {
        node: Text;
        start: number;
        end: number;
        length: number;
      }

      let fullText = '';
      const spans: TextNodeSpan[] = [];
      let currentNode: Node | null;

      while ((currentNode = walker.nextNode())) {
        const text = currentNode.nodeValue || '';
        if (text.length > 0) {
          const start = fullText.length;
          fullText += text;
          spans.push({
            node: currentNode as Text,
            start,
            end: fullText.length,
            length: text.length,
          });
        }
      }

      if (spans.length === 0) return;

      // Build normalized string with index mapping
      const normToOrig: number[] = [];
      let normFullText = '';
      for (let i = 0; i < fullText.length; i++) {
        const ch = fullText[i];
        if (/\s/.test(ch)) {
          if (normFullText.length === 0 || normFullText[normFullText.length - 1] !== ' ') {
            normToOrig.push(i);
            normFullText += ' ';
          }
        } else {
          normToOrig.push(i);
          normFullText += ch.toLowerCase();
        }
      }

      const rawCleanTarget = cleanTarget.replace(/(\.\.\.|…)+$/, '').trim();
      const normTarget = rawCleanTarget.replace(/\s+/g, ' ').toLowerCase();

      let matchIdx = normFullText.indexOf(normTarget);
      let matchLength = normTarget.length;

      // Prefix match if target text is long or truncated
      if (matchIdx === -1 && normTarget.length > 25) {
        const prefix = normTarget.substring(0, Math.min(30, normTarget.length)).trim();
        matchIdx = normFullText.indexOf(prefix);
        if (matchIdx !== -1) {
          matchLength = prefix.length;
        }
      }

      // Sentence / first line match if target contains multiple lines
      if (matchIdx === -1) {
        const firstLine = normTarget.split(/\r?\n|;/)[0].trim();
        if (firstLine.length >= 8) {
          matchIdx = normFullText.indexOf(firstLine);
          if (matchIdx !== -1) {
            matchLength = firstLine.length;
          }
        }
      }

      if (matchIdx === -1) {
        // Table fallback: if comment was placed on a table (Comment #2 scenario)
        const tables = Array.from(container.querySelectorAll('table')) as HTMLTableElement[];
        for (const tbl of tables) {
          if (tbl.classList.contains('amaavigo-document-header') || tbl.classList.contains('amaavigo-document-footer')) continue;
          const tblText = (tbl.textContent || '').replace(/\s+/g, ' ').toLowerCase();
          const prefix = normTarget.substring(0, Math.min(30, normTarget.length)).trim();
          if (tblText.includes(normTarget) || (prefix.length >= 8 && tblText.includes(prefix))) {
            tbl.setAttribute('data-comment-id', comment.id);
            tbl.setAttribute('id', `highlight-${comment.id}`);
            tbl.classList.add('docx-revision-highlight-table');

            if (!container.querySelector(`.badge-banner-comment-${comment.id}`)) {
              const banner = document.createElement('div');
              banner.className = `badge-banner-comment-${comment.id} comment-table-badge-bar flex items-center justify-between bg-orange-50/95 border border-[#FA7014] rounded-lg px-2.5 py-1 mb-1.5 shadow-xs cursor-pointer select-none transition-transform hover:scale-[1.005]`;
              banner.setAttribute('data-comment-id', comment.id);
              banner.setAttribute('id', `highlight-banner-${comment.id}`);
              const safeComment = escapeHtml(comment.comment);
              banner.innerHTML = `
                <div class="flex items-center space-x-2">
                  <span class="comment-number-badge !ml-0">#${idx + 1}</span>
                  <span class="text-xs font-bold text-slate-800">Table Revision Comment:</span>
                  <span class="text-[11px] text-slate-600 font-medium italic truncate max-w-sm">"${safeComment}"</span>
                </div>
                <span class="text-[10px] font-bold text-[#FA7014] bg-white border border-orange-200 px-2 py-0.5 rounded shadow-2xs hover:bg-orange-100 flex items-center gap-1">
                  <span>Jump &rarr;</span>
                </span>
              `;
              banner.onclick = (e) => {
                e.stopPropagation();
                handleJumpToComment(comment);
              };
              tbl.parentElement?.insertBefore(banner, tbl);
            }
            return;
          }
        }
        return;
      }

      const origStart = normToOrig[matchIdx];
      const origEnd = normToOrig[Math.min(matchIdx + matchLength - 1, normToOrig.length - 1)] + 1;

      // Find affected spans
      const affected = spans.filter((s) => s.end > origStart && s.start < origEnd);
      if (affected.length === 0) return;

      const createdMarks: HTMLElement[] = [];

      // Process in reverse to avoid invalidating text offsets
      for (let i = affected.length - 1; i >= 0; i--) {
        const s = affected[i];
        const nodeStartInOrig = Math.max(0, origStart - s.start);
        const nodeEndInOrig = Math.min(s.length, origEnd - s.start);

        if (nodeEndInOrig <= nodeStartInOrig) continue;

        try {
          let textNode = s.node;
          if (nodeEndInOrig < s.length) {
            textNode.splitText(nodeEndInOrig);
          }
          if (nodeStartInOrig > 0) {
            textNode = textNode.splitText(nodeStartInOrig);
          }

          const mark = document.createElement('mark');
          mark.className =
            'docx-revision-highlight bg-amber-200/95 hover:bg-amber-300 text-slate-900 border-b-2 border-[#FA7014] px-0.5 rounded cursor-pointer transition-colors shadow-2xs inline-flex items-center flex-wrap gap-0.5';
          mark.setAttribute('data-comment-id', comment.id);
          mark.setAttribute('id', `highlight-${comment.id}`);
          mark.setAttribute('title', `Comment #${idx + 1}: ${comment.comment}`);

          textNode.parentNode?.replaceChild(mark, textNode);
          mark.appendChild(textNode);
          createdMarks.unshift(mark);

          mark.onclick = (e) => {
            e.stopPropagation();
            handleJumpToComment(comment);
          };
        } catch {
          // Continue
        }
      }

      // Attach comment number badge to the first mark
      if (createdMarks.length > 0 && !container.querySelector(`.badge-comment-${comment.id}`)) {
        const firstMark = createdMarks[0];
        const badge = document.createElement('span');
        badge.className = `badge-comment-${comment.id} comment-number-badge`;
        badge.textContent = `#${idx + 1}`;
        firstMark.appendChild(badge);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleJumpToComment = useCallback(
    (comment: InlineRevisionComment) => {
      setSelectedCommentId(comment.id);
      setShowCommentsSidebar(true);

      if (isDocx && viewMode !== 'docx') {
        setViewMode('docx');
      }

      const performJump = () => {
        // Clear browser window selection so the whole document is never selected
        window.getSelection()?.removeAllRanges();

        const searchContainer =
          (viewMode === 'docx' ? docxContainerRef.current : viewerWrapperRef.current) ||
          docxContainerRef.current ||
          viewerWrapperRef.current;
        if (!searchContainer) return;

        // Find elements for this comment
        let marks = Array.from(
          searchContainer.querySelectorAll(`mark[data-comment-id="${comment.id}"]`)
        ) as HTMLElement[];

        // If not found, attempt on-the-fly highlighting
        if (marks.length === 0) {
          const commentIdx = (inlineComments || []).findIndex((c) => c.id === comment.id);
          highlightSingleComment(searchContainer, comment, commentIdx >= 0 ? commentIdx : 0);
          marks = Array.from(
            searchContainer.querySelectorAll(`mark[data-comment-id="${comment.id}"]`)
          ) as HTMLElement[];
        }

        // If still no mark, check for table banner or highlighted table
        let targetElements: HTMLElement[] = marks;
        if (targetElements.length === 0) {
          const banner = searchContainer.querySelector(
            `#highlight-banner-${comment.id}`
          ) as HTMLElement | null;
          if (banner) {
            targetElements = [banner];
          } else {
            const tbl = searchContainer.querySelector(
              `table[data-comment-id="${comment.id}"]`
            ) as HTMLElement | null;
            if (tbl) targetElements = [tbl];
          }
        }

        // STRICT GUARD: Only ever pulse and scroll mark tags or table banners, NEVER container elements!
        targetElements = targetElements.filter((el) => {
          if (!el || el === searchContainer || el === docxContainerRef.current || el === viewerWrapperRef.current) return false;
          if (el.classList.contains('docx-preview-container') || el.classList.contains('docx-preview-doc')) return false;
          const tag = el.tagName.toLowerCase();
          return (
            tag === 'mark' ||
            tag === 'span' ||
            el.classList.contains('comment-table-badge-bar') ||
            tag === 'table'
          );
        });

        if (targetElements.length > 0) {
          const firstTarget = targetElements[0];

          // 1. Scroll into view
          try {
            firstTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
          } catch {
            // Handled below
          }

          // 2. Adjust wrapper scroll
          const wrapper = viewerWrapperRef.current;
          if (wrapper) {
            const wrapperRect = wrapper.getBoundingClientRect();
            const targetRect = firstTarget.getBoundingClientRect();
            const relativeTop = targetRect.top - wrapperRect.top + wrapper.scrollTop;
            const targetScrollTop = relativeTop - wrapper.clientHeight / 2 + targetRect.height / 2;
            wrapper.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: 'smooth',
            });
          }

          // 3. Highlight and scroll the corresponding card in the sidebar
          const cardEl = document.getElementById(`comment-card-${comment.id}`);
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }

          // 4. Pulse animation on ONLY the marked selection
          targetElements.forEach((el) => {
            el.classList.remove('jump-highlight-pulse');
            void el.offsetWidth;
            el.classList.add('jump-highlight-pulse');
            setTimeout(() => {
              el.classList.remove('jump-highlight-pulse');
            }, 2500);
          });
        }
      };

      if (isDocx && viewMode !== 'docx') {
        setTimeout(performJump, 300);
      } else {
        performJump();
      }
    },
    [isDocx, viewMode, inlineComments, highlightSingleComment]
  );

  useEffect(() => {
    if (!inlineComments || inlineComments.length === 0) return;
    const container =
      (viewMode === 'docx' ? docxContainerRef.current : viewerWrapperRef.current) ||
      docxContainerRef.current ||
      viewerWrapperRef.current;
    if (!container) return;

    const runHighlightAll = () => {
      try {
        inlineComments.forEach((c, idx) => {
          highlightSingleComment(container, c, idx);
        });
      } catch (err) {
        console.warn('Comment highlight err:', err);
      }
    };

    const t1 = setTimeout(runHighlightAll, 200);
    const t2 = setTimeout(runHighlightAll, 600);
    const t3 = setTimeout(runHighlightAll, 1400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [inlineComments, viewMode, stampedDocxBlob, loadingDocx, highlightSingleComment]);


  useEffect(() => {
    let isMounted = true;
    if (isVideo || (fileName && fileName.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/))) {
      resolvePlayableMediaUrl(effectiveFileUrl, versionId, documentId, fileName).then((url) => {
        if (isMounted && url) {
          setActiveVideoUrl(url);
        }
      });
    } else if (effectiveFileUrl) {
      setActiveVideoUrl(effectiveFileUrl);
    }
    return () => {
      isMounted = false;
    };
  }, [effectiveFileUrl, versionId, documentId, fileName, isVideo]);

  // Keep viewMode synchronized with document type if props change
  useEffect(() => {
    if (isVideo) {
      setViewMode('video');
    } else if (isPdf) {
      setViewMode('pdf');
    } else if (isDocx) {
      setViewMode('docx');
    } else {
      setViewMode('formatted');
    }
  }, [isVideo, isPdf, isDocx]);

  const effectiveHeaderFooterData = React.useMemo(() => {
    if (headerFooterData) return headerFooterData;
    return extractHeaderFooterData(rawContent);
  }, [headerFooterData, rawContent]);

  // Prepare stamped DOCX for high-fidelity interactive preview
  // Preserves 100% of original fonts, sizes, colors, and layout while displaying the official header & footer.
  // Resilient across multiple tabs, incognito sessions, and new browser windows via automatic on-the-fly DOCX synthesis.
  useEffect(() => {
    let isMounted = true;
    if (isDocx) {
      const source = effectiveFileUrl || null;
      setLoadingDocx(true);
      setDocxError(null);

      (async () => {
        try {
          let docxBlobToRender: Blob | null = null;

          // 1. First Tier: Attempt to resolve original binary DOCX bytes from source dataUrl / network URL / local IndexedDB
          if (source) {
            try {
              const extraIds = [versionId, documentId, fileName].filter(Boolean) as string[];
              const bytes = await resolveDocumentBytes(source, extraIds);
              if (bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
                if (effectiveHeaderFooterData) {
                  const stamped = await stampDocxWithHeaderFooter(bytes, {
                    documentTitle: effectiveHeaderFooterData.documentTitle || fileName.replace(/\.[^/.]+$/, ''),
                    versionNumber: effectiveHeaderFooterData.versionNumber || '1.0',
                    effectiveDate: effectiveHeaderFooterData.effectiveDate || new Date().toISOString(),
                    reReviewDate: effectiveHeaderFooterData.reReviewDate,
                    creationDate: effectiveHeaderFooterData.creationDate,
                    createdByName: effectiveHeaderFooterData.createdByName,
                    approvedByName: effectiveHeaderFooterData.approvedByName,
                    approvedDate: effectiveHeaderFooterData.approvedDate,
                    companyName: effectiveHeaderFooterData.companyName,
                  });
                  docxBlobToRender = stamped.blob;
                } else {
                  docxBlobToRender = new Blob([bytes], {
                    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  });
                }
              }
            } catch (resolveErr) {
              console.warn('[DocumentViewer] Binary DOCX resolve notice, switching to corporate docx generator:', resolveErr);
            }
          }

          // 2. Second Tier (Resilient Cross-Tab Fallback): If source binary was not accessible in this tab,
          // dynamically synthesize the pristine corporate DOCX document on-the-fly directly from rawContent!
          if (!docxBlobToRender && rawContent && rawContent.trim()) {
            try {
              docxBlobToRender = await generateCorporateDocxBlob({
                documentTitle: effectiveHeaderFooterData?.documentTitle || fileName.replace(/\.[^/.]+$/, ''),
                versionNumber: effectiveHeaderFooterData?.versionNumber || '1.0',
                effectiveDate: effectiveHeaderFooterData?.effectiveDate || new Date().toISOString(),
                reReviewDate: effectiveHeaderFooterData?.reReviewDate,
                creationDate: effectiveHeaderFooterData?.creationDate,
                createdByName: effectiveHeaderFooterData?.createdByName,
                approvedByName: effectiveHeaderFooterData?.approvedByName,
                approvedDate: effectiveHeaderFooterData?.approvedDate,
                companyName: effectiveHeaderFooterData?.companyName || 'Amaavigo',
                rawContent,
              });
            } catch (genErr) {
              console.warn('[DocumentViewer] Corporate DOCX synthesis error:', genErr);
            }
          }

          if (!isMounted) return;

          if (docxBlobToRender) {
            setStampedDocxBlob(docxBlobToRender);
            setLoadingDocx(false);
          } else {
            setLoadingDocx(false);
            setDocxError('Word document preview could not render.');
            setViewMode('formatted');
          }
        } catch (err: any) {
          console.warn('Could not prepare stamped DOCX preview:', err);
          if (isMounted) {
            setDocxError('Interactive Word preview could not render.');
            setLoadingDocx(false);
            setViewMode('formatted');
          }
        }
      })();
    }
    return () => {
      isMounted = false;
    };
  }, [isDocx, effectiveFileUrl, effectiveHeaderFooterData, fileName, rawContent, versionId, documentId]);

  // Calculate scale so the entire Word (DOCX) page width fits within the container without clipping
  const handleFitDocxWidth = useCallback(() => {
    const parent = docxOuterWrapperRef.current || docxContainerRef.current;
    if (!parent) return;
    const parentW = parent.clientWidth || 800;
    // Standard Word page rendered by docx-preview is ~816px wide (US Letter 8.5in or A4 210mm)
    let pageW = 816;
    if (docxContainerRef.current) {
      const sectionEl = docxContainerRef.current.querySelector('section.docx') as HTMLElement | null;
      if (sectionEl && sectionEl.offsetWidth > 0) {
        pageW = sectionEl.offsetWidth;
      }
    }
    const availableW = Math.max(280, parentW - 24);
    const computedScale = Math.min(1.15, Math.max(0.4, Number((availableW / pageW).toFixed(2))));
    setDocxScale(computedScale);
    setIsFitDocxWidth(true);
  }, []);

  // Window resize observer to preserve fit when in fit-width mode
  useEffect(() => {
    if (viewMode !== 'docx' || !isFitDocxWidth) return;
    const onResize = () => {
      handleFitDocxWidth();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewMode, isFitDocxWidth, handleFitDocxWidth]);

  // Render Word document via docx-preview into container
  useEffect(() => {
    let isCurrent = true;
    if (viewMode === 'docx' && stampedDocxBlob && docxContainerRef.current) {
      const container = docxContainerRef.current;
      container.innerHTML = '';
      setLoadingDocx(true);
      renderAsync(stampedDocxBlob, container, undefined, {
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        className: 'docx-preview-doc',
      })
        .then(() => {
          if (isCurrent) {
            setLoadingDocx(false);
            // Automatically fit docx to available container width so the entire document is visible without clipping
            requestAnimationFrame(() => {
              handleFitDocxWidth();
            });
          }
        })
        .catch((err) => {
          console.warn('docx-preview render warning:', err);
          if (isCurrent) {
            setLoadingDocx(false);
            setDocxError('Interactive Word preview encountered an issue. Switch to Formatted View to read content.');
          }
        });
    }
    return () => {
      isCurrent = false;
    };
  }, [viewMode, stampedDocxBlob, handleFitDocxWidth]);

  // Stamp PDF with official corporate header & footer while keeping original document 100% intact
  useEffect(() => {
    let isMounted = true;
    if (isPdf && effectiveHeaderFooterData) {
      const source = effectiveFileUrl || (isRawPdfStream(rawContent) ? rawContent : null);

      if (source) {
        stampPdfWithHeaderFooter(source, {
          documentTitle: effectiveHeaderFooterData.documentTitle || fileName.replace(/\.[^/.]+$/, ''),
          versionNumber: effectiveHeaderFooterData.versionNumber || '1.0',
          effectiveDate: effectiveHeaderFooterData.effectiveDate || new Date().toISOString(),
          reReviewDate: effectiveHeaderFooterData.reReviewDate,
          creationDate: effectiveHeaderFooterData.creationDate,
          createdByName: effectiveHeaderFooterData.createdByName,
          approvedByName: effectiveHeaderFooterData.approvedByName,
          approvedDate: effectiveHeaderFooterData.approvedDate,
          companyName: effectiveHeaderFooterData.companyName,
        }, { forceRestamp: true })
          .then((res) => {
            if (isMounted) setStampedPdfUrl(res.dataUrl);
          })
          .catch((err) => {
            console.warn('PDF intact stamping preview warning:', err);
          });
      }
    }
    return () => {
      isMounted = false;
    };
  }, [isPdf, effectiveFileUrl, rawContent, effectiveHeaderFooterData, fileName]);

  // Convert raw PDF string to Base64 or Blob Data URL if needed
  const effectivePdfDataUrl = React.useMemo(() => {
    if (stampedPdfUrl) {
      return stampedPdfUrl;
    }
    if (effectiveFileUrl && (effectiveFileUrl.startsWith('data:application/pdf') || effectiveFileUrl.startsWith('blob:') || effectiveFileUrl.startsWith('/') || effectiveFileUrl.startsWith('http'))) {
      return effectiveFileUrl;
    }
    if (isRawPdfStream(rawContent)) {
      try {
        // Convert binary string to uint8 array
        const len = rawContent.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = rawContent.charCodeAt(i) & 0xff;
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        return URL.createObjectURL(blob);
      } catch (e) {
        console.warn('Failed to convert raw PDF bytes to blob:', e);
      }
    }

    // Synthesize valid corporate PDF ONLY if no uploaded file exists and rawContent is pure markdown text
    if (!effectiveFileUrl && isPdf && rawContent && !rawContent.startsWith('%PDF')) {
      try {
        const blob = generateCorporatePdfBlob({
          documentTitle: effectiveHeaderFooterData?.documentTitle || fileName.replace(/\.[^/.]+$/, ''),
          versionNumber: effectiveHeaderFooterData?.versionNumber || '1.0',
          effectiveDate: effectiveHeaderFooterData?.effectiveDate || new Date().toISOString(),
          createdByName: effectiveHeaderFooterData?.createdByName,
          approvedByName: effectiveHeaderFooterData?.approvedByName,
          approvedDate: effectiveHeaderFooterData?.approvedDate,
          companyName: effectiveHeaderFooterData?.companyName || 'Amaavigo',
          rawContent,
          fileName,
        });
        return URL.createObjectURL(blob);
      } catch (e) {
        console.warn('Failed to generate corporate PDF preview blob:', e);
      }
    }

    return '';
  }, [stampedPdfUrl, effectiveFileUrl, rawContent, isPdf, effectiveHeaderFooterData, fileName]);

  // Load PDF Document with PDF.js
  useEffect(() => {
    if (!isPdf) return;

    let isMounted = true;
    setLoadingPdf(true);
    setPdfError(null);

    async function loadPdf() {
      try {
        const pdfjsLib = await getBrowserPdfjs();
        if (!pdfjsLib) {
          setViewMode('formatted');
          setLoadingPdf(false);
          return;
        }

        let loadingTask;
        if (effectivePdfDataUrl) {
          loadingTask = pdfjsLib.getDocument({ url: effectivePdfDataUrl });
        } else if (isRawPdfStream(rawContent)) {
          const len = rawContent.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = rawContent.charCodeAt(i) & 0xff;
          }
          loadingTask = pdfjsLib.getDocument({ data: bytes });
        } else {
          setViewMode('formatted');
          setLoadingPdf(false);
          return;
        }

        const doc = await loadingTask.promise;
        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setPageNumber(1);
          setLoadingPdf(false);
        }
      } catch (err: any) {
        console.warn('PDF.js rendering fallback triggered:', err);
        if (isMounted) {
          setPdfError('PDF preview rendered via formatted document stream.');
          setLoadingPdf(false);
          setViewMode('formatted');
        }
      }
    }

    loadPdf();

    return () => {
      isMounted = false;
    };
  }, [effectivePdfDataUrl, isPdf, rawContent]);

  // Render current PDF page to canvas
  useEffect(() => {
    if (!pdfDoc || viewMode !== 'pdf' || !canvasRef.current) return;

    let isCurrent = true;

    async function renderPage() {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page = await pdfDoc.getPage(pageNumber);
        if (!isCurrent || !canvasRef.current) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.warn('Page render error:', err);
        }
      }
    }

    renderPage();

    return () => {
      isCurrent = false;
    };
  }, [pdfDoc, pageNumber, scale, viewMode]);

  // Clean formatted text for non-PDF or formatted tab
  const readableFormattedText = React.useMemo(() => {
    if (isRawPdfStream(rawContent)) {
      const extracted = extractTextFromRawPdfStream(rawContent);
      if (extracted) return extracted;
      return `# ${fileName.replace(/\.[^/.]+$/, '')}\n\n*Binary PDF Document (${fileName})*\n\nPlease use the **Interactive PDF Viewer** tab above to view the high-fidelity multi-page document canvas or download the original file.`;
    }
    return rawContent;
  }, [rawContent, fileName]);

  const cleanBodyForFormatted = React.useMemo(() => {
    return extractCleanBody(readableFormattedText);
  }, [readableFormattedText]);

  return (
    <div className={`flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm ${className}`}>
      {/* TOOLBAR */}
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        {/* VIEW MODE SELECTOR */}
        <div className="flex items-center space-x-1.5 bg-white p-1 rounded-xl border border-slate-200">
          {isVideo && (
            <button
              type="button"
              onClick={() => setViewMode('video')}
              className={`px-3 py-1.5 text-xs rounded-lg font-bold flex items-center space-x-1.5 transition-all ${
                viewMode === 'video'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Video className="w-3.5 h-3.5 text-[#FA7014]" />
              <span>Video Player</span>
            </button>
          )}

          {isDocx && (
            <button
              type="button"
              onClick={() => setViewMode('docx')}
              className={`px-3 py-1.5 text-xs rounded-lg font-bold flex items-center space-x-1.5 transition-all ${
                viewMode === 'docx'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-[#FA7014]" />
              <span>Word Document (DOCX)</span>
            </button>
          )}

          {isPdf && (
            <button
              type="button"
              onClick={() => setViewMode('pdf')}
              className={`px-3 py-1.5 text-xs rounded-lg font-bold flex items-center space-x-1.5 transition-all ${
                viewMode === 'pdf'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-[#FA7014]" />
              <span>Interactive PDF</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setViewMode('formatted')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold flex items-center space-x-1.5 transition-all ${
              viewMode === 'formatted'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-[#FA7014]" />
            <span>Readable Document</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('raw')}
            className={`px-3 py-1.5 text-xs rounded-lg font-bold flex items-center space-x-1.5 transition-all ${
              viewMode === 'raw'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-[#FA7014]" />
            <span>Raw Text</span>
          </button>
        </div>

        {/* VIDEO ASSET BADGE */}
        {viewMode === 'video' && (
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#FA7014]/10 text-[#FA7014] font-semibold">
              <Video className="w-3.5 h-3.5" />
              <span>Video Master Asset</span>
            </span>
            <span className="hidden sm:inline text-[11px] text-slate-400">Header & footer skipped</span>
          </div>
        )}

        {/* PDF PAGE & ZOOM CONTROLS */}
        {viewMode === 'pdf' && numPages > 0 && (
          <div className="flex items-center space-x-3 text-xs text-slate-700">
            {/* Page Navigation */}
            <div className="flex items-center space-x-1 bg-white px-2 py-1 rounded-xl border border-slate-200">
              <button
                type="button"
                disabled={pageNumber <= 1}
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono text-xs px-1.5">
                Page <strong className="text-slate-900">{pageNumber}</strong> of {numPages}
              </span>
              <button
                type="button"
                disabled={pageNumber >= numPages}
                onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center space-x-1 bg-white px-2 py-1 rounded-xl border border-slate-200">
              <button
                type="button"
                disabled={scale <= 0.6}
                onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.2).toFixed(1))))}
                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs px-1 text-slate-500">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                disabled={scale >= 2.5}
                onClick={() => setScale((s) => Math.min(2.5, Number((s + 0.2).toFixed(1))))}
                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* WORD (DOCX) ZOOM & FIT CONTROLS */}
        {viewMode === 'docx' && !loadingDocx && !docxError && (
          <div className="flex items-center space-x-2 text-xs text-slate-700">
            {/* Zoom Controls */}
            <div className="flex items-center space-x-1 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs">
              <button
                type="button"
                disabled={docxScale <= 0.5}
                onClick={() => {
                  setDocxScale((s) => Math.max(0.5, Number((s - 0.1).toFixed(2))));
                  setIsFitDocxWidth(false);
                }}
                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs px-1.5 text-slate-700 min-w-[42px] text-center font-bold">
                {Math.round(docxScale * 100)}%
              </span>
              <button
                type="button"
                disabled={docxScale >= 2.0}
                onClick={() => {
                  setDocxScale((s) => Math.min(2.0, Number((s + 0.1).toFixed(2))));
                  setIsFitDocxWidth(false);
                }}
                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Fit Controls */}
            <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={handleFitDocxWidth}
                className={`px-2.5 py-1 text-[11px] rounded-lg font-bold transition-all cursor-pointer ${
                  isFitDocxWidth
                    ? 'bg-[#FA7014] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Fit full Word document page to container width"
              >
                Fit Width
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocxScale(1.0);
                  setIsFitDocxWidth(false);
                }}
                className={`px-2.5 py-1 text-[11px] rounded-lg font-bold transition-all cursor-pointer ${
                  docxScale === 1.0 && !isFitDocxWidth
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="100% Actual Print Size"
              >
                100%
              </button>
            </div>
          </div>
        )}

        {/* REVISION COMMENTS ACTION BUTTONS */}
        <div className="flex items-center space-x-2">
          {enableInlineComments && (
            <button
              type="button"
              disabled={!selectedText}
              onClick={() => {
                if (selectedText) setShowCommentModal(true);
              }}
              className={`px-3 py-1.5 text-xs rounded-xl font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer ${
                selectedText
                  ? 'bg-[#FA7014] text-white hover:bg-[#E65A05] ring-2 ring-[#FA7014]/30 animate-pulse'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
              }`}
              title={selectedText ? `Comment on selected text: "${selectedText.slice(0, 30)}..."` : 'Select text in the document with your mouse to comment'}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>{selectedText ? 'Comment on Selection' : 'Select text to comment'}</span>
            </button>
          )}

          {(enableInlineComments || inlineComments.length > 0) && (
            <button
              type="button"
              onClick={() => setShowCommentsSidebar((prev) => !prev)}
              className={`px-3 py-1.5 text-xs rounded-xl font-bold flex items-center space-x-1.5 transition-all border ${
                showCommentsSidebar
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-700 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#FA7014]" />
              <span>Revision Comments</span>
              {inlineComments.length > 0 && (
                <span className="bg-[#FA7014] text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-0.5">
                  {inlineComments.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* VIEWER BODY */}
      <div
        ref={viewerWrapperRef}
        onMouseUp={handleContainerMouseUp}
        className="relative flex-1 bg-slate-100/70 p-4 overflow-y-auto max-h-[65vh] min-h-[320px] flex flex-col lg:flex-row gap-4 items-start justify-center"
      >
        {/* FLOATING ACTION PILL NEAR SELECTION */}
        {floatingButtonPos && enableInlineComments && selectedText && !showCommentModal && (
          <div
            style={{
              position: 'fixed',
              left: `${floatingButtonPos.x}px`,
              top: `${floatingButtonPos.y}px`,
              transform: floatingButtonPos.showBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              zIndex: 9999,
            }}
            className="comment-floating-btn pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150"
          >
            <button
              type="button"
              onClick={() => {
                setShowCommentModal(true);
              }}
              className="flex items-center space-x-2 bg-gradient-to-r from-[#FA7014] to-[#E65A05] hover:from-[#E65A05] hover:to-[#D44E00] text-white px-3.5 py-1.5 rounded-full shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all text-xs font-bold ring-2 ring-white cursor-pointer"
              title="Add Revision Comment on selected text (or press 'C')"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Add Comment</span>
              <span className="bg-black/25 text-[10px] font-mono px-1 py-0.2 rounded ml-0.5">C</span>
            </button>
          </div>
        )}

        {/* MAIN DOCUMENT VIEWING COLUMN */}
        <div className="flex-1 w-full flex justify-center items-start min-w-0">
        {/* 0. INTERACTIVE VIDEO PLAYER */}
        {viewMode === 'video' && (
          <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto py-2">
            <div className="w-full bg-slate-950 rounded-2xl overflow-hidden shadow-lg border border-slate-800 flex flex-col items-center">
              {activeVideoUrl || fileUrl ? (
                <video
                  controls
                  playsInline
                  preload="auto"
                  crossOrigin="anonymous"
                  className="w-full max-h-[55vh] bg-black rounded-t-2xl object-contain"
                  src={activeVideoUrl || fileUrl}
                  onError={async () => {
                    console.warn('[Video Player] Direct stream failed, attempting IndexedDB / fallback resolution...');
                    const resolved = await resolvePlayableMediaUrl(fileUrl, versionId, documentId, fileName);
                    if (resolved && resolved !== activeVideoUrl) {
                      setActiveVideoUrl(resolved);
                    }
                  }}
                >
                  Your browser does not support HTML5 video playback.
                </video>
              ) : (
                <div className="py-20 text-center text-slate-400">
                  <Video className="w-12 h-12 mx-auto text-slate-500 mb-2 opacity-50" />
                  <p className="text-sm font-medium">Video file preview not available</p>
                </div>
              )}
              <div className="w-full px-5 py-3.5 bg-slate-900 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 text-xs text-slate-300">
                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FA7014]/20 text-[#FA7014] border border-[#FA7014]/30">
                    VIDEO ASSET
                  </span>
                  <span className="font-mono text-slate-200 truncate max-w-xs">{fileName}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Media Intact</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      downloadDocumentWithIntactFormat({
                        fileName,
                        rawContent,
                        fileUrl: activeVideoUrl || fileUrl,
                        versionId,
                        documentId,
                        documentTitle: effectiveHeaderFooterData?.documentTitle || fileName,
                        versionNumber: effectiveHeaderFooterData?.versionNumber || '1.0',
                      })
                    }
                    className="inline-flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-700 transition-colors cursor-pointer"
                    title="Download Video"
                  >
                    <Download className="w-3 h-3 text-[#FA7014]" />
                    <span>Download Video</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1. INTERACTIVE WORD (DOCX) DOCUMENT VIEWER */}
        {viewMode === 'docx' && (
          <div ref={docxOuterWrapperRef} className="flex flex-col items-center justify-start w-full overflow-x-auto min-h-[400px]">
            {loadingDocx && (
              <div className="py-16 text-center text-slate-500">
                <div className="w-8 h-8 border-2 border-[#FA7014] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs">Rendering Word Document with intact fonts, styles, and header/footer...</p>
              </div>
            )}

            {!loadingDocx && !stampedDocxBlob && !docxError && (
              <div className="py-16 text-center text-slate-500">
                <div className="w-8 h-8 border-2 border-[#FA7014] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs">Preparing Word Document preview...</p>
              </div>
            )}

            {docxError && !loadingDocx && (
              <div className="text-center py-10 text-slate-500 max-w-md">
                <AlertCircle className="w-8 h-8 mx-auto text-[#FA7014] mb-2" />
                <p className="text-xs font-semibold text-slate-900 mb-1">Interactive Word Document Preview</p>
                <p className="text-xs text-slate-500 mb-4">{docxError}</p>
                <button
                  onClick={() => setViewMode('formatted')}
                  className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-4 py-2 rounded-xl"
                >
                  View Readable Policy Content
                </button>
              </div>
            )}

            <div
              ref={docxContainerRef}
              style={{
                zoom: docxScale,
                transformOrigin: 'top center',
              }}
              className={`docx-preview-container flex flex-col items-center py-4 px-2 bg-transparent w-full transition-transform duration-100 ${
                loadingDocx ? 'hidden' : 'block'
              }`}
            />
          </div>
        )}

        {/* 2. PDF CANVAS VIEWER */}
        {viewMode === 'pdf' && (
          <div className="flex flex-col items-center justify-center w-full">
            {loadingPdf && (
              <div className="py-16 text-center text-slate-500">
                <div className="w-8 h-8 border-2 border-[#FA7014] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs">Rendering PDF Document Canvas...</p>
              </div>
            )}

            {!loadingPdf && pdfDoc && (
              <div className="shadow-lg rounded-xl border border-slate-200 overflow-hidden bg-white max-w-full">
                <canvas ref={canvasRef} className="block mx-auto max-w-full h-auto" />
              </div>
            )}

            {!loadingPdf && !pdfDoc && (
              <div className="text-center py-12 text-slate-500 max-w-md">
                <AlertCircle className="w-8 h-8 mx-auto text-[#FA7014] mb-2" />
                <p className="text-xs font-semibold text-slate-900 mb-1">Interactive Canvas Preview Unavailable</p>
                <p className="text-xs text-slate-500 mb-4">
                  Viewing extracted document content below. You can also download the original PDF file.
                </p>
                <button
                  onClick={() => setViewMode('formatted')}
                  className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-4 py-2 rounded-xl"
                >
                  View Extracted Policy Content
                </button>
              </div>
            )}
          </div>
        )}

        {/* 2. FORMATTED DOCUMENT / POLICY VIEW */}
        {viewMode === 'formatted' && (
          <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs text-slate-800">
            <div className="border-b border-slate-200 pb-4 mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#FA7014]">
                  Official Document Content
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">{fileName}</h3>
              </div>
              <div className="flex items-center space-x-2">
                {effectiveHeaderFooterData && (
                  effectiveHeaderFooterData.approvedByName &&
                  effectiveHeaderFooterData.approvedByName !== 'Not yet approved' &&
                  effectiveHeaderFooterData.approvedByName !== 'Pending Review' &&
                  effectiveHeaderFooterData.approvedByName !== 'Pending Approval' &&
                  !effectiveHeaderFooterData.approvedByName.toLowerCase().includes('not yet') &&
                  effectiveHeaderFooterData.approvedDate &&
                  effectiveHeaderFooterData.approvedDate !== 'Not yet approved' &&
                  effectiveHeaderFooterData.approvedDate !== 'Pending Approval' &&
                  !effectiveHeaderFooterData.approvedDate.toLowerCase().includes('not yet') ? (
                    <span className="bg-emerald-50 text-emerald-700 text-xs px-2.5 py-1 rounded-lg border border-emerald-200 font-semibold flex items-center space-x-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Approved & Authorized</span>
                    </span>
                  ) : (
                    <span className="bg-amber-50 text-amber-700 text-xs px-2.5 py-1 rounded-lg border border-amber-200 font-semibold flex items-center space-x-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                      <span>Not Yet Approved</span>
                    </span>
                  )
                )}
                <span className="bg-orange-50 text-[#FA7014] text-xs px-2.5 py-1 rounded-lg border border-orange-200 font-mono font-bold flex items-center space-x-1.5">
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Text Extracted</span>
                </span>
              </div>
            </div>

            {/* DYNAMIC CORPORATE HEADER TABLE (Omitted for Video Files) */}
            {effectiveHeaderFooterData && !isVideo && (
              <div className="mb-6">
                <DocumentHeaderTable data={effectiveHeaderFooterData} />
              </div>
            )}

            {/<[a-z][\s\S]*>/i.test(cleanBodyForFormatted) ? (
              <div
                className="document-html-content text-slate-800 text-sm leading-relaxed py-2"
                dangerouslySetInnerHTML={{ __html: cleanBodyForFormatted }}
              />
            ) : (
              <div className="prose max-w-none text-sm leading-relaxed space-y-4 py-2">
                {cleanBodyForFormatted.split('\n\n').map((para, i) => {
                  const trimmed = para.trim();
                  if (!trimmed) return null;
                  const isMetaPara =
                    /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Policy\s*Owner\s*[:\-–—]?)/i.test(trimmed) ||
                    /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Effective\s*Date\s*[:\-–—]?)/i.test(trimmed) ||
                    /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Review\s*Frequency\s*[:\-–—]?)/i.test(trimmed) ||
                    /^(?:(?:\*{1,2}|#+\s*|[-•|]\s*)?Applies\s*To\s*[:\-–—]?)/i.test(trimmed);
                  if (isMetaPara) return null;
                  if (trimmed.startsWith('# ')) {
                    return (
                      <h1 key={i} className="text-xl font-bold text-slate-900 border-b border-slate-200 pb-2 mt-4">
                        {trimmed.replace(/^# /, '')}
                      </h1>
                    );
                  }
                  if (trimmed.startsWith('## ')) {
                    return (
                      <h2 key={i} className="text-base font-bold text-[#FA7014] mt-4 mb-1">
                        {trimmed.replace(/^## /, '')}
                      </h2>
                    );
                  }
                  if (trimmed.startsWith('### ')) {
                    return (
                      <h3 key={i} className="text-sm font-bold text-slate-800 mt-3">
                        {trimmed.replace(/^### /, '')}
                      </h3>
                    );
                  }
                  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                    return (
                      <ul key={i} className="list-disc list-inside space-y-1 pl-2 text-slate-700">
                        {trimmed.split('\n').map((li, j) => (
                          <li key={j}>{li.replace(/^[-*]\s+/, '')}</li>
                        ))}
                      </ul>
                    );
                  }
                  if (
                    trimmed.startsWith('<table') ||
                    trimmed.startsWith('<div') ||
                    trimmed.startsWith('<p') ||
                    trimmed.startsWith('<blockquote') ||
                    trimmed.startsWith('<h1') ||
                    trimmed.startsWith('<h2') ||
                    trimmed.startsWith('<h3')
                  ) {
                    return (
                      <div
                        key={i}
                        className="text-slate-800 my-2 overflow-x-auto font-sans"
                        dangerouslySetInnerHTML={{ __html: trimmed }}
                      />
                    );
                  }
                  return (
                    <p
                      key={i}
                      className="text-slate-700 whitespace-pre-wrap leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: trimmed }}
                    />
                  );
                })}
              </div>
            )}

            {/* DYNAMIC CORPORATE FOOTER TABLE (Omitted for Video Files) */}
            {effectiveHeaderFooterData && !isVideo && (
              <div className="mt-8 pt-4 border-t border-slate-100">
                <DocumentFooterTable data={effectiveHeaderFooterData} />
              </div>
            )}
          </div>
        )}

        {/* 3. RAW CODE / STREAM VIEW */}
        {viewMode === 'raw' && (
          <div className="w-full">
            <pre className="font-mono text-xs text-slate-800 bg-white border border-slate-200 p-4 rounded-xl whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
              {stripPolicyMetadataHeader(rawContent)}
            </pre>
          </div>
        )}
        </div>

        {/* REVISION COMMENTS SIDEBAR */}
        {showCommentsSidebar && (enableInlineComments || inlineComments.length > 0) && (
          <div className="w-full lg:w-80 shrink-0 bg-white border border-slate-200 rounded-2xl shadow-lg flex flex-col max-h-[62vh] overflow-hidden animate-in fade-in slide-in-from-right-4 duration-150 sticky top-2">
            {/* Comments Sidebar Header */}
            <div className="p-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-4 h-4 text-[#FA7014]" />
                <span className="text-xs font-bold">Revision Comments ({inlineComments.length})</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCommentsSidebar(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                title="Collapse sidebar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {inlineComments.length === 0 ? (
                <div className="text-center py-8 px-3 text-slate-400">
                  <MessageSquare className="w-8 h-8 mx-auto text-slate-300 mb-2 opacity-60" />
                  <p className="text-xs font-medium text-slate-600">No revision comments yet</p>
                  {enableInlineComments ? (
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Select any text in the Word document with your mouse, then click <strong className="text-slate-600">"Add Comment"</strong> to specify changes for HR.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      This document has no active inline revision comments.
                    </p>
                  )}
                </div>
              ) : (
                inlineComments.map((c, idx) => (
                  <div
                    key={c.id || idx}
                    id={`comment-card-${c.id}`}
                    onClick={() => handleJumpToComment(c)}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      selectedCommentId === c.id
                        ? 'border-[#FA7014] bg-orange-50/70 shadow-xs ring-2 ring-[#FA7014]/40'
                        : 'border-slate-200 bg-slate-50/80 hover:border-[#FA7014]/50 hover:bg-orange-50/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-1.5">
                        <span className="comment-number-badge !ml-0">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-slate-900 text-[11px] truncate max-w-[130px]">
                          {c.createdByName || 'Approver'}
                        </span>
                      </div>
                      {enableInlineComments && onDeleteInlineComment && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteInlineComment(c.id);
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                          title="Delete Comment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Quoted Text */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        handleJumpToComment(c);
                      }}
                      className="bg-white border-l-2 border-[#FA7014] p-2 rounded-r-lg mb-2 text-[11px] text-slate-600 font-serif italic line-clamp-3 hover:bg-orange-50/40 transition-colors"
                      title="Click to jump to quoted text"
                    >
                      "{c.selectedText}"
                    </div>

                    {/* Comment Text */}
                    <div className="text-slate-900 font-sans leading-relaxed text-xs font-medium">
                      {c.comment}
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[10px] text-slate-400 flex items-center justify-between">
                      <span>{new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJumpToComment(c);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleJumpToComment(c);
                          }
                        }}
                        className="text-[#FA7014] font-semibold hover:underline cursor-pointer select-none inline-flex items-center space-x-1 group"
                        title="Scroll to referenced text in document"
                      >
                        <span>Jump to text</span>
                        <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        </div>

        {/* STICKY BOTTOM FLOATING COMMENT PROMPT WHEN TEXT IS SELECTED */}
        {enableInlineComments && selectedText && !showCommentModal && (
          <div className="fixed bottom-6 right-6 z-[60] bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex flex-col max-w-xs">
              <span className="text-[10px] font-bold text-[#FA7014] uppercase tracking-wider">Text Selected</span>
              <span className="text-xs font-serif italic truncate text-slate-200">"{selectedText}"</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCommentModal(true);
              }}
              className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-4 py-2 rounded-xl shadow-md flex items-center space-x-1.5 cursor-pointer shrink-0 transition-transform hover:scale-105"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span>Add Comment</span>
            </button>
          </div>
        )}

      {/* COMMENT MODAL DIALOG */}
      {showCommentModal && (
        <div className="comment-modal-dialog fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 text-[#FA7014] flex items-center justify-center">
                  <MessageSquarePlus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Add Revision Comment on Selection</h4>
                  <p className="text-[11px] text-slate-500">Provide instructions for HR on what needs modification</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCommentModal(false);
                  setFloatingButtonPos(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected text quote */}
            <div className="mt-3.5 bg-slate-50 border-l-4 border-l-[#FA7014] border-slate-200 p-3 rounded-r-xl">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1 mb-1">
                <Quote className="w-3 h-3 text-[#FA7014]" />
                <span>Selected Text from Document:</span>
              </span>
              <p className="text-xs text-slate-800 font-serif italic line-clamp-4 leading-relaxed">
                "{selectedText}"
              </p>
            </div>

            {/* Comment Input */}
            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                Requested Modification / Note <span className="text-[#FA7014]">*</span>
              </label>
              <textarea
                autoFocus
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="Example: Please revise this paragraph to specify 15 days notice period instead of 30 days as discussed..."
                rows={3}
                className="w-full text-xs p-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveComment();
                  }
                }}
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Press Enter to save (Shift+Enter for newline). When you reject the document, all attached comments are sent to HR.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end space-x-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowCommentModal(false);
                  setFloatingButtonPos(null);
                }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!commentInput.trim()}
                onClick={handleSaveComment}
                className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-4 py-2 rounded-xl shadow-xs disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>Attach Comment</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
