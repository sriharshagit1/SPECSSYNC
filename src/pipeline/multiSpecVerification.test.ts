import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  DEMO_SPEC_PRESETS,
  DemoPresetId,
  generateDemoPdfBytes,
} from './demoData.ts';
import { slicePdfPages } from './map.ts';
import { mergeAndDedupeRegisters } from './extract.ts';
import { validateIPSpec } from '../validators/index.ts';
import { generateAllArtifacts } from '../generators/index.ts';
import {
  parseCHeaderDeterministic,
  parseRTLDeterministic,
  runCrossArtifactCheck,
  exportCrossCheckCSV,
  exportCrossCheckMarkdown,
} from '../crosscheck/index.ts';
import { computeSpecRevisionDiff } from '../diff/index.ts';
import { evaluateAgainstGroundTruth } from '../eval/index.ts';

const PRESET_IDS: DemoPresetId[] = ['uart_16550', 'apb_timer_pwm', 'qspi_xip'];

describe('Multi-Spec End-to-End Verification Suite (AXI_UART_16550, APB_DUAL_TIMER_PWM, QSPI_XIP_CTRL)', () => {
  it.each(PRESET_IDS)(
    'Preset "%s": generates valid multi-page PDF and slices section page ranges with pdf-lib',
    async (presetId) => {
      const preset = DEMO_SPEC_PRESETS[presetId];
      const pdfBytes = await generateDemoPdfBytes(preset.pagesText);
      expect(pdfBytes.byteLength).toBeGreaterThan(500);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBe(preset.pagesText.length);
      expect(loadedDoc.getPageCount()).toBe(preset.docMap.totalPages);

      // Verify pdf-lib slicing for every flagged section in docMap
      for (const section of preset.docMap.sections) {
        const sliced = await slicePdfPages(
          pdfBytes,
          section.startPage,
          section.endPage
        );
        expect(sliced.base64.length).toBeGreaterThan(100);
        const expectedPages = section.endPage - section.startPage + 1;
        expect(sliced.pageCount).toBe(expectedPages);

        const subDoc = await PDFDocument.load(sliced.base64);
        expect(subDoc.getPageCount()).toBe(expectedPages);
      }
    }
  );

  it.each(PRESET_IDS)(
    'Preset "%s": passes all deterministic validator rules with 0 errors on both v1 and v2 specs',
    (presetId) => {
      const preset = DEMO_SPEC_PRESETS[presetId];

      const v1Report = validateIPSpec(preset.spec);
      expect(v1Report.errorCount).toBe(0);
      expect(v1Report.valid).toBe(true);

      const v2Report = validateIPSpec(preset.specV2);
      expect(v2Report.errorCount).toBe(0);
      expect(v2Report.valid).toBe(true);

      // Every register and field carries page + verbatim quote evidence
      for (const reg of preset.spec.registers) {
        expect(reg.evidence.page).toBeGreaterThanOrEqual(1);
        expect(reg.evidence.page).toBeLessThanOrEqual(preset.pagesText.length);
        expect(reg.evidence.quote.length).toBeGreaterThan(5);
        for (const field of reg.fields) {
          expect(field.evidence.page).toBeGreaterThanOrEqual(1);
          expect(field.evidence.quote.length).toBeGreaterThan(3);
        }
      }
    }
  );

  it.each(PRESET_IDS)(
    'Preset "%s": generates all 8 deterministic output formats and round-trips generated C header with 0 mismatches',
    (presetId) => {
      const preset = DEMO_SPEC_PRESETS[presetId];
      const artifacts = generateAllArtifacts(preset.spec);
      expect(artifacts).toHaveLength(8);

      for (const art of artifacts) {
        expect(art.content.length).toBeGreaterThan(50);
        expect(art.filename).toContain(preset.spec.name.toLowerCase());
      }

      // Verify generated C header round-trips through deterministic C #define parser with 0 critical/major mismatches
      const cHeaderArtifact = artifacts.find((a) => a.format === 'c_header')!;
      expect(cHeaderArtifact).toBeDefined();

      const parsedHeader = parseCHeaderDeterministic(
        cHeaderArtifact.content,
        preset.spec.name
      );
      expect(parsedHeader.registers.length).toBe(preset.spec.registers.length);

      const roundTripCheck = runCrossArtifactCheck(
        preset.spec,
        [],
        parsedHeader.registers,
        [],
        parsedHeader.unparseableLines
      );
      expect(roundTripCheck.criticalCount).toBe(0);
      expect(roundTripCheck.majorCount).toBe(0);
    }
  );

  it('Cross-Artifact Consistency Checker catches seeded RTL & C header bugs in APB_DUAL_TIMER_PWM', () => {
    const preset = DEMO_SPEC_PRESETS.apb_timer_pwm;
    const rtlRegs = parseRTLDeterministic(preset.rtlCode, preset.spec.name);
    const hdrParsed = parseCHeaderDeterministic(
      preset.cHeaderCode,
      preset.spec.name
    );

    expect(rtlRegs.length).toBe(6);
    expect(hdrParsed.registers.length).toBe(6);

    const report = runCrossArtifactCheck(
      preset.spec,
      rtlRegs,
      hdrParsed.registers,
      [],
      hdrParsed.unparseableLines
    );

    expect(report.criticalCount).toBeGreaterThanOrEqual(3);

    // 1. TMR0_LOAD reset mismatch (Spec=0xFFFFFFFF, RTL=0x00000000)
    const loadResetRow = report.rows.find(
      (r) => r.item === 'TMR0_LOAD reset' && r.severity === 'critical'
    );
    expect(loadResetRow).toBeDefined();
    expect(loadResetRow?.specValue).toBe('0xFFFFFFFF');
    expect(loadResetRow?.rtlValue).toBe('0x00000000');

    // 2. PWM_DEADTIME_CFG.DEADTIME_CYC bit range mismatch (Spec=[23:16], RTL=[21:16])
    const deadtimeBitsRow = report.rows.find(
      (r) =>
        r.item === 'PWM_DEADTIME_CFG.DEADTIME_CYC bits' &&
        r.severity === 'critical'
    );
    expect(deadtimeBitsRow).toBeDefined();
    expect(deadtimeBitsRow?.specValue).toBe('[23:16]');
    expect(deadtimeBitsRow?.rtlValue).toBe('[21:16]');

    // 3. WDT_LOCK offset mismatch in C header (Spec=0x14, Header=0x18)
    const wdtOffsetRow = report.rows.find(
      (r) => r.item === 'WDT_LOCK offset' && r.severity === 'critical'
    );
    expect(wdtOffsetRow).toBeDefined();
    expect(wdtOffsetRow?.specValue).toBe('0x14');
    expect(wdtOffsetRow?.headerValue).toBe('0x18');

    // Verify CSV & Markdown export
    const csv = exportCrossCheckCSV(report);
    const md = exportCrossCheckMarkdown(report, preset.spec.name);
    expect(csv).toContain('TMR0_LOAD reset');
    expect(md).toContain('APB_DUAL_TIMER_PWM');
  });

  it('Cross-Artifact Consistency Checker catches seeded RTL & C header bugs in QSPI_XIP_CTRL', () => {
    const preset = DEMO_SPEC_PRESETS.qspi_xip;
    const rtlRegs = parseRTLDeterministic(preset.rtlCode, preset.spec.name);
    const hdrParsed = parseCHeaderDeterministic(
      preset.cHeaderCode,
      preset.spec.name
    );

    expect(rtlRegs.length).toBe(4);
    expect(hdrParsed.registers.length).toBe(4);

    const report = runCrossArtifactCheck(
      preset.spec,
      rtlRegs,
      hdrParsed.registers,
      [],
      hdrParsed.unparseableLines
    );

    expect(report.criticalCount).toBeGreaterThanOrEqual(2);

    // 1. XIP_CMD_FMT.READ_OPCODE reset mismatch in RTL (Spec=0xEB, RTL=0x03)
    const opcodeResetRow = report.rows.find(
      (r) =>
        r.item === 'XIP_CMD_FMT.READ_OPCODE reset' && r.severity === 'critical'
    );
    expect(opcodeResetRow).toBeDefined();

    // 2. XIP_CMD_FMT.DUMMY_CYCLES bit range mismatch in C header (Spec=[28:24], Header=[27:24])
    const dummyBitsRow = report.rows.find(
      (r) =>
        r.item === 'XIP_CMD_FMT.DUMMY_CYCLES bits' && r.severity === 'critical'
    );
    expect(dummyBitsRow).toBeDefined();
    expect(dummyBitsRow?.specValue).toBe('[28:24]');
    expect(dummyBitsRow?.headerValue).toBe('[27:24]');
  });

  it.each(PRESET_IDS)(
    'Preset "%s": computes Spec Revision Diff and Ground-Truth Evaluation accurately',
    (presetId) => {
      const preset = DEMO_SPEC_PRESETS[presetId];

      // Revision Diff between v1 and v2
      const diff = computeSpecRevisionDiff(preset.spec, preset.specV2);
      expect(diff.modifiedRegisters + diff.addedRegisters).toBeGreaterThan(0);

      // Exact Ground Truth Evaluation -> 100% F1
      const exactEval = evaluateAgainstGroundTruth(preset.spec, preset.spec);
      expect(exactEval.registerScore.f1).toBe(1);
      expect(exactEval.fieldScore.f1).toBe(1);
      expect(exactEval.resetScore.f1).toBe(1);
      expect(exactEval.overallF1).toBe(1);
      expect(exactEval.discrepancies).toHaveLength(0);

      // Multi-page register merging deduplication test
      const mergedRegs = mergeAndDedupeRegisters(
        [
          ...preset.spec.registers.slice(0, 2),
          ...preset.spec.registers.slice(1), // Overlapping register at index 1
        ],
        preset.spec.name
      );
      expect(mergedRegs.length).toBe(preset.spec.registers.length);
    }
  );
});
