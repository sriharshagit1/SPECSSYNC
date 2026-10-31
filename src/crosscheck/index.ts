import { IPSpec, Register, Field } from '../schema/index.ts';
import { parseNumericValue, formatHex } from '../validators/index.ts';

export type ArtifactSource = 'rtl' | 'c_header' | 'ral_rdl';
export type MismatchSeverity = 'critical' | 'major' | 'minor' | 'match';

export interface CrossCheckRow {
  id: string;
  item: string; // e.g. "STATUS.READY reset" or "FIFO_CTRL offset"
  registerName: string;
  fieldName?: string;
  attribute: 'offset' | 'reset' | 'bit_range' | 'access' | 'presence' | 'naming';
  specValue: string;
  rtlValue: string;
  headerValue: string;
  ralRdlValue?: string;
  severity: MismatchSeverity;
  matchConfidence: number; // 0 to 1 fuzzy match confidence
  summary: string; // e.g. "STATUS.READY reset: spec=0x1, RTL=0x0, header=0x1"
  evidencePage?: number;
  evidenceQuote?: string;
}

export interface CrossCheckReport {
  rows: CrossCheckRow[];
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  matchCount: number;
  rtlExtractedRegisters: Register[];
  headerExtractedRegisters: Register[];
  ralRdlExtractedRegisters: Register[];
  unparseableHeaderLines: string[];
}

/**
 * Normalizes hardware register/field names for fuzzy matching:
 * strips common prefixes (REG_, CSR_, UART_, TMR_, AXI_, APB_, CFG_),
 * removes underscores/hyphens, and lowercases.
 */
export function normalizeHwName(name: string, ipName?: string): string {
  let s = name.trim().toUpperCase();
  if (ipName) {
    const ipClean = ipName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const ipParts = ipClean.split('_').filter((p) => p.length >= 2);
    for (const part of [ipClean, ...ipParts]) {
      if (s.startsWith(part + '_')) {
        s = s.slice(part.length + 1);
      }
    }
  }
  s = s.replace(/^(REG_|CSR_|ADDR_|OFFSET_|FIELD_|FLD_|BIT_)/, '');
  s = s.replace(/(_REG|_CSR|_OFFSET|_ADDR)$/, '');
  return s.replace(/[^A-Z0-9]/g, '').toLowerCase();
}

/**
 * Computes fuzzy string similarity (Dice coefficient on bigrams + prefix/edit bonus)
 * returning a confidence score in [0, 1].
 */
export function computeNameSimilarity(
  a: string,
  b: string,
  ipName?: string
): number {
  if (!a || !b) return 0;
  if (a.trim() === b.trim()) return 1.0;
  if (a.trim().toUpperCase() === b.trim().toUpperCase()) return 0.98;

  const normA = normalizeHwName(a, ipName);
  const normB = normalizeHwName(b, ipName);
  if (!normA || !normB) return 0;
  if (normA === normB) return 0.94;

  // Common abbreviation expansions in hardware specs
  const expandAbbrev = (str: string) =>
    str
      .replace(/ctrl/g, 'control')
      .replace(/stat(?!us)/g, 'status')
      .replace(/cfg/g, 'config')
      .replace(/int(?!errupt)/g, 'interrupt')
      .replace(/irq/g, 'interrupt')
      .replace(/en(?!able)/g, 'enable')
      .replace(/div(?!isor)/g, 'divisor')
      .replace(/rdy/g, 'ready')
      .replace(/err/g, 'error')
      .replace(/ovf/g, 'overflow')
      .replace(/ovr/g, 'overrun');

  const expA = expandAbbrev(normA);
  const expB = expandAbbrev(normB);
  if (expA === expB) return 0.91;

  if (expA.includes(expB) || expB.includes(expA)) {
    const ratio = Math.min(expA.length, expB.length) / Math.max(expA.length, expB.length);
    if (ratio >= 0.5) return 0.75 + ratio * 0.15;
  }

  // Bigram Dice similarity
  const getBigrams = (str: string) => {
    const bg: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
      bg.push(str.slice(i, i + 2));
    }
    return bg;
  };

  const bgA = getBigrams(expA);
  const bgB = getBigrams(expB);
  if (bgA.length === 0 || bgB.length === 0) return 0;

  let matches = 0;
  const usedB = new Array(bgB.length).fill(false);
  for (const x of bgA) {
    const idx = bgB.findIndex((y, i) => !usedB[i] && y === x);
    if (idx !== -1) {
      usedB[idx] = true;
      matches++;
    }
  }
  return Number(((2 * matches) / (bgA.length + bgB.length)).toFixed(2));
}

/**
 * Deterministic C Header Parser for #define patterns.
 * Extracts register offsets, reset values, field shifts, masks, and widths.
 * Returns extracted Registers plus any non-comment macro lines that could not be parsed.
 */
export function parseCHeaderDeterministic(
  headerText: string,
  ipName?: string
): { registers: Register[]; unparseableLines: string[] } {
  const lines = headerText.split(/\r?\n/);
  const regMap = new Map<string, Register>();
  const unparseableLines: string[] = [];

  const getOrCreateReg = (rawRegName: string, lineNum: number, rawLine: string): Register => {
    const key = normalizeHwName(rawRegName, ipName).toUpperCase() || rawRegName.toUpperCase();
    let existing = regMap.get(key);
    if (!existing) {
      existing = {
        name: rawRegName.toUpperCase(),
        offset: null,
        width: 32,
        description: 'Extracted from C Header #define',
        resetValue: null,
        fields: [],
        confidence: 1.0,
        evidence: { page: lineNum, quote: rawLine.trim().slice(0, 100) },
      };
      regMap.set(key, existing);
    }
    return existing;
  };

  const getOrCreateField = (
    reg: Register,
    rawFieldName: string,
    lineNum: number,
    rawLine: string
  ): Field => {
    const normTarget = normalizeHwName(rawFieldName);
    let field = reg.fields.find((f) => normalizeHwName(f.name) === normTarget);
    if (!field) {
      field = {
        name: rawFieldName.toUpperCase(),
        msb: null,
        lsb: null,
        access: null,
        resetValue: null,
        description: null,
        enumValues: [],
        evidence: { page: lineNum, quote: rawLine.trim().slice(0, 100) },
      };
      reg.fields.push(field);
    }
    return field;
  };

  // Temporary storage for field masks & shifts before computing [msb:lsb]
  const fieldMeta = new Map<string, { shift?: number; width?: number; mask?: bigint }>();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const stripped = rawLine.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').trim();
    if (!stripped.startsWith('#define')) continue;

    // Ignore header include guards or base addresses
    if (/^#define\s+_[A-Z0-9_]+_H_?\s*$/i.test(stripped)) continue;
    if (/^#define\s+[A-Z0-9_]*BASE(_ADDR|_ADDRESS)?\s+/i.test(stripped)) continue;

    const defMatch = stripped.match(/^#define\s+([A-Za-z0-9_]+)\s+(.+)$/);
    if (!defMatch) continue;

    const macroName = defMatch[1];
    const rawExpr = defMatch[2]
      .trim()
      .replace(/^\(+|\)+$/g, '')
      .replace(/(UL|ULL|U|L)$/i, '')
      .trim();

    // Strip known IP prefix if present
    let cleanMacro = macroName;
    if (ipName) {
      const ipPrefix = ipName.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_';
      if (cleanMacro.toUpperCase().startsWith(ipPrefix)) {
        cleanMacro = cleanMacro.slice(ipPrefix.length);
      }
    }
    cleanMacro = cleanMacro.replace(/^(AXI_UART_|APB_UART_|CSR_|REG_)/i, '');

    // Pattern 1: <REG>_OFFSET or <REG>_ADDR
    const offsetMatch = cleanMacro.match(/^([A-Za-z0-9_]+?)_(?:REG_)?(?:OFFSET|ADDR|OFS)$/i);
    if (offsetMatch) {
      const val = parseNumericValue(rawExpr);
      if (val !== null) {
        const reg = getOrCreateReg(offsetMatch[1], lineNum, rawLine);
        reg.offset = formatHex(val, 8);
        continue;
      }
    }

    // Pattern 2: <REG>_RESET or <REG>_DEFAULT or <REG>_RST
    const resetMatch = cleanMacro.match(/^([A-Za-z0-9_]+?)_(?:REG_)?(?:RESET|DEFAULT|RST|RESET_VAL)$/i);
    if (resetMatch) {
      const val = parseNumericValue(rawExpr);
      if (val !== null) {
        const reg = getOrCreateReg(resetMatch[1], lineNum, rawLine);
        reg.resetValue = formatHex(val, 32);
        continue;
      }
    }

    // Pattern 3: <REG>_<FIELD>_SHIFT / _POS / _LSB / _WIDTH / _MASK / _RESET
    const fieldAttrMatch = cleanMacro.match(
      /^([A-Za-z0-9]+?)_([A-Za-z0-9_]+)_(SHIFT|POS|LSB|WIDTH|MASK|MSK|RESET|RST)$/i
    );
    if (fieldAttrMatch) {
      let regPart = fieldAttrMatch[1];
      let fieldPart = fieldAttrMatch[2];
      const attr = fieldAttrMatch[3].toUpperCase();

      // Try matching against already discovered registers if regPart_fieldPart has multiple underscores
      for (const existingReg of regMap.values()) {
        const prefix = existingReg.name.toUpperCase() + '_';
        const fullPrefix = cleanMacro.toUpperCase();
        if (fullPrefix.startsWith(prefix)) {
          const rest = cleanMacro.slice(prefix.length);
          const subMatch = rest.match(/^([A-Za-z0-9_]+)_(SHIFT|POS|LSB|WIDTH|MASK|MSK|RESET|RST)$/i);
          if (subMatch) {
            regPart = existingReg.name;
            fieldPart = subMatch[1];
            break;
          }
        }
      }

      const reg = getOrCreateReg(regPart, lineNum, rawLine);
      const field = getOrCreateField(reg, fieldPart, lineNum, rawLine);
      const metaKey = `${reg.name}.${field.name}`;
      const meta = fieldMeta.get(metaKey) ?? {};

      // Parse shifted mask expressions like (0x3UL << 4) or (1U << 0)
      const shiftExprMatch = rawExpr.match(
        /^\(?([0-9a-fxA-FX]+)(?:UL|U|L)?\)?\s*<<\s*\(?([0-9a-fxA-FX]+)(?:UL|U|L)?\)?$/
      );
      if (shiftExprMatch && (attr === 'MASK' || attr === 'MSK')) {
        const unshifted = parseNumericValue(shiftExprMatch[1]);
        const shiftAmt = parseNumericValue(shiftExprMatch[2]);
        if (unshifted !== null && shiftAmt !== null) {
          meta.mask = unshifted << shiftAmt;
          meta.shift = Number(shiftAmt);
          fieldMeta.set(metaKey, meta);
          continue;
        }
      }

      const numVal = parseNumericValue(rawExpr);
      if (numVal !== null) {
        if (attr === 'SHIFT' || attr === 'POS' || attr === 'LSB') {
          meta.shift = Number(numVal);
          field.lsb = Number(numVal);
        } else if (attr === 'WIDTH') {
          meta.width = Number(numVal);
        } else if (attr === 'MASK' || attr === 'MSK') {
          meta.mask = numVal;
        } else if (attr === 'RESET' || attr === 'RST') {
          field.resetValue = formatHex(numVal);
        }
        fieldMeta.set(metaKey, meta);
        continue;
      }
    }

    unparseableLines.push(rawLine);
  }

  // Reconcile field MSB/LSB from shift, width, and mask
  for (const reg of regMap.values()) {
    for (const field of reg.fields) {
      const metaKey = `${reg.name}.${field.name}`;
      const meta = fieldMeta.get(metaKey);
      if (!meta) continue;

      if (meta.shift !== undefined && meta.width !== undefined) {
        field.lsb = meta.shift;
        field.msb = meta.shift + meta.width - 1;
      } else if (meta.mask !== undefined && meta.mask > 0n) {
        // Compute lsb and msb from bitmask
        let m = meta.mask;
        let lsb = 0;
        while ((m & 1n) === 0n && lsb < 64) {
          m >>= 1n;
          lsb++;
        }
        let width = 0;
        while ((m & 1n) === 1n && width < 64) {
          m >>= 1n;
          width++;
        }
        // If mask was unshifted (e.g. 0x3) and shift was defined separately
        if (lsb === 0 && meta.shift !== undefined && meta.shift > 0) {
          field.lsb = meta.shift;
          field.msb = meta.shift + width - 1;
        } else {
          field.lsb = lsb;
          field.msb = lsb + Math.max(1, width) - 1;
        }
      } else if (meta.shift !== undefined && field.msb === null) {
        field.lsb = meta.shift;
        field.msb = meta.shift;
      }
    }

    // If register reset is defined and fields don't have explicit resets, derive field resets from register reset
    const regReset = parseNumericValue(reg.resetValue);
    if (regReset !== null) {
      for (const field of reg.fields) {
        if (field.resetValue === null && field.msb !== null && field.lsb !== null) {
          const width = Math.max(1, field.msb - field.lsb + 1);
          const mask = (1n << BigInt(width)) - 1n;
          const fReset = (regReset >> BigInt(field.lsb)) & mask;
          field.resetValue = formatHex(fReset);
        }
      }
    }
  }

  return {
    registers: Array.from(regMap.values()),
    unparseableLines,
  };
}

/**
 * Deterministic fast-path RTL (Verilog/SystemVerilog) parser.
 * Parses localparam/parameter offsets, register struct comments, or structured reset blocks,
 * and can be augmented or superseded by Gemini extraction.
 */
export function parseRTLDeterministic(
  rtlText: string,
  ipName?: string
): Register[] {
  const lines = rtlText.split(/\r?\n/);
  const regMap = new Map<string, Register>();

  const getOrCreateReg = (rawName: string, lineNum: number, quote: string): Register => {
    const key = normalizeHwName(rawName, ipName).toUpperCase() || rawName.toUpperCase();
    let reg = regMap.get(key);
    if (!reg) {
      reg = {
        name: rawName.toUpperCase(),
        offset: null,
        width: 32,
        description: 'Extracted from RTL',
        resetValue: null,
        fields: [],
        confidence: 0.95,
        evidence: { page: lineNum, quote: quote.trim().slice(0, 100) },
      };
      regMap.set(key, reg);
    }
    return reg;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];

    // Match field slice assignment or comment annotation in RTL:
    // e.g. // @field REG.FIELD [msb:lsb] access=RW reset=0x1
    const rtlFieldMatch = raw.match(
      /\/\/\s*@?field\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s+\[(\d+)(?::(\d+))?\]\s*(?:access=([A-Za-z0-9]+))?\s*(?:reset=([0-9a-fxA-FX']+))?/i
    );
    if (rtlFieldMatch) {
      const reg = getOrCreateReg(rtlFieldMatch[1], lineNum, raw);
      const msb = Number(rtlFieldMatch[3]);
      const lsb = rtlFieldMatch[4] !== undefined ? Number(rtlFieldMatch[4]) : msb;
      const access = rtlFieldMatch[5] ? rtlFieldMatch[5].toUpperCase() : null;
      const rst = rtlFieldMatch[6] ? parseNumericValue(rtlFieldMatch[6]) : null;
      reg.fields.push({
        name: rtlFieldMatch[2].toUpperCase(),
        msb,
        lsb,
        access,
        resetValue: rst !== null ? formatHex(rst) : null,
        description: null,
        enumValues: [],
        evidence: { page: lineNum, quote: raw.trim().slice(0, 100) },
      });
      continue;
    }

    const clean = raw.replace(/\/\/.*$/, '').trim();
    if (!clean) continue;

    // Match: localparam [ADDR_W-1:0] ADDR_CTRL = 8'h00; or parameter CTRL_OFFSET = 32'h04;
    const paramMatch = clean.match(
      /(?:localparam|parameter)\s+(?:logic\s+|bit\s+)?(?:\[[^\]]+\]\s+)?([A-Za-z0-9_]+)\s*=\s*([^;,]+)/i
    );
    if (paramMatch) {
      const pName = paramMatch[1];
      const pVal = parseNumericValue(paramMatch[2]);
      if (pVal !== null) {
        const addrNameMatch = pName.match(
          /^(?:ADDR_|OFFSET_|REG_)?([A-Za-z0-9_]+?)(?:_OFFSET|_ADDR|_OFS)?$/i
        );
        if (
          addrNameMatch &&
          (pName.toUpperCase().includes('ADDR') || pName.toUpperCase().includes('OFFSET'))
        ) {
          const reg = getOrCreateReg(addrNameMatch[1], lineNum, raw);
          reg.offset = formatHex(pVal, 8);
          continue;
        }
        const rstNameMatch = pName.match(
          /^(?:RST_|RESET_)?([A-Za-z0-9_]+?)(?:_RESET|_RST|_DEFAULT)?$/i
        );
        if (rstNameMatch && (pName.toUpperCase().includes('RST') || pName.toUpperCase().includes('RESET'))) {
          const reg = getOrCreateReg(rstNameMatch[1], lineNum, raw);
          reg.resetValue = formatHex(pVal, 32);
          continue;
        }
      }
    }

    // Match reset assignment in always_ff block: e.g., ctrl_q <= 32'h0000_0001; or status_ready_q <= 1'b0;
    const rstAssignMatch = clean.match(/^([A-Za-z0-9_]+?)(?:_reg|_q|_r)?\s*<=\s*([0-9a-fA-FxXbB'_]+)\s*;/);
    if (rstAssignMatch) {
      const targetName = rstAssignMatch[1];
      const rstVal = parseNumericValue(rstAssignMatch[2]);
      if (rstVal !== null) {
        // Check if targetName matches an existing register
        const existingReg = Array.from(regMap.values()).find(
          (r) => normalizeHwName(r.name, ipName) === normalizeHwName(targetName, ipName)
        );
        if (existingReg && existingReg.resetValue === null) {
          existingReg.resetValue = formatHex(rstVal, 32);
        } else {
          // Check if targetName is <reg>_<field>
          for (const r of regMap.values()) {
            const prefix = r.name.toLowerCase() + '_';
            if (targetName.toLowerCase().startsWith(prefix)) {
              const fPart = targetName.slice(prefix.length);
              const existingField = r.fields.find(
                (f) => normalizeHwName(f.name) === normalizeHwName(fPart)
              );
              if (existingField) {
                existingField.resetValue = formatHex(rstVal);
              }
            }
          }
        }
      }
    }
  }

  return Array.from(regMap.values());
}

/**
 * Matches an artifact list of Registers against the Canonical Spec Registers
 * using fuzzy name matching + offset fallback.
 */
function findBestMatchRegister(
  specReg: Register,
  candidates: Register[],
  ipName?: string
): { reg: Register | null; confidence: number } {
  let best: Register | null = null;
  let bestScore = 0;

  const specOff = parseNumericValue(specReg.offset);

  for (const cand of candidates) {
    let score = computeNameSimilarity(specReg.name, cand.name, ipName);
    const candOff = parseNumericValue(cand.offset);
    if (specOff !== null && candOff !== null && specOff === candOff) {
      // Strong boost if address offsets match
      score = Math.max(score, 0.85);
      if (score > 0.6) score = Math.min(1.0, score + 0.1);
    }
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (bestScore >= 0.6) {
    return { reg: best, confidence: bestScore };
  }
  return { reg: null, confidence: 0 };
}

function findBestMatchField(
  specField: Field,
  candidates: Field[]
): { field: Field | null; confidence: number } {
  let best: Field | null = null;
  let bestScore = 0;

  for (const cand of candidates) {
    let score = computeNameSimilarity(specField.name, cand.name);
    if (
      specField.msb !== null &&
      specField.lsb !== null &&
      cand.msb === specField.msb &&
      cand.lsb === specField.lsb
    ) {
      score = Math.max(score, 0.82);
    }
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (bestScore >= 0.6) {
    return { field: best, confidence: bestScore };
  }
  return { field: null, confidence: 0 };
}

/**
 * Runs the Cross-Artifact Consistency Checker across Spec IR, RTL Registers,
 * C Header Registers, and optional UVM RAL / SystemRDL Registers.
 */
export function runCrossArtifactCheck(
  spec: IPSpec,
  rtlRegisters: Register[],
  headerRegisters: Register[],
  ralRdlRegisters: Register[] = [],
  unparseableHeaderLines: string[] = []
): CrossCheckReport {
  const rows: CrossCheckRow[] = [];
  const matchedRtlRegs = new Set<string>();
  const matchedHeaderRegs = new Set<string>();

  const hasRtl = rtlRegisters.length > 0;
  const hasHeader = headerRegisters.length > 0;

  for (const specReg of spec.registers) {
    const rtlMatch = findBestMatchRegister(specReg, rtlRegisters, spec.name);
    const hdrMatch = findBestMatchRegister(specReg, headerRegisters, spec.name);
    const ralMatch = findBestMatchRegister(specReg, ralRdlRegisters, spec.name);

    if (rtlMatch.reg) matchedRtlRegs.add(rtlMatch.reg.name);
    if (hdrMatch.reg) matchedHeaderRegs.add(hdrMatch.reg.name);

    const minRegConf = Math.min(
      rtlMatch.reg ? rtlMatch.confidence : 1,
      hdrMatch.reg ? hdrMatch.confidence : 1
    );

    // 0. Check if register is missing in RTL or Header
    if ((hasRtl && !rtlMatch.reg) || (hasHeader && !hdrMatch.reg)) {
      const specOff = specReg.offset ?? 'unspecified';
      const rtlPres = hasRtl ? (rtlMatch.reg ? `${rtlMatch.reg.name} (${rtlMatch.reg.offset})` : 'Missing in RTL') : 'N/A';
      const hdrPres = hasHeader ? (hdrMatch.reg ? `${hdrMatch.reg.name} (${hdrMatch.reg.offset})` : 'Missing in Header') : 'N/A';
      rows.push({
        id: `reg-presence-${specReg.name}`,
        item: `${specReg.name} presence`,
        registerName: specReg.name,
        attribute: 'presence',
        specValue: `Present (${specOff})`,
        rtlValue: rtlPres,
        headerValue: hdrPres,
        severity: 'critical',
        matchConfidence: 1.0,
        summary: `${specReg.name} register missing: spec=${specOff}, RTL=${rtlPres}, header=${hdrPres}`,
        evidencePage: specReg.evidence.page,
        evidenceQuote: specReg.evidence.quote,
      });
    }

    // 1. Naming difference (Minor severity if fuzzy matched with different identifier)
    if (
      (rtlMatch.reg && normalizeHwName(rtlMatch.reg.name, spec.name) !== normalizeHwName(specReg.name, spec.name)) ||
      (hdrMatch.reg && normalizeHwName(hdrMatch.reg.name, spec.name) !== normalizeHwName(specReg.name, spec.name))
    ) {
      rows.push({
        id: `reg-naming-${specReg.name}`,
        item: `${specReg.name} identifier`,
        registerName: specReg.name,
        attribute: 'naming',
        specValue: specReg.name,
        rtlValue: rtlMatch.reg?.name ?? '—',
        headerValue: hdrMatch.reg?.name ?? '—',
        severity: 'minor',
        matchConfidence: minRegConf,
        summary: `${specReg.name} naming: spec=${specReg.name}, RTL=${rtlMatch.reg?.name ?? 'N/A'}, header=${hdrMatch.reg?.name ?? 'N/A'}`,
        evidencePage: specReg.evidence.page,
        evidenceQuote: specReg.evidence.quote,
      });
    }

    // 2. Compare Register Offset (Critical if mismatch)
    const specOffVal = parseNumericValue(specReg.offset);
    const rtlOffVal = parseNumericValue(rtlMatch.reg?.offset);
    const hdrOffVal = parseNumericValue(hdrMatch.reg?.offset);

    const specOffFmt = specOffVal !== null ? formatHex(specOffVal, 8) : 'unspecified';
    const rtlOffFmt = rtlMatch.reg
      ? rtlOffVal !== null
        ? formatHex(rtlOffVal, 8)
        : 'unspecified'
      : '—';
    const hdrOffFmt = hdrMatch.reg
      ? hdrOffVal !== null
        ? formatHex(hdrOffVal, 8)
        : 'unspecified'
      : '—';

    const rtlOffMismatch =
      rtlMatch.reg && specOffVal !== null && rtlOffVal !== null && specOffVal !== rtlOffVal;
    const hdrOffMismatch =
      hdrMatch.reg && specOffVal !== null && hdrOffVal !== null && specOffVal !== hdrOffVal;

    rows.push({
      id: `reg-offset-${specReg.name}`,
      item: `${specReg.name} offset`,
      registerName: specReg.name,
      attribute: 'offset',
      specValue: specOffFmt,
      rtlValue: rtlOffFmt,
      headerValue: hdrOffFmt,
      ralRdlValue: ralMatch.reg?.offset ?? undefined,
      severity: rtlOffMismatch || hdrOffMismatch ? 'critical' : 'match',
      matchConfidence: minRegConf,
      summary: `${specReg.name} offset: spec=${specOffFmt}, RTL=${rtlOffFmt}, header=${hdrOffFmt}`,
      evidencePage: specReg.evidence.page,
      evidenceQuote: specReg.evidence.quote,
    });

    // 3. Compare Register Reset Value (Critical if mismatch)
    const specRstVal = parseNumericValue(specReg.resetValue);
    const rtlRstVal = parseNumericValue(rtlMatch.reg?.resetValue);
    const hdrRstVal = parseNumericValue(hdrMatch.reg?.resetValue);

    if (specRstVal !== null || rtlRstVal !== null || hdrRstVal !== null) {
      const specRstFmt = specRstVal !== null ? formatHex(specRstVal, 32) : 'unspecified';
      const rtlRstFmt = rtlMatch.reg
        ? rtlRstVal !== null
          ? formatHex(rtlRstVal, 32)
          : 'unspecified'
        : '—';
      const hdrRstFmt = hdrMatch.reg
        ? hdrRstVal !== null
          ? formatHex(hdrRstVal, 32)
          : 'unspecified'
        : '—';

      const rtlRstMismatch =
        rtlMatch.reg && specRstVal !== null && rtlRstVal !== null && specRstVal !== rtlRstVal;
      const hdrRstMismatch =
        hdrMatch.reg && specRstVal !== null && hdrRstVal !== null && specRstVal !== hdrRstVal;

      rows.push({
        id: `reg-reset-${specReg.name}`,
        item: `${specReg.name} reset`,
        registerName: specReg.name,
        attribute: 'reset',
        specValue: specRstFmt,
        rtlValue: rtlRstFmt,
        headerValue: hdrRstFmt,
        severity: rtlRstMismatch || hdrRstMismatch ? 'critical' : 'match',
        matchConfidence: minRegConf,
        summary: `${specReg.name} reset: spec=${specRstFmt}, RTL=${rtlRstFmt}, header=${hdrRstFmt}`,
        evidencePage: specReg.evidence.page,
        evidenceQuote: specReg.evidence.quote,
      });
    }

    // 4. Compare Fields within Register
    for (const specField of specReg.fields) {
      if ((specField.access ?? '').toUpperCase() === 'RESERVED') continue;

      const rtlFieldMatch = rtlMatch.reg
        ? findBestMatchField(specField, rtlMatch.reg.fields)
        : { field: null, confidence: 0 };
      const hdrFieldMatch = hdrMatch.reg
        ? findBestMatchField(specField, hdrMatch.reg.fields)
        : { field: null, confidence: 0 };

      const fConf = Math.min(
        rtlFieldMatch.field ? rtlFieldMatch.confidence : 1,
        hdrFieldMatch.field ? hdrFieldMatch.confidence : 1
      );

      // 4a. Field Bit Range [msb:lsb]
      const fmtBits = (f: Field | null) => {
        if (!f || f.msb === null || f.lsb === null) return '—';
        return f.msb === f.lsb ? `[${f.msb}]` : `[${f.msb}:${f.lsb}]`;
      };
      const specBits = fmtBits(specField);
      const rtlBits = fmtBits(rtlFieldMatch.field);
      const hdrBits = fmtBits(hdrFieldMatch.field);

      const rtlBitMismatch =
        rtlFieldMatch.field &&
        rtlFieldMatch.field.msb !== null &&
        (rtlFieldMatch.field.msb !== specField.msb || rtlFieldMatch.field.lsb !== specField.lsb);
      const hdrBitMismatch =
        hdrFieldMatch.field &&
        hdrFieldMatch.field.msb !== null &&
        (hdrFieldMatch.field.msb !== specField.msb || hdrFieldMatch.field.lsb !== specField.lsb);

      rows.push({
        id: `field-bits-${specReg.name}-${specField.name}`,
        item: `${specReg.name}.${specField.name} bits`,
        registerName: specReg.name,
        fieldName: specField.name,
        attribute: 'bit_range',
        specValue: specBits,
        rtlValue: rtlBits,
        headerValue: hdrBits,
        severity: rtlBitMismatch || hdrBitMismatch ? 'critical' : 'match',
        matchConfidence: fConf,
        summary: `${specReg.name}.${specField.name} bits: spec=${specBits}, RTL=${rtlBits}, header=${hdrBits}`,
        evidencePage: specField.evidence.page,
        evidenceQuote: specField.evidence.quote,
      });

      // 4b. Field Reset Value
      const sFRst = parseNumericValue(specField.resetValue);
      const rFRst = parseNumericValue(rtlFieldMatch.field?.resetValue);
      const hFRst = parseNumericValue(hdrFieldMatch.field?.resetValue);

      if (sFRst !== null || rFRst !== null || hFRst !== null) {
        const sStr = sFRst !== null ? formatHex(sFRst) : 'unspecified';
        const rStr = rtlFieldMatch.field ? (rFRst !== null ? formatHex(rFRst) : '—') : '—';
        const hStr = hdrFieldMatch.field ? (hFRst !== null ? formatHex(hFRst) : '—') : '—';

        const rMismatch = rtlFieldMatch.field && sFRst !== null && rFRst !== null && sFRst !== rFRst;
        const hMismatch = hdrFieldMatch.field && sFRst !== null && hFRst !== null && sFRst !== hFRst;

        rows.push({
          id: `field-reset-${specReg.name}-${specField.name}`,
          item: `${specReg.name}.${specField.name} reset`,
          registerName: specReg.name,
          fieldName: specField.name,
          attribute: 'reset',
          specValue: sStr,
          rtlValue: rStr,
          headerValue: hStr,
          severity: rMismatch || hMismatch ? 'critical' : 'match',
          matchConfidence: fConf,
          summary: `${specReg.name}.${specField.name} reset: spec=${sStr}, RTL=${rStr}, header=${hStr}`,
          evidencePage: specField.evidence.page,
          evidenceQuote: specField.evidence.quote,
        });
      }

      // 4c. Field Access Policy (Major if mismatch)
      const sAcc = (specField.access ?? '').toUpperCase() || 'unspecified';
      const rAcc = (rtlFieldMatch.field?.access ?? '').toUpperCase() || '—';
      const hAcc = (hdrFieldMatch.field?.access ?? '').toUpperCase() || '—';

      if (rAcc !== '—' || hAcc !== '—') {
        const rAccMismatch = rAcc !== '—' && sAcc !== 'unspecified' && rAcc !== sAcc;
        const hAccMismatch = hAcc !== '—' && sAcc !== 'unspecified' && hAcc !== sAcc;
        if (rAccMismatch || hAccMismatch) {
          rows.push({
            id: `field-access-${specReg.name}-${specField.name}`,
            item: `${specReg.name}.${specField.name} access`,
            registerName: specReg.name,
            fieldName: specField.name,
            attribute: 'access',
            specValue: sAcc,
            rtlValue: rAcc,
            headerValue: hAcc,
            severity: 'major',
            matchConfidence: fConf,
            summary: `${specReg.name}.${specField.name} access: spec=${sAcc}, RTL=${rAcc}, header=${hAcc}`,
            evidencePage: specField.evidence.page,
            evidenceQuote: specField.evidence.quote,
          });
        }
      }

      // 4d. Field Naming difference (Minor)
      if (
        (rtlFieldMatch.field &&
          normalizeHwName(rtlFieldMatch.field.name) !== normalizeHwName(specField.name)) ||
        (hdrFieldMatch.field &&
          normalizeHwName(hdrFieldMatch.field.name) !== normalizeHwName(specField.name))
      ) {
        rows.push({
          id: `field-naming-${specReg.name}-${specField.name}`,
          item: `${specReg.name}.${specField.name} naming`,
          registerName: specReg.name,
          fieldName: specField.name,
          attribute: 'naming',
          specValue: specField.name,
          rtlValue: rtlFieldMatch.field?.name ?? '—',
          headerValue: hdrFieldMatch.field?.name ?? '—',
          severity: 'minor',
          matchConfidence: fConf,
          summary: `${specReg.name}.${specField.name} naming: spec=${specField.name}, RTL=${rtlFieldMatch.field?.name ?? '—'}, header=${hdrFieldMatch.field?.name ?? '—'}`,
          evidencePage: specField.evidence.page,
          evidenceQuote: specField.evidence.quote,
        });
      }
    }
  }

  // 5. Unmatched registers present only in RTL or only in C Header
  for (const rReg of rtlRegisters) {
    if (!matchedRtlRegs.has(rReg.name)) {
      rows.push({
        id: `rtl-only-${rReg.name}`,
        item: `${rReg.name} (undocumented in spec)`,
        registerName: rReg.name,
        attribute: 'presence',
        specValue: 'Absent in Spec',
        rtlValue: `Present only in RTL (${rReg.offset ?? 'N/A'})`,
        headerValue: '—',
        severity: 'major',
        matchConfidence: 0,
        summary: `${rReg.name}: present only in RTL (${rReg.offset ?? 'N/A'})`,
        evidencePage: rReg.evidence.page,
        evidenceQuote: rReg.evidence.quote,
      });
    }
  }

  for (const hReg of headerRegisters) {
    if (!matchedHeaderRegs.has(hReg.name)) {
      rows.push({
        id: `hdr-only-${hReg.name}`,
        item: `${hReg.name} (undocumented in spec)`,
        registerName: hReg.name,
        attribute: 'presence',
        specValue: 'Absent in Spec',
        rtlValue: '—',
        headerValue: `Present only in C Header (${hReg.offset ?? 'N/A'})`,
        severity: 'major',
        matchConfidence: 0,
        summary: `${hReg.name}: present only in C Header (${hReg.offset ?? 'N/A'})`,
        evidencePage: hReg.evidence.page,
        evidenceQuote: hReg.evidence.quote,
      });
    }
  }

  // Sort rows: critical first, then major, then minor, then match
  const sevOrder: Record<MismatchSeverity, number> = {
    critical: 0,
    major: 1,
    minor: 2,
    match: 3,
  };
  rows.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return {
    rows,
    criticalCount: rows.filter((r) => r.severity === 'critical').length,
    majorCount: rows.filter((r) => r.severity === 'major').length,
    minorCount: rows.filter((r) => r.severity === 'minor').length,
    matchCount: rows.filter((r) => r.severity === 'match').length,
    rtlExtractedRegisters: rtlRegisters,
    headerExtractedRegisters: headerRegisters,
    ralRdlExtractedRegisters: ralRdlRegisters,
    unparseableHeaderLines,
  };
}

/**
 * Exports CrossCheckReport to CSV format.
 */
export function exportCrossCheckCSV(report: CrossCheckReport): string {
  const esc = (v: string | number | undefined) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    'Item,Attribute,Spec Value,RTL Value,Header Value,Severity,Match Confidence,Summary,Evidence Page,Evidence Quote',
  ];
  for (const r of report.rows) {
    lines.push(
      [
        esc(r.item),
        esc(r.attribute),
        esc(r.specValue),
        esc(r.rtlValue),
        esc(r.headerValue),
        esc(r.severity.toUpperCase()),
        esc(`${Math.round(r.matchConfidence * 100)}%`),
        esc(r.summary),
        esc(r.evidencePage ?? ''),
        esc(r.evidenceQuote ?? ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

/**
 * Exports CrossCheckReport to Markdown format.
 */
export function exportCrossCheckMarkdown(report: CrossCheckReport, ipName: string): string {
  const lines: string[] = [];
  lines.push(`# ${ipName} Cross-Artifact Consistency Report`);
  lines.push('');
  lines.push(
    `- **Critical Mismatches**: ${report.criticalCount} · **Major Mismatches**: ${report.majorCount} · **Minor Differences**: ${report.minorCount} · **Verified Matches**: ${report.matchCount}`
  );
  lines.push('');
  lines.push(`| Item | Spec Value | RTL Value | Header Value | Severity | Confidence | Evidence |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
  for (const r of report.rows) {
    lines.push(
      `| **${r.item}** | \`${r.specValue}\` | \`${r.rtlValue}\` | \`${r.headerValue}\` | **${r.severity.toUpperCase()}** | ${Math.round(r.matchConfidence * 100)}% | p.${r.evidencePage ?? '—'}: *${r.evidenceQuote ?? ''}* |`
    );
  }
  return lines.join('\n');
}
