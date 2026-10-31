import { IPSpec, Register, RepairRecord } from '../schema/index.ts';
import {
  validateRegister,
  validateIPSpec,
  parseNumericValue,
  formatHex,
} from '../validators/index.ts';
import { slicePdfPages } from './map.ts';

export interface RepairProgressUpdate {
  registerName: string;
  attempt: number;
  maxAttempts: number;
  status: 'repairing' | 'auto-fixed' | 'needs-human-review';
  errorsBefore: string[];
  errorsAfter: string[];
}

function deterministicFallbackRepairRegister(reg: Register): Register {
  const width = reg.width || 32;
  const fixedFields = reg.fields.map((f) => {
    let msb = f.msb ?? 0;
    let lsb = f.lsb ?? 0;
    // Try extracting exact [msb:lsb] from field evidence quote if available
    const quoteMatch = f.evidence?.quote?.match(/\[(\d+)(?::(\d+))?\]/);
    if (quoteMatch) {
      msb = Number(quoteMatch[1]);
      lsb = quoteMatch[2] !== undefined ? Number(quoteMatch[2]) : msb;
    } else if (msb < lsb) {
      const tmp = msb;
      msb = lsb;
      lsb = tmp;
    }
    return { ...f, msb, lsb };
  });

  // Recompute composed register reset value from field resets
  let composedReset = 0n;
  for (const f of fixedFields) {
    if (f.msb !== null && f.lsb !== null && f.msb >= f.lsb) {
      const fVal = parseNumericValue(f.resetValue) ?? 0n;
      const fWidth = BigInt(f.msb - f.lsb + 1);
      const mask = (1n << fWidth) - 1n;
      composedReset |= (fVal & mask) << BigInt(f.lsb);
    }
  }

  return {
    ...reg,
    fields: fixedFields,
    resetValue: formatHex(composedReset, width),
  };
}

/**
 * Self-Repair Loop:
 * For each register with deterministic validation errors, sends the register JSON +
 * its exact evidence page + the exact error list back to Gemini with the instruction:
 * "Fix only what the errors indicate, using the source page", re-validates, up to 2 retries.
 * Marks registers with "auto-fixed" or "needs-human-review" badge.
 */
export async function runSelfRepairLoop(
  params: {
    spec: IPSpec;
    pdfBytes?: Uint8Array;
    specText?: string;
    maxRetries?: number;
    onRepairUpdate?: (update: RepairProgressUpdate) => void;
  },
  signal?: AbortSignal
): Promise<IPSpec> {
  const { spec, pdfBytes, specText, maxRetries = 2, onRepairUpdate } = params;
  const busWidth = spec.busWidth || 32;

  const updatedRegisters: Register[] = [];

  for (const origReg of spec.registers) {
    let currentReg: Register = {
      ...origReg,
      repairStatus: origReg.repairStatus ?? 'original',
      repairHistory: [...(origReg.repairHistory ?? [])],
    };

    let currentErrors = validateRegister(currentReg, busWidth).filter(
      (i) => i.severity === 'error'
    );

    if (currentErrors.length === 0) {
      updatedRegisters.push(currentReg);
      continue;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Self-repair cancelled by user', 'AbortError');
      }

      const errorMessages = currentErrors.map(
        (e) => `[${e.code}] ${e.message}${e.suggestion ? ` (${e.suggestion})` : ''}`
      );

      onRepairUpdate?.({
        registerName: currentReg.name,
        attempt,
        maxAttempts: maxRetries,
        status: 'repairing',
        errorsBefore: errorMessages,
        errorsAfter: errorMessages,
      });

      try {
        let evidencePagePdfBase64: string | undefined;
        const pageNum = currentReg.evidence?.page ?? 1;
        if (pdfBytes) {
          const sliced = await slicePdfPages(pdfBytes, pageNum, pageNum);
          evidencePagePdfBase64 = sliced.base64;
        }

        let repairedReg: Register | null = null;
        try {
          const response = await fetch('/api/pipeline/repair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              register: currentReg,
              busWidth,
              errors: errorMessages,
              evidencePagePdfBase64,
              specText,
              pageNumber: pageNum,
            }),
            signal,
          });
          if (response.ok) {
            repairedReg = (await response.json()) as Register;
          }
        } catch (fetchErr: any) {
          if (fetchErr?.name === 'AbortError') throw fetchErr;
        }

        if (!repairedReg) {
          repairedReg = deterministicFallbackRepairRegister(currentReg);
        }
        const nextIssues = validateRegister(repairedReg, busWidth).filter(
          (i) => i.severity === 'error'
        );
        const nextErrorMessages = nextIssues.map((e) => `[${e.code}] ${e.message}`);

        const { repairHistory: _omittedHistory, ...snapshotBefore } = currentReg;
        const record: RepairRecord = {
          attempt,
          previousRegister: snapshotBefore,
          errorsFixed: errorMessages.filter((m) => !nextErrorMessages.includes(m)),
          remainingErrors: nextErrorMessages,
          timestamp: new Date().toISOString(),
        };

        const nextRepairStatus: 'auto-fixed' | 'needs-human-review' =
          nextIssues.length === 0 ? 'auto-fixed' : 'needs-human-review';

        currentReg = {
          ...repairedReg,
          id: currentReg.id,
          evidence: repairedReg.evidence?.quote ? repairedReg.evidence : currentReg.evidence,
          repairHistory: [...(currentReg.repairHistory ?? []), record],
          repairStatus: nextRepairStatus,
          reviewStatus: currentReg.reviewStatus ?? 'pending',
        };

        currentErrors = nextIssues;

        onRepairUpdate?.({
          registerName: currentReg.name,
          attempt,
          maxAttempts: maxRetries,
          status: nextRepairStatus,
          errorsBefore: errorMessages,
          errorsAfter: nextErrorMessages,
        });

        if (currentErrors.length === 0) {
          break;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        currentReg.repairStatus = 'needs-human-review';
        break;
      }
    }

    if (currentErrors.length > 0) {
      currentReg.repairStatus = 'needs-human-review';
    }

    updatedRegisters.push(currentReg);
  }

  const finalSpec: IPSpec = {
    ...spec,
    registers: updatedRegisters,
  };

  // Final whole-spec validation pass
  const fullReport = validateIPSpec(finalSpec);
  for (const reg of finalSpec.registers) {
    const regErrors = (fullReport.issuesByRegister[reg.name] ?? []).filter(
      (i) => i.severity === 'error'
    );
    if (regErrors.length > 0 && reg.repairStatus !== 'needs-human-review') {
      reg.repairStatus = 'needs-human-review';
    }
  }

  return finalSpec;
}
