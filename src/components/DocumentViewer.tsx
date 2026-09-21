import React, { useState, useEffect, useRef } from 'react';
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
import { stampPdfWithHeaderFooter, stampDocxWithHeaderFooter, toUint8Array } from '../utils/documentStamper';
import { renderAsync } from 'docx-preview';

interface DocumentViewerProps {
  fileName: string;
  rawContent: string;
  fileUrl?: string;
  mimeType?: string;
  className?: string;
  headerFooterData?: DocumentHeaderFooterData;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  fileName,
  rawContent,
  fileUrl,
  mimeType,
  className = '',
  headerFooterData,
}) => {
  const isDocx =
    fileName?.toLowerCase().endsWith('.docx') ||
    mimeType?.includes('wordprocessingml') ||
    (fileUrl && fileUrl.includes('wordprocessingml'));

  const isPdf =
    fileName?.toLowerCase().endsWith('.pdf') ||
    mimeType === 'application/pdf' ||
    isRawPdfStream(rawContent) ||
    fileUrl?.startsWith('data:application/pdf');

  const isVideo =
    Boolean(fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)) ||
    Boolean(mimeType?.startsWith('video/')) ||
    Boolean(fileUrl && fileUrl.startsWith('data:video/'));

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
      const source = fileUrl || null;
      if (source) {
        setLoadingDocx(true);
        setDocxError(null);
        (async () => {
          try {
            let bytes: Uint8Array;
            if (source.startsWith('data:')) {
              bytes = toUint8Array(source);
            } else {
              const res = await fetch(source);
              bytes = new Uint8Array(await res.arrayBuffer());
            }

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
  }, [isDocx, fileUrl, effectiveHeaderFooterData, fileName]);

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
      const source =
        fileUrl && (fileUrl.startsWith('data:application/pdf') || fileUrl.startsWith('blob:'))
          ? fileUrl
          : isRawPdfStream(rawContent)
          ? rawContent
          : null;

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
  }, [isPdf, fileUrl, rawContent, effectiveHeaderFooterData, fileName]);

  // Convert raw PDF string to Base64 or Blob Data URL if needed
  const effectivePdfDataUrl = React.useMemo(() => {
    if (stampedPdfUrl) {
      return stampedPdfUrl;
    }
    if (fileUrl && fileUrl.startsWith('data:application/pdf')) {
      return fileUrl;
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

    // Synthesize valid corporate PDF if isPdf is true
    if (isPdf && rawContent) {
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
  }, [stampedPdfUrl, fileUrl, rawContent, isPdf, effectiveHeaderFooterData, fileName]);

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
      </div>

      {/* VIEWER BODY */}
      <div className="flex-1 bg-slate-100/70 p-4 overflow-y-auto max-h-[62vh] flex justify-center items-start min-h-[300px]">
        {/* 0. INTERACTIVE VIDEO PLAYER */}
        {viewMode === 'video' && (
          <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto py-2">
            <div className="w-full bg-slate-950 rounded-2xl overflow-hidden shadow-lg border border-slate-800 flex flex-col items-center">
              {fileUrl ? (
                <video
                  controls
                  className="w-full max-h-[55vh] bg-black rounded-t-2xl object-contain"
                  src={fileUrl}
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
                <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Header & footer stamping omitted for video media</span>
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
                return (
                  <p key={i} className="text-slate-700 whitespace-pre-wrap">
                    {trimmed}
                  </p>
                );
              })}
            </div>

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
    </div>
  );
};
