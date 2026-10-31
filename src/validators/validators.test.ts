import { describe, it, expect } from 'vitest';
import {
  validateRegister,
  validateIPSpec,
  parseNumericValue,
  fillReservedBitGaps,
} from './index.ts';
import { IPSpec, Register } from '../schema/index.ts';

const baseEvidence = { page: 4, quote: 'Table 2-1: CTRL Register (Offset 0x00)' };

function makeValidRegister(overrides?: Partial<Register>): Register {
  return {
    name: 'CTRL',
    offset: '0x00',
    width: 32,
    description: 'Control Register',
    resetValue: '0x00000001',
    confidence: 0.98,
    evidence: baseEvidence,
    fields: [
      {
        name: 'RESERVED',
        msb: 31,
        lsb: 2,
        access: 'RESERVED',
        resetValue: '0x0',
        description: 'Reserved',
        enumValues: [],
        evidence: baseEvidence,
      },
      {
        name: 'IRQ_EN',
        msb: 1,
        lsb: 1,
        access: 'RW',
        resetValue: '0x0',
        description: 'Interrupt Enable',
        enumValues: [],
        evidence: baseEvidence,
      },
      {
        name: 'ENABLE',
        msb: 0,
        lsb: 0,
        access: 'RW',
        resetValue: '0x1',
        description: 'Block Enable',
        enumValues: [],
        evidence: baseEvidence,
      },
    ],
    ...overrides,
  };
}

describe('Deterministic Register & IP Validator', () => {
  it('parses hex, binary, decimal, and Verilog numeric literals', () => {
    expect(parseNumericValue('0x0000_0010')).toBe(16n);
    expect(parseNumericValue("32'h0000_0100")).toBe(256n);
    expect(parseNumericValue("4'b1010")).toBe(10n);
    expect(parseNumericValue('42')).toBe(42n);
    expect(parseNumericValue(null)).toBeNull();
  });

  it('passes a valid register with zero errors or warnings', () => {
    const reg = makeValidRegister();
    const issues = validateRegister(reg, 32);
    expect(issues).toHaveLength(0);
  });

  it('detects overlapping field bit ranges', () => {
    const reg = makeValidRegister({
      fields: [
        {
          name: 'MODE',
          msb: 4,
          lsb: 1,
          access: 'RW',
          resetValue: '0x0',
          description: 'Mode select',
          enumValues: [],
          evidence: baseEvidence,
        },
        {
          name: 'ENABLE',
          msb: 2,
          lsb: 0,
          access: 'RW',
          resetValue: '0x1',
          description: 'Enable',
          enumValues: [],
          evidence: baseEvidence,
        },
      ],
    });
    const issues = validateRegister(reg, 32);
    expect(issues.some((i) => i.code === 'OVERLAPPING_FIELDS')).toBe(true);
  });

  it('detects inverted bit order (msb < lsb)', () => {
    const reg = makeValidRegister({
      fields: [
        {
          name: 'BAD_ORDER',
          msb: 2,
          lsb: 5,
          access: 'RW',
          resetValue: '0x0',
          description: 'Inverted bits',
          enumValues: [],
          evidence: baseEvidence,
        },
      ],
    });
    const issues = validateRegister(reg, 32);
    expect(issues.some((i) => i.code === 'INVALID_BIT_ORDER')).toBe(true);
  });

  it('detects field exceeding register width', () => {
    const reg = makeValidRegister({
      width: 32,
      fields: [
        {
          name: 'OUT_OF_BOUNDS',
          msb: 35,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0',
          description: 'Exceeds 32 bits',
          enumValues: [],
          evidence: baseEvidence,
        },
      ],
    });
    const issues = validateRegister(reg, 32);
    expect(issues.some((i) => i.code === 'FIELD_EXCEEDS_WIDTH')).toBe(true);
  });

  it('detects field reset value overflow and register reset composition mismatch', () => {
    const reg = makeValidRegister({
      resetValue: '0x000000FF', // Does not match composed field resets
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 2,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved',
          enumValues: [],
          evidence: baseEvidence,
        },
        {
          name: 'TWO_BIT_FIELD',
          msb: 1,
          lsb: 0,
          access: 'RW',
          resetValue: '0x7', // 3 bits in a 2-bit field!
          description: 'Overflow reset',
          enumValues: [],
          evidence: baseEvidence,
        },
      ],
    });
    const issues = validateRegister(reg, 32);
    expect(issues.some((i) => i.code === 'FIELD_RESET_OVERFLOW')).toBe(true);
    expect(issues.some((i) => i.code === 'RESET_COMPOSITION_MISMATCH')).toBe(true);
  });

  it('detects unaligned offsets, offset collisions, duplicate names, and offset gaps', () => {
    const spec: IPSpec = {
      name: 'TEST_IP',
      version: '1.0',
      busWidth: 32,
      baseAddress: '0x40000000',
      timingParameters: [],
      requirements: [],
      registers: [
        makeValidRegister({ name: 'CTRL', offset: '0x00' }),
        makeValidRegister({ name: 'CTRL', offset: '0x00' }), // Duplicate name + colliding offset
        makeValidRegister({ name: 'STATUS', offset: '0x02' }), // Unaligned to 4-byte bus
        makeValidRegister({ name: 'FIFO_DATA', offset: '0x0C' }), // Gap between 0x00 and 0x0C
      ],
    };
    const report = validateIPSpec(spec);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'DUPLICATE_REGISTER_NAME')).toBe(true);
    expect(report.issues.some((i) => i.code === 'OFFSET_COLLISION')).toBe(true);
    expect(report.issues.some((i) => i.code === 'UNALIGNED_OFFSET')).toBe(true);
    expect(report.issues.some((i) => i.code === 'OFFSET_GAP')).toBe(true);
  });

  it('warns on unaccounted bit gaps and can auto-fill RESERVED fields', () => {
    const reg = makeValidRegister({
      resetValue: '0x00000001',
      fields: [
        {
          name: 'ENABLE',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x1',
          description: 'Enable',
          enumValues: [],
          evidence: baseEvidence,
        },
      ],
    });
    const issuesBefore = validateRegister(reg, 32);
    expect(issuesBefore.some((i) => i.code === 'UNACCOUNTED_BIT_GAP')).toBe(true);

    const filled = fillReservedBitGaps(reg, 32);
    const issuesAfter = validateRegister(filled, 32);
    expect(issuesAfter.some((i) => i.code === 'UNACCOUNTED_BIT_GAP')).toBe(false);
  });
});
