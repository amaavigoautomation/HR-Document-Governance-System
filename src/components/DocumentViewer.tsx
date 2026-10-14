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
import { stampPdfWithHeaderFooter, stampDocxWithHeaderFooter, toUint8Array, downloadDocumentWithIntactFormat, resolveDocumentBytes } from '../utils/documentStamper';
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

  // DOCX Interactive View State
  const [loadingDocx, setLoadingDocx] = useState<boolean>(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const [stampedDocxBlob, setStampedDocxBlob] = useState<Blob | null>(null);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  const [activeVideoUrl, setActiveVideoUrl] = useState<string>(effectiveFileUrl || '');

  // Revision inline comments state
  const [selectedText, setSelectedText] = useState<string>('');
  const [showCommentModal, setShowCommentModal] = useState<boolean>(false);
  const [commentInput, setCommentInput] = useState<string>('');
  const [showCommentsSidebar, setShowCommentsSidebar] = useState<boolean>(
    Boolean(inlineComments && inlineComments.length > 0)
  );
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [floatingButtonPos, setFloatingButtonPos] = useState<{ x: number; y: number } | null>(null);
  const viewerWrapperRef = useRef<HTMLDivElement | null>(null);

  // Synchronize sidebar if comments change
  useEffect(() => {
    if (inlineComments && inlineComments.length > 0) {
      setShowCommentsSidebar(true);
    }
  }, [inlineComments.length]);

  const handleContainerMouseUp = () => {
    if (!enableInlineComments) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      if (!showCommentModal) {
        setFloatingButtonPos(null);
      }
      return;
    }

    const text = sel.toString().trim();
    if (text.length >= 2) {
      setSelectedText(text);
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const wrapperRect = viewerWrapperRef.current?.getBoundingClientRect();
        if (wrapperRect) {
          setFloatingButtonPos({
            x: Math.max(50, rect.left - wrapperRect.left + rect.width / 2),
            y: Math.max(20, rect.top - wrapperRect.top - 12),
          });
        }
      } catch {
        setFloatingButtonPos(null);
      }
    } else {
      if (!showCommentModal) {
        setFloatingButtonPos(null);
      }
    }
  };

  const handleSaveComment = () => {
    if (!commentInput.trim() || !selectedText) return;
    if (onAddInlineComment) {
      onAddInlineComment({
        selectedText,
        comment: commentInput.trim(),
        createdById: currentUser?.id || 'reviewer-1',
        createdByName: currentUser?.name || 'Authorized Reviewer',
        createdByTitle: currentUser?.title || 'Approver',
      });
    }
    setCommentInput('');
    setShowCommentModal(false);
    setFloatingButtonPos(null);
    setShowCommentsSidebar(true);
    window.getSelection()?.removeAllRanges();
  };

  // Robust Jump To Comment function that handles docx, canvas, and formatted text
  const handleJumpToComment = useCallback(
    (comment: InlineRevisionComment) => {
      setSelectedCommentId(comment.id);
      setShowCommentsSidebar(true);

      // If document is docx and not currently on docx view, switch to it
      if (isDocx && viewMode !== 'docx') {
        setViewMode('docx');
      }

      const performJump = () => {
        // 1. First look for existing tagged element by data-comment-id or highlight id
        let targetEl: HTMLElement | null =
          (docxContainerRef.current?.querySelector(`[data-comment-id="${comment.id}"]`) as HTMLElement) ||
          (viewerWrapperRef.current?.querySelector(`[data-comment-id="${comment.id}"]`) as HTMLElement) ||
          document.getElementById(`highlight-${comment.id}`);

        // 2. If not tagged yet, find the element by matching clean selectedText
        if (!targetEl && comment.selectedText) {
          const rawTarget = comment.selectedText.trim();
          const cleanTarget = rawTarget.replace(/\s+/g, ' ').toLowerCase();
          const searchContainer = docxContainerRef.current || viewerWrapperRef.current;

          if (searchContainer && cleanTarget.length >= 2) {
            const candidates = Array.from(
              searchContainer.querySelectorAll(
                'mark, p, span, h1, h2, h3, h4, h5, h6, li, td, tr, div'
              )
            ) as HTMLElement[];

            // Search elements containing the full target text
            const matches = candidates.filter((el) => {
              const text = (el.textContent || '').replace(/\s+/g, ' ').toLowerCase();
              return text.includes(cleanTarget);
            });

            if (matches.length > 0) {
              // Deepest / most specific element has the shortest textContent
              matches.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
              targetEl = matches[0];
            } else if (cleanTarget.length > 15) {
              // Fallback match by prefix
              const prefix = cleanTarget.substring(0, Math.min(22, cleanTarget.length));
              const prefixMatches = candidates.filter((el) => {
                const text = (el.textContent || '').replace(/\s+/g, ' ').toLowerCase();
                return text.includes(prefix);
              });
              if (prefixMatches.length > 0) {
                prefixMatches.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
                targetEl = prefixMatches[0];
              }
            }

            if (targetEl) {
              targetEl.setAttribute('data-comment-id', comment.id);
              targetEl.setAttribute('id', `highlight-${comment.id}`);
            }
          }
        }

        // 3. Scroll and animate high-contrast focus
        if (targetEl) {
          // Direct container scroll to guarantee target is centered in the scroll area
          const wrapper = viewerWrapperRef.current;
          if (wrapper) {
            const wrapperRect = wrapper.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            const relativeTop = targetRect.top - wrapperRect.top + wrapper.scrollTop;
            const targetScrollTop = relativeTop - (wrapper.clientHeight / 2) + (targetRect.height / 2);
            wrapper.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: 'smooth',
            });
          }

          try {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch {
            // Handled by wrapper.scrollTo
          }

          // Visual highlight animation
          targetEl.classList.remove('ring-4', 'ring-[#FA7014]', 'ring-offset-2', 'bg-orange-200/95');
          void targetEl.offsetWidth; // Force DOM reflow
          targetEl.classList.add(
            'ring-4',
            'ring-[#FA7014]',
            'ring-offset-2',
            'bg-orange-200/95',
            'rounded',
            'transition-all',
            'duration-300'
          );

          setTimeout(() => {
            targetEl?.classList.remove('ring-4', 'ring-[#FA7014]', 'ring-offset-2', 'bg-orange-200/95');
          }, 2500);
        }
      };

      if (isDocx && viewMode !== 'docx') {
        setTimeout(performJump, 150);
      } else {
        performJump();
      }
    },
    [isDocx, viewMode]
  );

  // Highlight inline comment targets inside docxContainerRef
  useEffect(() => {
    if (!inlineComments || inlineComments.length === 0) return;
    const container = docxContainerRef.current;
    if (!container) return;

    const highlightComments = () => {
      try {
        inlineComments.forEach((c, idx) => {
          if (!c.selectedText) return;
          const target = c.selectedText.trim();
          if (target.length < 2) return;

          // Don't duplicate if already tagged
          if (container.querySelector(`[data-comment-id="${c.id}"]`)) return;

          const cleanTarget = target.replace(/\s+/g, ' ').toLowerCase();

          // Strategy 1: Check single text nodes using safe DOM splitText
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          let matched = false;

          while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (parent?.classList.contains('docx-revision-highlight')) continue;

            const text = (node.nodeValue || '').replace(/\s+/g, ' ');
            const foundIdx = text.toLowerCase().indexOf(cleanTarget);
            if (foundIdx !== -1) {
              try {
                const textNode = node as Text;
                const matchNode = textNode.splitText(foundIdx);
                matchNode.splitText(cleanTarget.length);

                const mark = document.createElement('mark');
                mark.className =
                  'docx-revision-highlight bg-amber-200/90 hover:bg-amber-300 text-slate-900 border-b-2 border-[#FA7014] px-1 py-0.5 rounded cursor-pointer transition-colors shadow-2xs inline-flex items-center gap-1';
                mark.setAttribute('data-comment-id', c.id);
                mark.setAttribute('id', `highlight-${c.id}`);
                mark.setAttribute('title', `Comment #${idx + 1}: ${c.comment}`);

                const badge = document.createElement('span');
                badge.className =
                  'bg-[#FA7014] text-white text-[9px] font-bold px-1 rounded-sm ml-1 select-none pointer-events-none';
                badge.textContent = `#${idx + 1}`;

                matchNode.parentNode?.replaceChild(mark, matchNode);
                mark.appendChild(matchNode);
                mark.appendChild(badge);

                mark.onclick = (e) => {
                  e.stopPropagation();
                  handleJumpToComment(c);
                };
                matched = true;
                break;
              } catch {
                // Continue to block strategy
              }
            }
          }

          // Strategy 2: If across spans in docx-preview, find deepest matching element
          if (!matched) {
            const elements = Array.from(
              container.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6, li, td, tr')
            ) as HTMLElement[];

            const matches = elements.filter((el) => {
              if (el.classList.contains('docx-revision-highlight')) return false;
              const txt = (el.textContent || '').replace(/\s+/g, ' ').toLowerCase();
              return txt.includes(cleanTarget);
            });

            if (matches.length > 0) {
              matches.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
              const best = matches[0];
              best.setAttribute('data-comment-id', c.id);
              best.setAttribute('id', `highlight-${c.id}`);
              best.classList.add(
                'docx-revision-highlight',
                'bg-amber-100/90',
                'border-l-4',
                'border-[#FA7014]',
                'px-1',
                'py-0.5',
                'rounded-r',
                'cursor-pointer',
                'transition-all'
              );

              if (!best.querySelector(`.badge-comment-${c.id}`)) {
                const badge = document.createElement('span');
                badge.className = `badge-comment-${c.id} bg-[#FA7014] text-white text-[9px] font-bold px-1.5 py-0.5 rounded ml-1.5 select-none pointer-events-none inline-block shadow-2xs`;
                badge.textContent = `#${idx + 1}`;
                best.appendChild(badge);
              }

              best.onclick = (e) => {
                e.stopPropagation();
                handleJumpToComment(c);
              };
            }
          }
        });
      } catch (err) {
        console.warn('Docx comment highlighting note:', err);
      }
    };

    const timer1 = setTimeout(highlightComments, 300);
    const timer2 = setTimeout(highlightComments, 800);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [inlineComments, viewMode, stampedDocxBlob, loadingDocx, handleJumpToComment]);

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
  // Preserves 100% of original fonts, sizes, colors, and layout while displaying the official header & footer
  useEffect(() => {
    let isMounted = true;
    if (isDocx) {
      const source = effectiveFileUrl || null;
      if (source) {
        setLoadingDocx(true);
        setDocxError(null);
        (async () => {
          try {
            const bytes = await resolveDocumentBytes(source);

            if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
              if (effectiveHeaderFooterData) {
                const stamped = await stampDocxWithHeaderFooter(bytes, {
                  documentTitle: effectiveHeaderFooterData.documentTitle || fileName.replace(/\.[^/.]+$/, ''),
                  versionNumber: effectiveHeaderFooterData.versionNumber || '1.0',
                  effectiveDate: effectiveHeaderFooterData.effectiveDate || new Date().toISOString(),
                  createdByName: effectiveHeaderFooterData.createdByName,
                  approvedByName: effectiveHeaderFooterData.approvedByName,
                  approvedDate: effectiveHeaderFooterData.approvedDate,
                  companyName: effectiveHeaderFooterData.companyName,
                });
                if (isMounted) {
                  setStampedDocxBlob(stamped.blob);
                  setLoadingDocx(false);
                }
              } else {
                const blob = new Blob([bytes], {
                  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                });
                if (isMounted) {
                  setStampedDocxBlob(blob);
                  setLoadingDocx(false);
                }
              }
            } else {
              if (isMounted) {
                setLoadingDocx(false);
                setViewMode('formatted');
              }
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
      } else {
        setLoadingDocx(false);
        setViewMode('formatted');
      }
    }
    return () => {
      isMounted = false;
    };
  }, [isDocx, effectiveFileUrl, effectiveHeaderFooterData, fileName]);

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
          if (isCurrent) setLoadingDocx(false);
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
  }, [viewMode, stampedDocxBlob]);

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
          createdByName: effectiveHeaderFooterData.createdByName,
          approvedByName: effectiveHeaderFooterData.approvedByName,
          approvedDate: effectiveHeaderFooterData.approvedDate,
          companyName: effectiveHeaderFooterData.companyName,
        })
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
        {/* FLOATING ACTION TOOLTIP NEAR SELECTION */}
        {floatingButtonPos && enableInlineComments && selectedText && (
          <div
            style={{
              position: 'absolute',
              left: `${floatingButtonPos.x}px`,
              top: `${floatingButtonPos.y}px`,
              transform: 'translate(-50%, -100%)',
            }}
            className="z-50 pointer-events-auto"
          >
            <button
              type="button"
              onClick={() => setShowCommentModal(true)}
              className="inline-flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-xl border border-slate-700 animate-in fade-in zoom-in-95 cursor-pointer ring-2 ring-[#FA7014]/50"
            >
              <MessageSquarePlus className="w-4 h-4 text-[#FA7014]" />
              <span>Add Revision Comment</span>
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
          <div className="flex flex-col items-center justify-center w-full">
            {loadingDocx && (
              <div className="py-16 text-center text-slate-500">
                <div className="w-8 h-8 border-2 border-[#FA7014] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs">Rendering Word Document with intact fonts, styles, and header/footer...</p>
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
              className={`docx-preview-container flex flex-col items-center py-4 px-2 bg-transparent overflow-x-auto w-full max-w-5xl ${
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
                        <span className="bg-[#FA7014] text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded">
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

      {/* COMMENT MODAL DIALOG */}
      {showCommentModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
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
                <span>Selected Text from Word Document:</span>
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
                className="w-full text-xs p-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSaveComment();
                  }
                }}
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Press Ctrl+Enter or click below to save. When you reject the document, all attached comments are sent to HR.
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
