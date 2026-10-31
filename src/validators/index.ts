import {
  IPSpec,
  Register,
  Field,
  ValidationIssue,
  ValidationReport,
  VALID_ACCESS_TYPES,
  AccessType,
} from '../schema/index.ts';

/**
 * Parses a hex, binary, or decimal numeric string into a BigInt.
 * Supports Verilog-style literals (e.g., 32'h0000_0001, 4'b1010, 0x1A_2B).
 * Returns null if null/empty or unparseable.
 */
export function parseNumericValue(raw: string | number | null | undefined): bigint | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return BigInt(Math.floor(raw));
  }
  const cleaned = raw.trim().replace(/_/g, '');
  if (!cleaned) return null;

  // Verilog style: <width>'h<hex>, <width>'b<bin>, <width>'d<dec>
  const verilogMatch = cleaned.match(/^\d*'(s?[hbdo])([0-9a-fA-F]+)$/i);
  if (verilogMatch) {
    const baseChar = verilogMatch[1].toLowerCase().replace('s', '');
    const digits = verilogMatch[2];
    try {
      if (baseChar === 'h') return BigInt('0x' + digits);
      if (baseChar === 'b') return BigInt('0b' + digits);
      if (baseChar === 'o') return BigInt('0o' + digits);
      if (baseChar === 'd') return BigInt(digits);
    } catch {
      return null;
    }
  }

  try {
    if (/^0x[0-9a-fA-F]+$/i.test(cleaned)) {
      return BigInt(cleaned);
    }
    if (/^0b[01]+$/i.test(cleaned)) {
      return BigInt(cleaned);
    }
    if (/^[0-9]+$/.test(cleaned)) {
      return BigInt(cleaned);
    }
    // Plain hex string if it contains a-f and ends/starts cleanly
    if (/^[0-9a-fA-F]+h$/i.test(cleaned)) {
      return BigInt('0x' + cleaned.slice(0, -1));
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Formats a BigInt as a canonical hex string with optional minimum bit width padding.
 */
export function formatHex(val: bigint, widthBits?: number): string {
  const hexDigits = widthBits ? Math.ceil(widthBits / 4) : 0;
  const rawHex = val.toString(16).toUpperCase();
  if (hexDigits > 0) {
    return '0x' + rawHex.padStart(hexDigits, '0');
  }
  return '0x' + rawHex;
}

/**
 * Validates a single Register and returns all deterministic issues found.
 */
export function validateRegister(
  reg: Register,
  busWidth: number = 32
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const regName = reg.name?.trim() || 'UNNAMED_REG';
  const effectiveWidth = reg.width ?? busWidth ?? 32;

  // Check missing register-level metadata
  if (!reg.offset) {
    issues.push({
      id: `${regName}-missing-offset`,
      code: 'MISSING_REQUIRED_VALUE',
      severity: 'error',
      registerName: regName,
      registerOffset: reg.offset,
      message: `Register ${regName} has no address offset specified in the spec.`,
      suggestion: 'Verify the register offset on the source page or set it manually.',
    });
  } else {
    const offsetVal = parseNumericValue(reg.offset);
    if (offsetVal === null) {
      issues.push({
        id: `${regName}-invalid-offset-format`,
        code: 'MISSING_REQUIRED_VALUE',
        severity: 'error',
        registerName: regName,
        registerOffset: reg.offset,
        message: `Register ${regName} offset "${reg.offset}" is not a valid hexadecimal or integer address.`,
      });
    } else {
      // Alignment check: offset must be aligned to bus width in bytes
      const alignmentBytes = BigInt(Math.max(1, Math.floor((busWidth || 32) / 8)));
      if (offsetVal % alignmentBytes !== 0n) {
        issues.push({
          id: `${regName}-unaligned-offset`,
          code: 'UNALIGNED_OFFSET',
          severity: 'error',
          registerName: regName,
          registerOffset: reg.offset,
          message: `Register ${regName} offset ${reg.offset} is not aligned to ${busWidth}-bit (${alignmentBytes}-byte) boundary.`,
          suggestion: `Align offset to a multiple of 0x${alignmentBytes.toString(16).toUpperCase()}.`,
        });
      }
    }
  }

  if (reg.width === null || reg.width === undefined) {
    issues.push({
      id: `${regName}-missing-width`,
      code: 'MISSING_REQUIRED_VALUE',
      severity: 'warning',
      registerName: regName,
      registerOffset: reg.offset,
      message: `Register ${regName} width is not explicitly stated (defaulting to ${busWidth} bits).`,
    });
  }

  // Track duplicate field names within register
  const seenFieldNames = new Set<string>();
  const validPositionedFields: Array<{ field: Field; msb: number; lsb: number }> = [];

  for (let i = 0; i < reg.fields.length; i++) {
    const field = reg.fields[i];
    const fName = field.name?.trim() || `FIELD_${i}`;
    const normFieldName = fName.toUpperCase();

    if (normFieldName !== 'RESERVED' && normFieldName !== 'RSVD') {
      if (seenFieldNames.has(normFieldName)) {
        issues.push({
          id: `${regName}-${fName}-dup-${i}`,
          code: 'DUPLICATE_FIELD_NAME',
          severity: 'error',
          registerName: regName,
          registerOffset: reg.offset,
          fieldName: fName,
          message: `Duplicate field name "${fName}" in register ${regName}.`,
          suggestion: `Rename duplicate field "${fName}" to a unique identifier.`,
        });
      }
      seenFieldNames.add(normFieldName);
    }

    // Access type validation
    if (!field.access) {
      issues.push({
        id: `${regName}-${fName}-missing-access`,
        code: 'MISSING_REQUIRED_VALUE',
        severity: 'warning',
        registerName: regName,
        registerOffset: reg.offset,
        fieldName: fName,
        message: `Field ${regName}.${fName} access type is not specified in spec.`,
      });
    } else {
      const upperAccess = field.access.trim().toUpperCase() as AccessType;
      if (!VALID_ACCESS_TYPES.includes(upperAccess)) {
        issues.push({
          id: `${regName}-${fName}-illegal-access`,
          code: 'ILLEGAL_ACCESS_TYPE',
          severity: 'error',
          registerName: regName,
          registerOffset: reg.offset,
          fieldName: fName,
          message: `Field ${regName}.${fName} has illegal access type "${field.access}". Allowed: ${VALID_ACCESS_TYPES.join(', ')}.`,
          suggestion: `Change access type to one of: ${VALID_ACCESS_TYPES.join(', ')}.`,
        });
      }
    }

    // Bit range checks
    if (field.msb === null || field.lsb === null || field.msb === undefined || field.lsb === undefined) {
      issues.push({
        id: `${regName}-${fName}-missing-bits`,
        code: 'MISSING_REQUIRED_VALUE',
        severity: 'error',
        registerName: regName,
        registerOffset: reg.offset,
        fieldName: fName,
        message: `Field ${regName}.${fName} is missing MSB or LSB bit position.`,
      });
      continue;
    }

    const { msb, lsb } = field;

    // Check 1: msb >= lsb
    if (msb < lsb) {
      issues.push({
        id: `${regName}-${fName}-bit-order`,
        code: 'INVALID_BIT_ORDER',
        severity: 'error',
        registerName: regName,
        registerOffset: reg.offset,
        fieldName: fName,
        message: `Field ${regName}.${fName} has inverted bit range [${msb}:${lsb}] (msb ${msb} < lsb ${lsb}).`,
        suggestion: `Swap MSB and LSB to [${lsb}:${msb}].`,
      });
      continue;
    }

    // Check 2: field fits within register width [effectiveWidth - 1 : 0]
    if (lsb < 0 || msb >= effectiveWidth) {
      issues.push({
        id: `${regName}-${fName}-exceeds-width`,
        code: 'FIELD_EXCEEDS_WIDTH',
        severity: 'error',
        registerName: regName,
        registerOffset: reg.offset,
        fieldName: fName,
        message: `Field ${regName}.${fName} [${msb}:${lsb}] exceeds ${effectiveWidth}-bit register width (valid bits 0..${effectiveWidth - 1}).`,
        suggestion: `Adjust field bit range to fit within [${effectiveWidth - 1}:0] or verify register width.`,
      });
    }

    // Check 3: field reset value fits within field width
    const fieldWidth = msb - lsb + 1;
    if (field.resetValue !== null && field.resetValue !== undefined && field.resetValue !== '') {
      const fReset = parseNumericValue(field.resetValue);
      if (fReset === null) {
        issues.push({
          id: `${regName}-${fName}-bad-reset-syntax`,
          code: 'FIELD_RESET_OVERFLOW',
          severity: 'error',
          registerName: regName,
          registerOffset: reg.offset,
          fieldName: fName,
          message: `Field ${regName}.${fName} reset value "${field.resetValue}" is not a valid numeric literal.`,
        });
      } else {
        const maxFieldVal = (1n << BigInt(fieldWidth)) - 1n;
        if (fReset > maxFieldVal || fReset < 0n) {
          issues.push({
            id: `${regName}-${fName}-reset-overflow`,
            code: 'FIELD_RESET_OVERFLOW',
            severity: 'error',
            registerName: regName,
            registerOffset: reg.offset,
            fieldName: fName,
            message: `Field ${regName}.${fName} [${msb}:${lsb}] (${fieldWidth}-bit) has reset value ${field.resetValue} (${formatHex(fReset)}), which exceeds maximum value ${formatHex(maxFieldVal)}.`,
            suggestion: `Clamp reset value to fit within ${fieldWidth} bits (<= ${formatHex(maxFieldVal)}) or widen field bit range.`,
          });
        }
      }
    }

    validPositionedFields.push({ field, msb, lsb });
  }

  // Check 4: Overlapping field bit ranges
  for (let i = 0; i < validPositionedFields.length; i++) {
    for (let j = i + 1; j < validPositionedFields.length; j++) {
      const a = validPositionedFields[i];
      const b = validPositionedFields[j];
      const overlapLow = Math.max(a.lsb, b.lsb);
      const overlapHigh = Math.min(a.msb, b.msb);
      if (overlapLow <= overlapHigh) {
        const rangeStr = overlapLow === overlapHigh ? `bit ${overlapLow}` : `bits [${overlapHigh}:${overlapLow}]`;
        issues.push({
          id: `${regName}-overlap-${a.field.name}-${b.field.name}`,
          code: 'OVERLAPPING_FIELDS',
          severity: 'error',
          registerName: regName,
          registerOffset: reg.offset,
          fieldName: `${a.field.name}, ${b.field.name}`,
          message: `Fields ${regName}.${a.field.name} [${a.msb}:${a.lsb}] and ${regName}.${b.field.name} [${b.msb}:${b.lsb}] overlap at ${rangeStr}.`,
          suggestion: `Check source bit positions for ${a.field.name} and ${b.field.name} to resolve overlap at ${rangeStr}.`,
        });
      }
    }
  }

  // Check 5: Register reset must equal composed field resets (when register reset and at least one non-null field reset exist)
  if (reg.resetValue !== null && reg.resetValue !== undefined && reg.resetValue !== '') {
    const regReset = parseNumericValue(reg.resetValue);
    if (regReset !== null && validPositionedFields.length > 0) {
      let allFieldsHaveReset = true;
      let composedReset = 0n;

      for (const { field, msb, lsb } of validPositionedFields) {
        const width = msb - lsb + 1;
        const mask = (1n << BigInt(width)) - 1n;
        const isReserved = field.access?.toUpperCase() === 'RESERVED' || field.name.toUpperCase().startsWith('RESERVED');
        if (field.resetValue === null || field.resetValue === undefined || field.resetValue === '') {
          if (!isReserved) {
            allFieldsHaveReset = false;
          }
          continue;
        }
        const fReset = parseNumericValue(field.resetValue);
        if (fReset === null) {
          allFieldsHaveReset = false;
          continue;
        }
        composedReset |= (fReset & mask) << BigInt(lsb);
      }

      if (allFieldsHaveReset && composedReset !== regReset) {
        issues.push({
          id: `${regName}-reset-mismatch`,
          code: 'RESET_COMPOSITION_MISMATCH',
          severity: 'error',
          registerName: regName,
          registerOffset: reg.offset,
          message: `Register ${regName} reset value ${formatHex(regReset, effectiveWidth)} does not match composed field reset values ${formatHex(composedReset, effectiveWidth)}.`,
          suggestion: `Update register reset to ${formatHex(composedReset, effectiveWidth)} or correct individual field reset values.`,
        });
      }
    }
  }

  // Check 6: Unaccounted bit gaps (Warning, suggest RESERVED)
  if (validPositionedFields.length > 0 && effectiveWidth > 0 && effectiveWidth <= 128) {
    const covered = new Array<boolean>(effectiveWidth).fill(false);
    for (const { msb, lsb } of validPositionedFields) {
      const clampedLow = Math.max(0, lsb);
      const clampedHigh = Math.min(effectiveWidth - 1, msb);
      for (let b = clampedLow; b <= clampedHigh; b++) {
        covered[b] = true;
      }
    }

    const gaps: Array<{ msb: number; lsb: number }> = [];
    let gapStart: number | null = null;
    for (let b = 0; b < effectiveWidth; b++) {
      if (!covered[b] && gapStart === null) {
        gapStart = b;
      } else if (covered[b] && gapStart !== null) {
        gaps.push({ msb: b - 1, lsb: gapStart });
        gapStart = null;
      }
    }
    if (gapStart !== null) {
      gaps.push({ msb: effectiveWidth - 1, lsb: gapStart });
    }

    if (gaps.length > 0) {
      const gapDesc = gaps
        .slice()
        .reverse()
        .map((g) => (g.msb === g.lsb ? `[${g.msb}]` : `[${g.msb}:${g.lsb}]`))
        .join(', ');
      issues.push({
        id: `${regName}-bit-gaps`,
        code: 'UNACCOUNTED_BIT_GAP',
        severity: 'warning',
        registerName: regName,
        registerOffset: reg.offset,
        message: `Register ${regName} has unaccounted bit positions: ${gapDesc}.`,
        suggestion: `Add explicit RESERVED field(s) for ${gapDesc}.`,
      });
    }
  }

  return issues;
}

/**
 * Validates the complete IPSpec and returns a comprehensive ValidationReport.
 */
export function validateIPSpec(spec: IPSpec): ValidationReport {
  const issues: ValidationIssue[] = [];
  const issuesByRegister: Record<string, ValidationIssue[]> = {};
  const busWidth = spec.busWidth || 32;
  const strideBytes = BigInt(Math.max(1, Math.floor(busWidth / 8)));

  const seenRegNames = new Map<string, string>(); // normalized name -> first original name
  const seenOffsets = new Map<bigint, string[]>(); // offset -> list of register names

  for (const reg of spec.registers) {
    const regKey = reg.name;
    const regIssues = validateRegister(reg, busWidth);

    // Check duplicate register names
    const normName = reg.name.trim().toUpperCase();
    if (seenRegNames.has(normName)) {
      const dupIssue: ValidationIssue = {
        id: `${reg.name}-dup-reg-name`,
        code: 'DUPLICATE_REGISTER_NAME',
        severity: 'error',
        registerName: reg.name,
        registerOffset: reg.offset,
        message: `Duplicate register name "${reg.name}" across specification.`,
        suggestion: 'Ensure each register has a unique canonical name or index suffix.',
      };
      regIssues.push(dupIssue);
    } else {
      seenRegNames.set(normName, reg.name);
    }

    // Track offsets for collision & gap checks
    const offsetVal = parseNumericValue(reg.offset);
    if (offsetVal !== null) {
      const list = seenOffsets.get(offsetVal) ?? [];
      list.push(reg.name);
      seenOffsets.set(offsetVal, list);
    }

    issuesByRegister[regKey] = regIssues;
    issues.push(...regIssues);
  }

  // Check offset collisions across registers
  for (const [offsetVal, regNames] of seenOffsets.entries()) {
    if (regNames.length > 1) {
      const hexOff = formatHex(offsetVal, 8);
      for (const rName of regNames) {
        const collisionIssue: ValidationIssue = {
          id: `collision-${hexOff}-${rName}`,
          code: 'OFFSET_COLLISION',
          severity: 'error',
          registerName: rName,
          registerOffset: hexOff,
          message: `Register offset collision at ${hexOff} shared by registers: ${regNames.join(', ')}.`,
          suggestion: `Assign distinct ${busWidth}-bit aligned offsets to ${regNames.join(' and ')}.`,
        };
        issues.push(collisionIssue);
        if (!issuesByRegister[rName]) issuesByRegister[rName] = [];
        issuesByRegister[rName].push(collisionIssue);
      }
    }
  }

  // Check offset gaps (info severity)
  const sortedOffsets = Array.from(seenOffsets.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < sortedOffsets.length - 1; i++) {
    const curr = sortedOffsets[i];
    const next = sortedOffsets[i + 1];
    const expectedNext = curr + strideBytes;
    if (next > expectedNext) {
      const gapStart = formatHex(expectedNext, 8);
      const gapEnd = formatHex(next - strideBytes, 8);
      const nextRegName = seenOffsets.get(next)?.[0];
      const gapIssue: ValidationIssue = {
        id: `offset-gap-${gapStart}-${gapEnd}`,
        code: 'OFFSET_GAP',
        severity: 'info',
        registerName: nextRegName,
        registerOffset: formatHex(next, 8),
        message:
          expectedNext === next - strideBytes
            ? `Unmapped address gap at offset ${gapStart} before ${nextRegName}.`
            : `Unmapped address range ${gapStart}..${gapEnd} (${Number((next - expectedNext) / strideBytes)} words) before ${nextRegName}.`,
      };
      issues.push(gapIssue);
      if (nextRegName) {
        if (!issuesByRegister[nextRegName]) issuesByRegister[nextRegName] = [];
        issuesByRegister[nextRegName].push(gapIssue);
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return {
    valid: errorCount === 0,
    issues,
    errorCount,
    warningCount,
    infoCount,
    issuesByRegister,
  };
}

/**
 * Helper to auto-fill unaccounted bit gaps in a register with RESERVED fields.
 */
export function fillReservedBitGaps(reg: Register, busWidth: number = 32): Register {
  const effectiveWidth = reg.width ?? busWidth ?? 32;
  const covered = new Array<boolean>(effectiveWidth).fill(false);

  for (const f of reg.fields) {
    if (f.msb !== null && f.lsb !== null && f.msb >= f.lsb) {
      for (let b = Math.max(0, f.lsb); b <= Math.min(effectiveWidth - 1, f.msb); b++) {
        covered[b] = true;
      }
    }
  }

  const newFields: Field[] = [...reg.fields];
  let gapStart: number | null = null;
  let rsvdIdx = 0;

  const pushGap = (msb: number, lsb: number) => {
    rsvdIdx++;
    newFields.push({
      name: rsvdIdx === 1 ? 'RESERVED' : `RESERVED_${rsvdIdx}`,
      msb,
      lsb,
      access: 'RESERVED',
      resetValue: '0x0',
      description: 'Reserved bits — read as 0, write 0.',
      enumValues: [],
      evidence: reg.evidence,
    });
  };

  for (let b = 0; b < effectiveWidth; b++) {
    if (!covered[b] && gapStart === null) {
      gapStart = b;
    } else if (covered[b] && gapStart !== null) {
      pushGap(b - 1, gapStart);
      gapStart = null;
    }
  }
  if (gapStart !== null) {
    pushGap(effectiveWidth - 1, gapStart);
  }

  newFields.sort((a, b) => (b.msb ?? 0) - (a.msb ?? 0));
  return {
    ...reg,
    fields: newFields,
  };
}
