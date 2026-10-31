import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeOcrHexAndBitArtifacts,
  parseOcrTranscriptDeterministic,
  runOcrFallbackForSection,
} from './ocr.ts';
import { runSectionExtractionPass, SectionProgress } from './extract.ts';
import { DEMO_SPEC_PRESETS, DemoPresetId } from './demoData.ts';
import { validateIPSpec } from '../validators/index.ts';

const PRESET_IDS: DemoPresetId[] = ['uart_16550', 'apb_timer_pwm', 'qspi_xip'];

describe('OCR Fallback Mechanism for Image-Based / Scanned PDF Sections', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes OCR character artifacts in hexadecimal values, bit ranges, and access modes', () => {
    const noisyOcrSnippet = `
      2.1 CTRL — Master Control Register
      Address Offset: Ox0O | Width: 32 bits | Reset Value: 0xO0O100O1
      - Bits [3l:l6] CLK_PRESCALE (Access: R/W, Reset: OxO1): Clock prescaler.
      - Bit [I] IRQ_STAT (Access: WlC, Reset: 0xO): Write 1 to clear status.
      - Bit [O] READY (Access: R0, Reset: OxI): Ready flag.
    `;

    const cleaned = normalizeOcrHexAndBitArtifacts(noisyOcrSnippet);
    expect(cleaned).toContain('Address Offset: 0x00');
    expect(cleaned).toContain('Reset Value: 0x00010001');
    expect(cleaned).toContain('Bits [31:16] CLK_PRESCALE (Access: RW, Reset: 0x01)');
    expect(cleaned).toContain('Bit [1] IRQ_STAT (Access: W1C, Reset: 0x0)');
    expect(cleaned).toContain('Bit [0] READY (Access: RO, Reset: 0x1)');
  });

  it('parses noisy OCR transcripts deterministically into valid canonical registers and fields', () => {
    const noisyOcrTranscript = `
      2.1 QSPI_CFG — Master QSPI & XIP Mode Configuration Register
      Address Offset: OxOO | Width: 32 bits | Reset Value: 0xOOO4OOOI
      Description: Configures SPI clock phase, lane width, and XIP enable.
      - Bits [3l:24] RESERVED (Access: RESERVED, Reset: OxO): Reserved bits.
      - Bits [23:l6] SCLK_DIV (Access: R/W, Reset: 0xO4): Serial clock divider.
      - Bits [l5:6] RESERVED_2 (Access: RESERVED, Reset: OxO): Reserved bits.
      - Bits [5:4] LANE_WIDTH (Access: RW, Reset: OxO): I/O lane mode.
      - Bit [3] DDR_EN (Access: RW, Reset: OxO): DDR enable.
      - Bit [2] CPOL_CPHA (Access: RW, Reset: OxO): SPI Mode select.
      - Bit [I] XIP_EN (Access: RW, Reset: OxO): XIP enable.
      - Bit [O] CTRL_EN (Access: RW, Reset: OxI): Master enable.
    `;

    const parsed = parseOcrTranscriptDeterministic(
      [{ pageNumber: 2, text: noisyOcrTranscript, confidence: 0.89 }],
      {
        id: 'sec-ocr-test',
        title: '2.1 Register Map',
        startPage: 2,
        endPage: 2,
        hasRegisters: true,
        hasTiming: false,
        hasRequirements: false,
        summary: 'Scanned register table',
      }
    );

    expect(parsed.registers).toHaveLength(1);
    const reg = parsed.registers[0];
    expect(reg.name).toBe('QSPI_CFG');
    expect(reg.offset).toBe('0x00');
    expect(reg.resetValue).toBe('0x00040001');
    expect(reg.fields).toHaveLength(8);
    expect(reg.fields[1].name).toBe('SCLK_DIV');
    expect(reg.fields[1].msb).toBe(23);
    expect(reg.fields[1].lsb).toBe(16);
    expect(reg.fields[1].resetValue).toBe('0x4');

    const report = validateIPSpec({
      name: 'QSPI_XIP_CTRL',
      version: 'v3.0',
      busWidth: 32,
      baseAddress: '0x50000000',
      registers: parsed.registers,
      timingParameters: [],
      requirements: [],
    });
    expect(report.errorCount).toBe(0);
    expect(report.valid).toBe(true);
  });

  it.each(PRESET_IDS)(
    'Preset "%s": recovers 100% of registers via OCR fallback when Gemini native PDF extraction returns 0 registers on image-based sections',
    async (presetId) => {
      const preset = DEMO_SPEC_PRESETS[presetId];

      // Mock fetch so primary /api/pipeline/extract returns empty registers (simulating an image-only scanned PDF table that native extraction missed)
      // and /api/pipeline/ocr-extract falls back to our deterministic OCR parser
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (String(url).includes('/api/pipeline/extract')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                ipName: preset.spec.name,
                ipVersion: preset.spec.version,
                busWidth: preset.spec.busWidth,
                baseAddress: preset.spec.baseAddress,
                registers: [], // 0 registers extracted natively -> must trigger OCR fallback!
                timingParameters: [],
                requirements: [],
              }),
            };
          }
          // Simulate offline or fallback on /api/pipeline/ocr-extract so deterministic OCR parser is also exercised
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: 'Simulated vision offline' }),
          };
        })
      );

      let latestProgress: SectionProgress[] = [];
      const extractedSpec = await runSectionExtractionPass({
        docMap: preset.docMap,
        scannedPageTexts: preset.pagesText,
        onProgress: (prog) => {
          latestProgress = prog;
        },
      });

      // Verify every register in the specification was recovered by the OCR fallback!
      expect(extractedSpec.registers.length).toBe(preset.spec.registers.length);
      expect(extractedSpec.timingParameters.length).toBe(
        preset.spec.timingParameters.length
      );
      expect(extractedSpec.requirements.length).toBe(
        preset.spec.requirements.length
      );

      // Verify telemetry flagged usedOcrFallback = true on register sections
      const regSections = latestProgress.filter(
        (sp) =>
          preset.docMap.sections.find((s) => s.id === sp.sectionId)?.hasRegisters
      );
      expect(regSections.length).toBeGreaterThan(0);
      for (const rs of regSections) {
        expect(rs.usedOcrFallback).toBe(true);
        expect(rs.registersFound).toBeGreaterThan(0);
      }

      // Verify the OCR-recovered IPSpec passes all deterministic hardware validations with 0 errors
      const valReport = validateIPSpec(extractedSpec);
      expect(valReport.errorCount).toBe(0);
      expect(valReport.valid).toBe(true);
    }
  );
});
