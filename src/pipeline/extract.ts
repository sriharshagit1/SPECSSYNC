import {
  DocumentMap,
  DocumentSection,
  IPSpec,
  Register,
  Field,
  TimingParameter,
  Requirement,
} from '../schema/index.ts';
import { slicePdfPages } from './map.ts';
import { parseNumericValue, formatHex } from '../validators/index.ts';
import { normalizeHwName } from '../crosscheck/index.ts';
import { runOcrFallbackForSection } from './ocr.ts';

export interface SectionProgress {
  sectionId: string;
  title: string;
  startPage: number;
  endPage: number;
  status:
    | 'queued'
    | 'extracting'
    | 'ocr-fallback'
    | 'completed'
    | 'skipped'
    | 'error';
  progressPercent: number;
  registersFound: number;
  timingFound: number;
  requirementsFound: number;
  usedOcrFallback?: boolean;
  ocrMethod?: 'tesseract+gemini-vision' | 'gemini-vision-ocr' | 'deterministic-ocr';
  ocrConfidence?: number;
  error?: string;
}

export interface SectionExtractionResponse {
  ipName: string | null;
  ipVersion: string | null;
  busWidth: number | null;
  baseAddress: string | null;
  registers: Register[];
  timingParameters: TimingParameter[];
  requirements: Requirement[];
}

/**
 * Runs async tasks with a strict concurrency limit (default = 3).
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  let currentIndex = 0;
  const activeWorkers: Promise<void>[] = [];

  const runNext = async (): Promise<void> => {
    while (currentIndex < items.length) {
      if (signal?.aborted) {
        throw new DOMException('Extraction cancelled by user', 'AbortError');
      }
      const idx = currentIndex++;
      await worker(items[idx], idx);
    }
  };

  const count = Math.min(concurrency, items.length);
  for (let i = 0; i < count; i++) {
    activeWorkers.push(runNext());
  }
  await Promise.all(activeWorkers);
}

/**
 * Merges and deduplicates registers across sections by normalized name + offset.
 * Handles multi-page register tables where fields of the same register span across page boundaries.
 */
export function mergeAndDedupeRegisters(
  rawRegisters: Register[],
  ipName?: string
): Register[] {
  const mergedMap = new Map<string, Register>();

  for (const reg of rawRegisters) {
    const normName = normalizeHwName(reg.name, ipName);
    const offVal = parseNumericValue(reg.offset);
    const offCanonical = offVal !== null ? formatHex(offVal, 8) : null;

    // Look for an existing register with same normalized name OR same offset+similar name
    let matchKey: string | null = null;
    for (const [k, existing] of mergedMap.entries()) {
      const existingNorm = normalizeHwName(existing.name, ipName);
      const existingOff = parseNumericValue(existing.offset);
      const existingOffCanonical = existingOff !== null ? formatHex(existingOff, 8) : null;

      if (
        existingNorm === normName &&
        (existingOffCanonical === offCanonical || !existingOffCanonical || !offCanonical)
      ) {
        matchKey = k;
        break;
      }
    }

    if (!matchKey) {
      const key = `${normName}@${offCanonical ?? 'no_off_' + mergedMap.size}`;
      const normalizedFields = [...(reg.fields ?? [])].sort(
        (a, b) => (b.msb ?? 0) - (a.msb ?? 0)
      );
      mergedMap.set(key, {
        ...reg,
        id: `reg-${mergedMap.size + 1}-${normName}`,
        offset: offCanonical ?? reg.offset,
        fields: normalizedFields,
        repairStatus: reg.repairStatus ?? 'original',
        reviewStatus: reg.reviewStatus ?? 'pending',
      });
    } else {
      // Merge multi-page continuation into existing register
      const existing = mergedMap.get(matchKey)!;
      const existingFields = [...existing.fields];

      for (const newField of reg.fields ?? []) {
        const fNorm = normalizeHwName(newField.name);
        const dupIdx = existingFields.findIndex(
          (ef) =>
            normalizeHwName(ef.name) === fNorm &&
            ef.msb === newField.msb &&
            ef.lsb === newField.lsb
        );
        if (dupIdx === -1) {
          existingFields.push(newField);
        } else {
          // Prefer non-null properties from continuation
          const prev = existingFields[dupIdx];
          existingFields[dupIdx] = {
            ...prev,
            access: prev.access ?? newField.access,
            resetValue: prev.resetValue ?? newField.resetValue,
            description: prev.description || newField.description,
            enumValues:
              prev.enumValues && prev.enumValues.length > 0
                ? prev.enumValues
                : newField.enumValues ?? [],
          };
        }
      }

      existingFields.sort((a, b) => (b.msb ?? 0) - (a.msb ?? 0));
      mergedMap.set(matchKey, {
        ...existing,
        offset: existing.offset ?? offCanonical ?? reg.offset,
        width: existing.width ?? reg.width,
        resetValue: existing.resetValue ?? reg.resetValue,
        description: existing.description || reg.description,
        confidence: Number(((existing.confidence + reg.confidence) / 2).toFixed(2)),
        fields: existingFields,
      });
    }
  }

  return Array.from(mergedMap.values()).sort((a, b) => {
    const offA = parseNumericValue(a.offset) ?? 0xffffffffn;
    const offB = parseNumericValue(b.offset) ?? 0xffffffffn;
    return offA < offB ? -1 : offA > offB ? 1 : 0;
  });
}

/**
 * Pass 2 (Pro/Flash) + Automatic OCR Fallback:
 * Extracts flagged sections in parallel (concurrency limit = 3), splits PDF client-side using pdf-lib,
 * and if Gemini cannot extract register tables from an image-based / scanned PDF section,
 * automatically triggers the multi-stage OCR fallback (PDF.js rasterization -> Tesseract.js OCR -> Gemini Vision OCR -> Deterministic OCR Parser).
 */
export async function runSectionExtractionPass(
  params: {
    docMap: DocumentMap;
    pdfBytes?: Uint8Array;
    specText?: string;
    scannedPageTexts?: string[];
    forceOcrFallback?: boolean;
    onProgress: (progressList: SectionProgress[]) => void;
  },
  signal?: AbortSignal
): Promise<IPSpec> {
  const {
    docMap,
    pdfBytes,
    specText,
    scannedPageTexts,
    forceOcrFallback = false,
    onProgress,
  } = params;

  const progressList: SectionProgress[] = docMap.sections.map((sec) => {
    const isFlagged = sec.hasRegisters || sec.hasTiming || sec.hasRequirements;
    return {
      sectionId: sec.id,
      title: sec.title,
      startPage: sec.startPage,
      endPage: sec.endPage,
      status: isFlagged ? 'queued' : 'skipped',
      progressPercent: isFlagged ? 0 : 100,
      registersFound: 0,
      timingFound: 0,
      requirementsFound: 0,
      usedOcrFallback: false,
    };
  });

  onProgress([...progressList]);

  const flaggedSections = docMap.sections.filter(
    (s) => s.hasRegisters || s.hasTiming || s.hasRequirements
  );

  // If no section was flagged by Pass 1, fallback to extracting the entire document as one section
  const sectionsToProcess: DocumentSection[] =
    flaggedSections.length > 0
      ? flaggedSections
      : [
          {
            id: 'sec-fallback',
            title: 'Full Specification Document',
            startPage: 1,
            endPage: docMap.totalPages || 1,
            hasRegisters: true,
            hasTiming: true,
            hasRequirements: true,
            summary: 'Full document extraction pass',
          },
        ];

  const allRegisters: Register[] = [];
  const allTiming: TimingParameter[] = [];
  const allRequirements: Requirement[] = [];
  let discoveredIpName = docMap.ipName;
  let discoveredVersion = docMap.ipVersion;
  let discoveredBusWidth = docMap.busWidth;
  let discoveredBaseAddr = docMap.baseAddress;

  const updateSection = (secId: string, patch: Partial<SectionProgress>) => {
    const idx = progressList.findIndex((p) => p.sectionId === secId);
    if (idx !== -1) {
      progressList[idx] = { ...progressList[idx], ...patch };
      onProgress([...progressList]);
    }
  };

  // Normalize page numbers if model returned 1-based relative to the sliced PDF
  const adjustPageForSection = (section: DocumentSection, p: number) => {
    if (p >= section.startPage && p <= section.endPage) return p;
    if (p >= 1 && p <= section.endPage - section.startPage + 1) {
      return section.startPage + p - 1;
    }
    return section.startPage;
  };

  await runWithConcurrency(
    sectionsToProcess,
    3,
    async (section) => {
      updateSection(section.id, { status: 'extracting', progressPercent: 20 });

      let regs: Register[] = [];
      let timings: TimingParameter[] = [];
      let reqs: Requirement[] = [];
      let primaryFailed = false;
      let primaryErrorMsg = '';
      let usedOcrFallback = false;
      let ocrMethod: SectionProgress['ocrMethod'];
      let ocrConfidence: number | undefined;

      // Step 1: Attempt Primary Gemini Native PDF Extraction (unless forceOcrFallback is set)
      if (!forceOcrFallback) {
        try {
          let slicedPdfBase64: string | undefined;
          if (pdfBytes) {
            const sliced = await slicePdfPages(
              pdfBytes,
              section.startPage,
              section.endPage
            );
            slicedPdfBase64 = sliced.base64;
          }

          updateSection(section.id, { progressPercent: 50 });

          const response = await fetch('/api/pipeline/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              section,
              pdfBase64: slicedPdfBase64,
              specText,
            }),
            signal,
          });

          if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `HTTP ${response.status}`);
          }

          const result = (await response.json()) as SectionExtractionResponse;

          if (!discoveredIpName && result.ipName) discoveredIpName = result.ipName;
          if (!discoveredVersion && result.ipVersion) discoveredVersion = result.ipVersion;
          if (!discoveredBusWidth && result.busWidth) discoveredBusWidth = result.busWidth;
          if (!discoveredBaseAddr && result.baseAddress) discoveredBaseAddr = result.baseAddress;

          regs = (result.registers ?? []).map((r) => ({
            ...r,
            evidence: {
              page: adjustPageForSection(section, r.evidence?.page ?? 1),
              quote: r.evidence?.quote ?? section.title,
            },
            fields: (r.fields ?? []).map((f: Field) => ({
              ...f,
              evidence: {
                page: adjustPageForSection(
                  section,
                  f.evidence?.page ?? r.evidence?.page ?? 1
                ),
                quote: f.evidence?.quote ?? r.evidence?.quote ?? section.title,
              },
            })),
          }));

          timings = (result.timingParameters ?? []).map((tp) => ({
            ...tp,
            evidence: {
              page: adjustPageForSection(section, tp.evidence?.page ?? 1),
              quote: tp.evidence?.quote ?? section.title,
            },
          }));

          reqs = (result.requirements ?? []).map((req) => ({
            ...req,
            page: adjustPageForSection(section, req.page ?? 1),
          }));
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          primaryFailed = true;
          primaryErrorMsg = err?.message || 'Primary extraction failed';
        }
      }

      // Step 2: Check if OCR Fallback is required for this section:
      // Triggered if:
      //  - forceOcrFallback is true, OR
      //  - primary extraction failed, OR
      //  - section is flagged hasRegisters=true (or hasTiming/hasRequirements) and Gemini returned 0 items from an image-based PDF section
      const needsOcrForMissingRegisters =
        section.hasRegisters && regs.length === 0;
      const needsOcrForEmptyFlaggedSection =
        !section.hasRegisters &&
        (section.hasTiming || section.hasRequirements) &&
        timings.length === 0 &&
        reqs.length === 0;

      if (
        forceOcrFallback ||
        primaryFailed ||
        needsOcrForMissingRegisters ||
        needsOcrForEmptyFlaggedSection
      ) {
        updateSection(section.id, {
          status: 'ocr-fallback',
          progressPercent: 70,
          usedOcrFallback: true,
        });

        try {
          const fallbackPages =
            scannedPageTexts ??
            (specText ? specText.split(/\n\n--- PAGE BREAK ---\n\n/) : undefined);

          const ocrResult = await runOcrFallbackForSection(
            {
              section,
              pdfBytes,
              scannedPageTexts: fallbackPages,
            },
            signal
          );

          usedOcrFallback = true;
          ocrMethod = ocrResult.ocrMethod;
          ocrConfidence = ocrResult.ocrConfidence;

          if (regs.length === 0 && ocrResult.registers.length > 0) {
            regs = ocrResult.registers.map((r) => ({
              ...r,
              evidence: {
                page: adjustPageForSection(section, r.evidence?.page ?? section.startPage),
                quote: r.evidence?.quote ?? section.title,
              },
              fields: (r.fields ?? []).map((f: Field) => ({
                ...f,
                evidence: {
                  page: adjustPageForSection(
                    section,
                    f.evidence?.page ?? r.evidence?.page ?? section.startPage
                  ),
                  quote: f.evidence?.quote ?? r.evidence?.quote ?? section.title,
                },
              })),
            }));
          }

          if (timings.length === 0 && ocrResult.timingParameters.length > 0) {
            timings = ocrResult.timingParameters;
          }

          if (reqs.length === 0 && ocrResult.requirements.length > 0) {
            reqs = ocrResult.requirements;
          }
        } catch (ocrErr: any) {
          if (ocrErr?.name === 'AbortError') throw ocrErr;
          if (primaryFailed && regs.length === 0 && timings.length === 0 && reqs.length === 0) {
            updateSection(section.id, {
              status: 'error',
              progressPercent: 100,
              error: `Primary & OCR fallback failed: ${ocrErr?.message || primaryErrorMsg}`,
            });
            return;
          }
        }
      }

      allRegisters.push(...regs);
      allTiming.push(...timings);
      allRequirements.push(...reqs);

      updateSection(section.id, {
        status: 'completed',
        progressPercent: 100,
        registersFound: regs.length,
        timingFound: timings.length,
        requirementsFound: reqs.length,
        usedOcrFallback,
        ocrMethod,
        ocrConfidence,
      });
    },
    signal
  );

  const finalIpName = discoveredIpName || 'EXTRACTED_IP';
  const mergedRegisters = mergeAndDedupeRegisters(allRegisters, finalIpName);

  // Dedupe requirements by ID or text
  const seenReqText = new Set<string>();
  const dedupedReqs: Requirement[] = [];
  for (const r of allRequirements) {
    const norm = r.text.trim().toLowerCase();
    if (!seenReqText.has(norm)) {
      seenReqText.add(norm);
      dedupedReqs.push(r);
    }
  }

  return {
    name: finalIpName,
    version: discoveredVersion ?? 'v1.0',
    busWidth: discoveredBusWidth || 32,
    baseAddress: discoveredBaseAddr ?? '0x40000000',
    registers: mergedRegisters,
    timingParameters: allTiming,
    requirements: dedupedReqs,
  };
}

