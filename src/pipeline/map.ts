import { PDFDocument } from 'pdf-lib';
import { DocumentMap } from '../schema/index.ts';

/**
 * Converts a Uint8Array buffer into a base64 string safely in the browser.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}

/**
 * Splits a PDF byte array into a smaller PDF containing only pages [startPage..endPage] (1-based inclusive).
 */
export async function slicePdfPages(
  pdfBytes: Uint8Array,
  startPage: number,
  endPage: number
): Promise<{ base64: string; pageCount: number }> {
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const clampedStart = Math.max(1, Math.min(totalPages, startPage));
  const clampedEnd = Math.max(clampedStart, Math.min(totalPages, endPage));

  const subDoc = await PDFDocument.create();
  const pageIndices: number[] = [];
  for (let p = clampedStart; p <= clampedEnd; p++) {
    pageIndices.push(p - 1); // 0-based for pdf-lib
  }

  const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
  for (const cp of copiedPages) {
    subDoc.addPage(cp);
  }

  const slicedBytes = await subDoc.save();
  return {
    base64: uint8ArrayToBase64(slicedBytes),
    pageCount: pageIndices.length,
  };
}

/**
 * Gets the total number of pages in a PDF buffer using pdf-lib.
 */
export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Pass 1 (Flash): Produces a Document Map of chapters with page ranges,
 * flagging which sections contain register tables, timing tables, or requirements.
 */
export async function runDocumentMapPass(
  params: {
    pdfBytes?: Uint8Array;
    specText?: string;
    fileName: string;
  },
  signal?: AbortSignal
): Promise<DocumentMap> {
  let totalPages = 1;
  let pdfBase64: string | undefined;

  if (params.pdfBytes) {
    totalPages = await getPdfPageCount(params.pdfBytes);
    // Send up to first 35 pages or full PDF if compact for fast document mapping
    const mapEndPage = Math.min(totalPages, 35);
    const sliced = await slicePdfPages(params.pdfBytes, 1, mapEndPage);
    pdfBase64 = sliced.base64;
  }

  try {
    const response = await fetch('/api/pipeline/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdfBase64,
        specText: params.specText,
        totalPages,
        fileName: params.fileName,
      }),
      signal,
    });

    if (response.ok) {
      const data = (await response.json()) as DocumentMap;
      return {
        ...data,
        totalPages,
      };
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
  }

  // Static-host / offline fallback (e.g. GitHub Pages where Express /api routes are not present)
  const pages = params.specText
    ? params.specText.split(/\n\n--- PAGE BREAK ---\n\n/)
    : [];
  const inferredName =
    params.fileName.replace(/\.pdf$/i, '').replace(/_Spec.*$/i, '') || 'HARDWARE_IP';

  return {
    ipName: inferredName,
    ipVersion: 'v1.0',
    busWidth: 32,
    baseAddress: '0x40000000',
    totalPages,
    sections: Array.from({ length: totalPages }, (_, idx) => {
      const pNum = idx + 1;
      const pText = pages[idx] || '';
      const hasRegs =
        /Address Offset|Reset Value|Register Map/i.test(pText) || pNum >= 2;
      const hasTiming = /Timing|MHz|ns\b/i.test(pText);
      const hasReqs = /\[REQ-|\bshall\b|\bmust\b/i.test(pText);
      return {
        id: `sec-page-${pNum}`,
        title: `Page ${pNum} Specification Section`,
        startPage: pNum,
        endPage: pNum,
        hasRegisters: hasRegs,
        hasTiming,
        hasRequirements: hasReqs,
        summary: `Automated page ${pNum} section mapping`,
      };
    }),
  };
}
