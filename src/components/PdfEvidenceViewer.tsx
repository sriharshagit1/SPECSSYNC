import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  Search,
} from 'lucide-react';

interface PdfEvidenceViewerProps {
  pdfBytes: Uint8Array | null;
  fallbackPagesText: string[];
  activePage: number;
  highlightQuote: string | null;
  onPageChange: (page: number) => void;
  fileName: string;
}

export const PdfEvidenceViewer: React.FC<PdfEvidenceViewerProps> = ({
  pdfBytes,
  fallbackPagesText,
  activePage,
  highlightQuote,
  onPageChange,
  fileName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(fallbackPagesText.length || 1);
  const [scale, setScale] = useState<number>(1.15);
  const [pageTextLines, setPageTextLines] = useState<string[]>([]);
  const [renderMode, setRenderMode] = useState<'canvas' | 'text'>('canvas');
  const [isRendering, setIsRendering] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!pdfBytes) {
      setPdfDoc(null);
      setNumPages(Math.max(1, fallbackPagesText.length));
      return;
    }

    const loadDoc = async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        }
        const clonedBytes = new Uint8Array(pdfBytes);
        const loadingTask = pdfjsLib.getDocument({ data: clonedBytes });
        const doc = await loadingTask.promise;
        if (!cancelled) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
        }
      } catch {
        if (!cancelled) {
          setPdfDoc(null);
          setNumPages(Math.max(1, fallbackPagesText.length));
          setRenderMode('text');
        }
      }
    };

    loadDoc();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, fallbackPagesText.length]);

  useEffect(() => {
    let cancelled = false;
    const safePage = Math.max(1, Math.min(numPages, activePage));

    if (!pdfDoc) {
      const fbText = fallbackPagesText[safePage - 1] || '';
      setPageTextLines(fbText.split('\n'));
      return;
    }

    const renderPage = async () => {
      setIsRendering(true);
      try {
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;

            const textContent = await page.getTextContent();
            if (!cancelled && textContent?.items) {
              const extractedLines: string[] = [];
              let currentLine = '';
              let lastY: number | null = null;

              const cleanQuote = (highlightQuote || '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ');
              const quoteTokens = cleanQuote
                .split(/[^a-z0-9_]+/)
                .filter((t) => t.length >= 3);

              for (const item of textContent.items as any[]) {
                const str = item.str || '';
                const tx = item.transform;
                const y = tx ? tx[5] : 0;
                if (lastY !== null && Math.abs(y - lastY) > 5) {
                  if (currentLine.trim()) extractedLines.push(currentLine);
                  currentLine = str;
                } else {
                  currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + str;
                }
                lastY = y;

                if (cleanQuote && str.trim().length > 2) {
                  const itemLower = str.toLowerCase();
                  const isDirectHit =
                    cleanQuote.includes(itemLower) ||
                    itemLower.includes(cleanQuote.slice(0, 28)) ||
                    (quoteTokens.length >= 2 &&
                      quoteTokens.slice(0, 3).every((tok) => itemLower.includes(tok)));

                  if (isDirectHit && tx) {
                    const [vx, vy] = viewport.convertToViewportPoint(tx[4], tx[5]);
                    const boxWidth = (item.width || str.length * 5.2) * scale;
                    const boxHeight = Math.max(14, (item.height || 11) * scale);
                    ctx.save();
                    ctx.fillStyle = 'rgba(56, 189, 248, 0.26)';
                    ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
                    ctx.lineWidth = 1.5;
                    ctx.fillRect(vx - 2, vy - boxHeight + 3, boxWidth + 4, boxHeight + 2);
                    ctx.strokeRect(vx - 2, vy - boxHeight + 3, boxWidth + 4, boxHeight + 2);
                    ctx.restore();
                  }
                }
              }
              if (currentLine.trim()) extractedLines.push(currentLine);
              setPageTextLines(
                extractedLines.length > 0
                  ? extractedLines
                  : (fallbackPagesText[safePage - 1] || '').split('\n')
              );
            }
          }
        }
      } catch {
        const fbText = fallbackPagesText[safePage - 1] || '';
        setPageTextLines(fbText.split('\n'));
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    };

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, activePage, scale, highlightQuote, numPages, fallbackPagesText]);

  const safePage = Math.max(1, Math.min(numPages, activePage));

  const isLineHighlighted = (line: string): boolean => {
    if (!highlightQuote) return false;
    const normLine = line.toLowerCase().replace(/\s+/g, ' ').trim();
    const normQuote = highlightQuote.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normLine || !normQuote) return false;
    if (normLine.includes(normQuote) || normQuote.includes(normLine)) return true;

    const tokens = normQuote.split(/[^a-z0-9_]+/).filter((t) => t.length >= 3);
    if (tokens.length === 0) return false;
    const matchCount = tokens.filter((t) => normLine.includes(t)).length;
    return matchCount >= Math.max(2, Math.ceil(tokens.length * 0.6));
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
      {/* Viewer Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <span
            className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate"
            title={fileName}
          >
            {fileName}
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0">
            Page {safePage} / {numPages}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-slate-200/80 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-800 rounded p-0.5 mr-1">
            <button
              type="button"
              onClick={() => setRenderMode('canvas')}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                renderMode === 'canvas'
                  ? 'bg-white dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              PDF Page
            </button>
            <button
              type="button"
              onClick={() => setRenderMode('text')}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                renderMode === 'text'
                  ? 'bg-white dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Source Text
            </button>
          </div>

          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 rounded transition-colors"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(numPages, safePage + 1))}
            disabled={safePage >= numPages}
            className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 rounded transition-colors"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {renderMode === 'canvas' && (
            <>
              <button
                type="button"
                onClick={() => setScale((s) => Math.max(0.75, Number((s - 0.15).toFixed(2))))}
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setScale((s) => Math.min(2.0, Number((s + 0.15).toFixed(2))))}
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Active Evidence Quote Bar */}
      {highlightQuote && (
        <div className="px-3.5 py-2 bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-800/50 flex items-start gap-2">
          <Search className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed min-w-0">
            <span className="text-sky-700 dark:text-sky-300 font-medium">
              Active Evidence (p. {safePage}):{' '}
            </span>
            <span className="font-mono text-slate-800 dark:text-slate-200 break-words">
              "{highlightQuote}"
            </span>
          </div>
        </div>
      )}

      {/* Main PDF / Text Viewport */}
      <div className="flex-1 overflow-auto p-3 flex flex-col items-center bg-slate-100/70 dark:bg-[#090D14]">
        {renderMode === 'canvas' && pdfDoc ? (
          <div className="relative shadow-md border border-slate-300 dark:border-slate-800 rounded overflow-hidden bg-white">
            {isRendering && (
              <div className="absolute top-2 right-2 px-2 py-0.5 bg-slate-900/80 text-sky-300 text-[11px] font-mono rounded">
                Rendering...
              </div>
            )}
            <canvas ref={canvasRef} className="block max-w-full h-auto" />
          </div>
        ) : (
          <div className="w-full font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-300 space-y-1 bg-white dark:bg-[#0D131F] p-4 rounded border border-slate-200 dark:border-slate-800">
            {pageTextLines.map((line, idx) => {
              const highlighted = isLineHighlighted(line);
              return (
                <div
                  key={idx}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    highlighted
                      ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-950 dark:text-sky-100 ring-1 ring-sky-400 dark:ring-sky-500/50 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {line || '\u00A0'}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
