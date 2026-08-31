import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Download,
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
} from 'lucide-react';
import { extractTextFromRawPdfStream, isRawPdfStream, getBrowserPdfjs } from '../utils/fileParser';

interface DocumentViewerProps {
  fileName: string;
  rawContent: string;
  fileUrl?: string;
  mimeType?: string;
  className?: string;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  fileName,
  rawContent,
  fileUrl,
  mimeType,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<'pdf' | 'formatted' | 'raw'>('pdf');
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [loadingPdf, setLoadingPdf] = useState<boolean>(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  const isPdf =
    fileName?.toLowerCase().endsWith('.pdf') ||
    mimeType === 'application/pdf' ||
    isRawPdfStream(rawContent) ||
    fileUrl?.startsWith('data:application/pdf');

  // Convert raw PDF string to Base64 or Blob Data URL if needed
  const effectivePdfDataUrl = React.useMemo(() => {
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
    return fileUrl || '';
  }, [fileUrl, rawContent]);

  // Load PDF Document with PDF.js
  useEffect(() => {
    if (!isPdf) {
      setViewMode('formatted');
      return;
    }

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

  const handleDownload = () => {
    if (effectivePdfDataUrl) {
      const a = document.createElement('a');
      a.href = effectivePdfDataUrl;
      a.download = fileName || 'document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      const blob = new Blob([rawContent], { type: mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'document.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className={`flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm ${className}`}>
      {/* TOOLBAR */}
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        {/* VIEW MODE SELECTOR */}
        <div className="flex items-center space-x-1.5 bg-white p-1 rounded-xl border border-slate-200">
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

        {/* DOWNLOAD ACTION */}
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center space-x-1.5 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-300 transition-colors shadow-2xs"
        >
          <Download className="w-3.5 h-3.5 text-[#FA7014]" />
          <span>Download Original</span>
        </button>
      </div>

      {/* VIEWER BODY */}
      <div className="flex-1 bg-slate-100/70 p-4 overflow-y-auto max-h-[62vh] flex justify-center items-start min-h-[300px]">
        {/* 1. PDF CANVAS VIEWER */}
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
            <div className="border-b border-slate-200 pb-4 mb-6 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#FA7014]">
                  Formatted Document Content
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">{fileName}</h3>
              </div>
              <span className="bg-orange-50 text-[#FA7014] text-xs px-2.5 py-1 rounded-lg border border-orange-200 font-mono font-bold flex items-center space-x-1.5">
                <FileCheck className="w-3.5 h-3.5" />
                <span>Text Extracted</span>
              </span>
            </div>

            <div className="prose max-w-none text-sm leading-relaxed space-y-4">
              {readableFormattedText.split('\n\n').map((para, i) => {
                const trimmed = para.trim();
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
          </div>
        )}

        {/* 3. RAW CODE / STREAM VIEW */}
        {viewMode === 'raw' && (
          <div className="w-full">
            <pre className="font-mono text-xs text-slate-800 bg-white border border-slate-200 p-4 rounded-xl whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
              {rawContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
