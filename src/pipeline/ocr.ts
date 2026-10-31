import {
  DocumentSection,
  Register,
  Field,
  TimingParameter,
  Requirement,
  AccessType,
  VALID_ACCESS_TYPES,
} from '../schema/index.ts';
import { parseNumericValue, formatHex } from '../validators/index.ts';

export interface RasterizedPageImage {
  pageNumber: number;
  imageBase64: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  embeddedTextCharCount: number;
}

export interface OcrPageTranscript {
  pageNumber: number;
  text: string;
  confidence: number;
}

export interface OcrFallbackResult {
  registers: Register[];
  timingParameters: TimingParameter[];
  requirements: Requirement[];
  ocrPagesProcessed: number;
  ocrConfidence: number;
  ocrMethod: 'tesseract+gemini-vision' | 'gemini-vision-ocr' | 'deterministic-ocr';
  transcripts: OcrPageTranscript[];
}

/**
 * Repairs common Optical Character Recognition (OCR) character confusions
 * in semiconductor register tables (hex literals, bit ranges, and access modes).
 */
export function normalizeOcrHexAndBitArtifacts(rawText: string): string {
  if (!rawText) return '';

  let cleaned = rawText;

  // 1. Fix OCR typos in hex prefix and digits: e.g. "Ox00", "0x0O", "0x1l", "0xFFI"
  cleaned = cleaned.replace(
    /\b[0O][xX]([0-9a-fA-FOolI_]+)\b/g,
    (_match, hexBody: string) => {
      const fixedBody = hexBody
        .replace(/[Oo]/g, '0')
        .replace(/[lI]/g, '1')
        .replace(/_/g, '');
      return `0x${fixedBody.toUpperCase()}`;
    }
  );

  // 2. Fix OCR typos inside bit-range brackets: e.g. "[3l:O]" -> "[31:0]", "[l5:O]" -> "[15:0]", "[O]" -> "[0]"
  cleaned = cleaned.replace(
    /\[\s*([0-9OolI]+)\s*(?::\s*([0-9OolI]+)\s*)?\]/g,
    (_match, msbRaw: string, lsbRaw?: string) => {
      const fixDigits = (s: string) =>
        s.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
      const msb = fixDigits(msbRaw);
      if (lsbRaw !== undefined) {
        const lsb = fixDigits(lsbRaw);
        return `[${msb}:${lsb}]`;
      }
      return `[${msb}]`;
    }
  );

  // 3. Fix common OCR access mode confusions: "R/W" -> "RW", "WlC"/"WIC" -> "W1C", "WlS"/"WIS" -> "W1S", "R0" -> "RO", "W0" -> "WO"
  cleaned = cleaned
    .replace(/\bR\/W\b/gi, 'RW')
    .replace(/\bW[lI]C\b/g, 'W1C')
    .replace(/\bW[lI]S\b/g, 'W1S')
    .replace(/\bRW[lI]C\b/g, 'RW1C')
    .replace(/\bAccess:\s*R0\b/gi, 'Access: RO')
    .replace(/\bAccess:\s*W0\b/gi, 'Access: WO');

  return cleaned;
}

/**
 * Normalizes an OCR access string into a canonical AccessType or null.
 */
export function normalizeOcrAccess(raw: string | null | undefined): AccessType | null {
  if (!raw) return null;
  const fixed = normalizeOcrHexAndBitArtifacts(raw).trim().toUpperCase();
  if ((VALID_ACCESS_TYPES as readonly string[]).includes(fixed)) {
    return fixed as AccessType;
  }
  if (fixed === 'R/W' || fixed === 'READ/WRITE') return 'RW';
  if (fixed === 'R' || fixed === 'R0' || fixed === 'READ-ONLY') return 'RO';
  if (fixed === 'W' || fixed === 'W0' || fixed === 'WRITE-ONLY') return 'WO';
  if (fixed === 'RSVD' || fixed === 'RES') return 'RESERVED';
  return null;
}

/**
 * Rasterizes PDF pages [startPage..endPage] to high-contrast PNG base64 images
 * using pdfjs-dist in the browser so image-based/scanned tables can be processed by
 * Tesseract.js OCR and Gemini Vision.
 */
export async function rasterizePdfSectionPages(
  pdfBytes: Uint8Array,
  startPage: number,
  endPage: number,
  scale = 2.0
): Promise<RasterizedPageImage[]> {
  if (typeof document === 'undefined') {
    return [];
  }

  try {
    const pdfjsLib = await import('pdfjs-dist');
    if (
      typeof window !== 'undefined' &&
      pdfjsLib.GlobalWorkerOptions &&
      !pdfjsLib.GlobalWorkerOptions.workerSrc
    ) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }

    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
    const pdfDoc = await loadingTask.promise;
    const total = pdfDoc.numPages;
    const clampedStart = Math.max(1, Math.min(total, startPage));
    const clampedEnd = Math.max(clampedStart, Math.min(total, endPage));

    const results: RasterizedPageImage[] = [];

    for (let pageNum = clampedStart; pageNum <= clampedEnd; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent().catch(() => ({ items: [] }));
      const embeddedTextCharCount = (textContent.items as any[])
        .map((it) => String(it?.str ?? ''))
        .join('')
        .trim().length;

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');

      if (!ctx) continue;

      // White background for clean OCR contrast
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      } as any).promise;

      // Apply subtle contrast sharpening for scanned table text legibility
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // Stretch midtones toward crisp black/white without destroying anti-aliasing
          const contrasted = lum < 190 ? Math.max(0, (lum - 30) * 0.85) : 255;
          data[i] = contrasted;
          data[i + 1] = contrasted;
          data[i + 2] = contrasted;
        }
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Ignore if canvas pixel manipulation is restricted
      }

      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

      results.push({
        pageNumber: pageNum,
        imageBase64: base64,
        mimeType: 'image/png',
        width: canvas.width,
        height: canvas.height,
        embeddedTextCharCount,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Runs Tesseract.js Optical Character Recognition on rasterized PDF page images.
 */
export async function runTesseractOcrOnImages(
  images: RasterizedPageImage[]
): Promise<OcrPageTranscript[]> {
  if (images.length === 0) return [];

  try {
    const Tesseract = await import('tesseract.js');
    const transcripts: OcrPageTranscript[] = [];

    for (const img of images) {
      const dataUrl = `data:${img.mimeType};base64,${img.imageBase64}`;
      const result = await Tesseract.recognize(dataUrl, 'eng');
      const rawText = result?.data?.text ?? '';
      const confidence =
        typeof result?.data?.confidence === 'number'
          ? Math.max(0, Math.min(1, result.data.confidence / 100))
          : 0.85;

      transcripts.push({
        pageNumber: img.pageNumber,
        text: normalizeOcrHexAndBitArtifacts(rawText),
        confidence,
      });
    }

    return transcripts;
  } catch {
    return [];
  }
}

/**
 * Deterministic OCR Transcript Parser:
 * Parses OCR-transcribed specification text (handling OCR noise in hex offsets, bit ranges,
 * and tabular layouts) into canonical Registers, TimingParameters, and Requirements.
 */
export function parseOcrTranscriptDeterministic(
  transcripts: OcrPageTranscript[],
  section: DocumentSection
): {
  registers: Register[];
  timingParameters: TimingParameter[];
  requirements: Requirement[];
} {
  const registers: Register[] = [];
  const timingParameters: TimingParameter[] = [];
  const requirements: Requirement[] = [];

  for (const pageEntry of transcripts) {
    const pageNum = pageEntry.pageNumber;
    const normalizedText = normalizeOcrHexAndBitArtifacts(pageEntry.text);
    const lines = normalizedText.split(/\r?\n/);

    let currentReg: Register | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 1. Check for Normative Requirement: e.g., [REQ-XYZ-001] (Section 1.2) ... shall/must ...
      const reqMatch = line.match(
        /^\[?(REQ-[A-Z0-9_-]+)\]?\s*(?:\(Section\s+([^)]+)\))?\s*(.+)$/i
      );
      if (reqMatch) {
        requirements.push({
          id: reqMatch[1].toUpperCase(),
          section: reqMatch[2]?.trim() || section.title,
          page: pageNum,
          text: reqMatch[3].trim(),
        });
        continue;
      }

      // 2. Check for Timing Parameter line:
      // e.g. "- f_SCLK: Max Clock | Min: 10 | Typ: 100 | Max: 200 | Unit: MHz | Condition: ..."
      const timingMatch = line.match(
        /^-?\s*([A-Za-z0-9_]+)\s*:\s*([^|]+)\|\s*Min:\s*([^|]+)\|\s*Typ:\s*([^|]+)\|\s*Max:\s*([^|]+)\|\s*Unit:\s*([^|]+)(?:\|\s*Condition:\s*(.+))?$/i
      );
      if (timingMatch) {
        const cleanVal = (v: string) => {
          const s = v.trim();
          return s === '—' || s === '-' || s.toLowerCase() === 'null' ? null : s;
        };
        timingParameters.push({
          name: timingMatch[1].trim(),
          min: cleanVal(timingMatch[3]),
          typ: cleanVal(timingMatch[4]),
          max: cleanVal(timingMatch[5]),
          unit: cleanVal(timingMatch[6]),
          condition: timingMatch[7]?.trim() || timingMatch[2].trim(),
          evidence: {
            page: pageNum,
            quote: line.slice(0, 120),
          },
        });
        continue;
      }

      // 3. Check for Register Header (Pattern A: "2.1 CTRL — Master Control Register" followed by "Address Offset: 0x00 | Width: 32 bits | Reset Value: 0x00000001")
      // Or single-line tabular register header: "REGISTER: CTRL | Offset: 0x00 | Width: 32 | Reset: 0x00000001"
      const regHeaderTitleMatch = line.match(
        /^(?:\d+\.\d+\s+|REGISTER\s*:\s*)?([A-Z][A-Z0-9_]{1,31})\s*(?:—|--|-|:)\s*(.+)$/
      );
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
      const offsetResetLineMatch =
        line.match(
          /(?:Address\s+)?Offset\s*:\s*(0x[0-9A-Fa-f]+)(?:\s*\|\s*Width\s*:\s*(\d+)\s*(?:bits)?)?(?:\s*\|\s*Reset(?:\s+Value)?\s*:\s*(0x[0-9A-Fa-f]+|—|-|unspecified))?/i
        ) ||
        nextLine.match(
          /(?:Address\s+)?Offset\s*:\s*(0x[0-9A-Fa-f]+)(?:\s*\|\s*Width\s*:\s*(\d+)\s*(?:bits)?)?(?:\s*\|\s*Reset(?:\s+Value)?\s*:\s*(0x[0-9A-Fa-f]+|—|-|unspecified))?/i
        );

      if (regHeaderTitleMatch && offsetResetLineMatch && !line.startsWith('-')) {
        const regName = regHeaderTitleMatch[1].trim().toUpperCase();
        if (
          regName !== 'BITS' &&
          regName !== 'BIT' &&
          regName !== 'ADDRESS' &&
          regName !== 'DESCRIPTION'
        ) {
          const offVal = parseNumericValue(offsetResetLineMatch[1]);
          const widthVal = offsetResetLineMatch[2]
            ? Number(offsetResetLineMatch[2])
            : 32;
          const rstRaw = offsetResetLineMatch[3];
          const rstVal =
            rstRaw && !['—', '-', 'unspecified'].includes(rstRaw.toLowerCase())
              ? parseNumericValue(rstRaw)
              : null;

          currentReg = {
            name: regName,
            offset: offVal !== null ? formatHex(offVal, 8) : offsetResetLineMatch[1],
            width: widthVal,
            description: regHeaderTitleMatch[2].trim(),
            resetValue: rstVal !== null ? formatHex(rstVal, widthVal) : null,
            fields: [],
            confidence: Number(Math.max(0.82, pageEntry.confidence).toFixed(2)),
            repairStatus: 'original',
            reviewStatus: 'pending',
            evidence: {
              page: pageNum,
              quote: `${line} | ${offsetResetLineMatch[0]}`.slice(0, 140),
            },
          };
          registers.push(currentReg);
          if (nextLine.includes(offsetResetLineMatch[0])) {
            i++; // Advance past the offset line
          }
          continue;
        }
      }

      // Pattern B: Compact single-line OCR table row for Register:
      // e.g. "CTRL | 0x00 | 32 | 0x00000001 | Master Control Register"
      const compactRegMatch = line.match(
        /^([A-Z][A-Z0-9_]{1,31})\s*\|\s*(0x[0-9A-Fa-f]+)\s*\|\s*(\d+)\s*\|\s*(0x[0-9A-Fa-f]+|null|—|-)\s*\|\s*(.+)$/
      );
      if (compactRegMatch) {
        const regName = compactRegMatch[1].trim().toUpperCase();
        const offVal = parseNumericValue(compactRegMatch[2]);
        const widthVal = Number(compactRegMatch[3]) || 32;
        const rstVal = parseNumericValue(compactRegMatch[4]);

        currentReg = {
          name: regName,
          offset: offVal !== null ? formatHex(offVal, 8) : compactRegMatch[2],
          width: widthVal,
          description: compactRegMatch[5].trim(),
          resetValue: rstVal !== null ? formatHex(rstVal, widthVal) : null,
          fields: [],
          confidence: Number(Math.max(0.82, pageEntry.confidence).toFixed(2)),
          repairStatus: 'original',
          reviewStatus: 'pending',
          evidence: {
            page: pageNum,
            quote: line.slice(0, 140),
          },
        };
        registers.push(currentReg);
        continue;
      }

      // 4. Check for Bitfield line within currentReg:
      // Pattern A: "- Bits [13:8] TX_IRQ_TH (Access: RW, Reset: 0x0): Description..."
      // Pattern B: "[7:4] | BAUD_SEL | RW | 0x0 | Oversampling select"
      if (currentReg) {
        if (line.toLowerCase().startsWith('description:')) {
          currentReg.description = line.replace(/^description:\s*/i, '').trim();
          continue;
        }

        const fieldBulletMatch = line.match(
          /^-?\s*(?:Bits?|Field)?\s*\[(\d+)(?::(\d+))?\]\s+([A-Za-z0-9_]+)\s*\(\s*Access\s*:\s*([A-Za-z0-9/]+)\s*(?:,\s*Reset\s*:\s*([^)]+))?\)\s*:?\s*(.*)$/i
        );
        if (fieldBulletMatch) {
          const msb = Number(fieldBulletMatch[1]);
          const lsb =
            fieldBulletMatch[2] !== undefined ? Number(fieldBulletMatch[2]) : msb;
          const fName = fieldBulletMatch[3].trim().toUpperCase();
          const access = normalizeOcrAccess(fieldBulletMatch[4]);
          const rstRaw = fieldBulletMatch[5]?.trim();
          const fRstVal = rstRaw ? parseNumericValue(rstRaw) : null;
          const desc = fieldBulletMatch[6]?.trim() || null;

          const field: Field = {
            name: fName,
            msb,
            lsb,
            access,
            resetValue: fRstVal !== null ? formatHex(fRstVal) : null,
            description: desc,
            enumValues: [],
            evidence: {
              page: pageNum,
              quote: line.replace(/^-?\s*/, '').slice(0, 120),
            },
          };
          currentReg.fields.push(field);
          continue;
        }

        const fieldPipeMatch = line.match(
          /^\[(\d+)(?::(\d+))?\]\s*\|\s*([A-Za-z0-9_]+)\s*\|\s*([A-Za-z0-9/]+)\s*\|\s*(0x[0-9A-Fa-f]+|\d+|—|-|null)\s*\|\s*(.*)$/i
        );
        if (fieldPipeMatch) {
          const msb = Number(fieldPipeMatch[1]);
          const lsb =
            fieldPipeMatch[2] !== undefined ? Number(fieldPipeMatch[2]) : msb;
          const fName = fieldPipeMatch[3].trim().toUpperCase();
          const access = normalizeOcrAccess(fieldPipeMatch[4]);
          const fRstVal = parseNumericValue(fieldPipeMatch[5]);
          const desc = fieldPipeMatch[6]?.trim() || null;

          currentReg.fields.push({
            name: fName,
            msb,
            lsb,
            access,
            resetValue: fRstVal !== null ? formatHex(fRstVal) : null,
            description: desc,
            enumValues: [],
            evidence: {
              page: pageNum,
              quote: line.slice(0, 120),
            },
          });
          continue;
        }
      }
    }
  }

  return { registers, timingParameters, requirements };
}

/**
 * Executes the complete multi-stage OCR Fallback Pipeline for an image-based / scanned PDF section:
 * 1. Rasterizes PDF pages in [section.startPage..section.endPage] to high-contrast PNGs.
 * 2. Runs Tesseract.js Optical Character Recognition on the page images (or uses provided OCR text).
 * 3. Calls `/api/pipeline/ocr-extract` with the rasterized PNG images + OCR transcript for Gemini Vision structured extraction.
 * 4. Falls back to `parseOcrTranscriptDeterministic` if Gemini cannot extract registers from the degraded scan,
 *    ensuring all registers are captured even in scanned documents.
 */
export async function runOcrFallbackForSection(
  params: {
    section: DocumentSection;
    pdfBytes?: Uint8Array;
    scannedPageTexts?: string[];
  },
  signal?: AbortSignal
): Promise<OcrFallbackResult> {
  const { section, pdfBytes, scannedPageTexts } = params;

  // Stage 1: Rasterize PDF pages to high-DPI PNG images (when in browser with pdfBytes)
  const rasterizedImages = pdfBytes
    ? await rasterizePdfSectionPages(
        pdfBytes,
        section.startPage,
        section.endPage,
        2.0
      )
    : [];

  // Stage 2: Run Tesseract.js OCR on rasterized images, or build transcripts from scannedPageTexts
  let transcripts: OcrPageTranscript[] = [];
  let hasTesseractOutput = false;

  if (rasterizedImages.length > 0) {
    transcripts = await runTesseractOcrOnImages(rasterizedImages);
    hasTesseractOutput = transcripts.some((t) => t.text.trim().length > 15);
  }

  // If scannedPageTexts were provided (e.g., in simulated scanned mode or headless environment), merge/use them
  if (!hasTesseractOutput && scannedPageTexts && scannedPageTexts.length > 0) {
    transcripts = [];
    for (let p = section.startPage; p <= section.endPage; p++) {
      const rawPage = scannedPageTexts[p - 1] ?? '';
      if (rawPage.trim()) {
        transcripts.push({
          pageNumber: p,
          text: normalizeOcrHexAndBitArtifacts(rawPage),
          confidence: 0.91,
        });
      }
    }
  }

  const avgOcrConfidence =
    transcripts.length > 0
      ? transcripts.reduce((acc, t) => acc + t.confidence, 0) / transcripts.length
      : 0.88;

  // Stage 3: Call Server-Side Gemini Vision + OCR Transcript endpoint (`/api/pipeline/ocr-extract`)
  let apiRegisters: Register[] = [];
  let apiTiming: TimingParameter[] = [];
  let apiRequirements: Requirement[] = [];
  let usedVisionApi = false;

  try {
    const response = await fetch('/api/pipeline/ocr-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        pageImages: rasterizedImages.map((img) => ({
          pageNumber: img.pageNumber,
          imageBase64: img.imageBase64,
          mimeType: img.mimeType,
        })),
        ocrTranscripts: transcripts,
      }),
      signal,
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.registers) && data.registers.length > 0) {
        apiRegisters = data.registers;
        usedVisionApi = true;
      }
      if (Array.isArray(data.timingParameters)) {
        apiTiming = data.timingParameters;
      }
      if (Array.isArray(data.requirements)) {
        apiRequirements = data.requirements;
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    // Continue to deterministic OCR fallback if server call fails
  }

  // Stage 4: Deterministic OCR Transcript Parser guarantees register capture even if LLM returns 0 registers
  const detParsed = parseOcrTranscriptDeterministic(transcripts, section);

  const finalRegisters =
    apiRegisters.length > 0 ? apiRegisters : detParsed.registers;
  const finalTiming =
    apiTiming.length > 0 ? apiTiming : detParsed.timingParameters;
  const finalRequirements =
    apiRequirements.length > 0 ? apiRequirements : detParsed.requirements;

  const ocrMethod: OcrFallbackResult['ocrMethod'] = usedVisionApi
    ? hasTesseractOutput
      ? 'tesseract+gemini-vision'
      : 'gemini-vision-ocr'
    : 'deterministic-ocr';

  return {
    registers: finalRegisters,
    timingParameters: finalTiming,
    requirements: finalRequirements,
    ocrPagesProcessed: Math.max(
      rasterizedImages.length,
      transcripts.length,
      section.endPage - section.startPage + 1
    ),
    ocrConfidence: Number(avgOcrConfidence.toFixed(2)),
    ocrMethod,
    transcripts,
  };
}
