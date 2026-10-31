import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Play,
  Square,
  Wrench,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Sparkles,
  FileSpreadsheet,
  ScanEye,
} from 'lucide-react';
import { DocumentMap, IPSpec } from './schema/index.ts';
import { validateIPSpec } from './validators/index.ts';
import {
  DEMO_DOCUMENT_MAP,
  DEMO_IP_SPEC,
  DEMO_SPEC_PAGES_TEXT,
  DEMO_SPEC_PRESETS,
  DemoPresetId,
  generateDemoPdfBytes,
} from './pipeline/demoData.ts';
import { runDocumentMapPass } from './pipeline/map.ts';
import {
  runSectionExtractionPass,
  SectionProgress,
} from './pipeline/extract.ts';
import {
  runSelfRepairLoop,
  RepairProgressUpdate,
} from './pipeline/repair.ts';
import { PdfEvidenceViewer } from './components/PdfEvidenceViewer.tsx';
import { RegisterTableEditor } from './components/RegisterTableEditor.tsx';
import { GeneratorsView } from './components/GeneratorsView.tsx';
import { CrossCheckView } from './components/CrossCheckView.tsx';
import { RevisionDiffView } from './components/RevisionDiffView.tsx';
import { EvalView } from './components/EvalView.tsx';
import { ThemeToggle, useTheme } from './components/ThemeToggle.tsx';
import {
  evaluateAgainstGroundTruth,
  EvaluationRunResult,
} from './eval/index.ts';

type WorkspaceTab =
  | 'review'
  | 'generators'
  | 'crosscheck'
  | 'diff'
  | 'eval';

export default function App() {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('review');
  const [selectedPresetId, setSelectedPresetId] =
    useState<DemoPresetId>('uart_16550');
  const currentPreset = DEMO_SPEC_PRESETS[selectedPresetId];

  const [spec, setSpec] = useState<IPSpec>(DEMO_IP_SPEC);
  const [docMap, setDocMap] = useState<DocumentMap>(DEMO_DOCUMENT_MAP);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pagesText, setPagesText] = useState<string[]>(DEMO_SPEC_PAGES_TEXT);
  const [pdfFileName, setPdfFileName] = useState<string>(
    'AXI_UART_16550_Spec_v1.4.pdf'
  );
  const [activePage, setActivePage] = useState<number>(2);
  const [highlightQuote, setHighlightQuote] = useState<string | null>(
    DEMO_IP_SPEC.registers[0].evidence.quote
  );

  const [showPipelinePanel, setShowPipelinePanel] = useState<boolean>(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState<boolean>(false);
  const [pipelineStage, setPipelineStage] = useState<string>(
    'Ready — Canonical IR loaded (6 registers, 27 bitfields, 4 timing parameters, 6 requirements)'
  );
  const [sectionProgress, setSectionProgress] = useState<SectionProgress[]>([]);
  const [repairUpdates, setRepairUpdates] = useState<RepairProgressUpdate[]>([]);
  const [repairingRegName, setRepairingRegName] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [evalHistory, setEvalHistory] = useState<EvaluationRunResult[]>(() => [
    evaluateAgainstGroundTruth(DEMO_IP_SPEC, DEMO_IP_SPEC),
  ]);

  useEffect(() => {
    let mounted = true;
    generateDemoPdfBytes(DEMO_SPEC_PAGES_TEXT)
      .then((bytes) => {
        if (mounted) setPdfBytes(bytes);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const validationReport = useMemo(() => validateIPSpec(spec), [spec]);

  const totalRegisters = spec.registers.length;
  const totalFields = useMemo(
    () => spec.registers.reduce((acc, r) => acc + r.fields.length, 0),
    [spec]
  );
  const avgConfidence = useMemo(() => {
    if (spec.registers.length === 0) return 0;
    const sum = spec.registers.reduce((acc, r) => acc + (r.confidence ?? 1), 0);
    return Math.round((sum / spec.registers.length) * 100);
  }, [spec]);
  const autoFixedCount = useMemo(
    () =>
      spec.registers.filter((r) => r.repairStatus === 'auto-fixed').length,
    [spec]
  );

  const handleSelectPreset = async (presetId: DemoPresetId) => {
    const preset = DEMO_SPEC_PRESETS[presetId];
    setSelectedPresetId(presetId);
    setPagesText(preset.pagesText);
    const bytes = await generateDemoPdfBytes(preset.pagesText);
    setPdfBytes(bytes);
    setPdfFileName(preset.fileName);
    setSpec(preset.spec);
    setDocMap(preset.docMap);
    const firstEvPage = preset.spec.registers[0]?.evidence.page ?? 1;
    setActivePage(firstEvPage);
    setHighlightQuote(preset.spec.registers[0]?.evidence.quote ?? null);
    setSectionProgress([]);
    setRepairUpdates([]);
    setPipelineStage(
      `Spec Loaded — ${preset.spec.name} ${preset.spec.version} (${preset.spec.registers.length} registers, ${preset.spec.timingParameters.length} timing params, ${preset.spec.requirements.length} requirements)`
    );
    setEvalHistory((prev) => [
      evaluateAgainstGroundTruth(preset.spec, preset.spec),
      ...prev,
    ]);
  };

  const handleLoadDemo = async () => {
    await handleSelectPreset(selectedPresetId);
    setActiveTab('review');
  };

  const handleSelectEvidence = (page: number, quote: string) => {
    setActivePage(page);
    setHighlightQuote(quote);
    if (activeTab !== 'review') {
      setActiveTab('review');
    }
  };

  const runFullPipeline = async (
    targetPdfBytes: Uint8Array,
    fileName: string,
    optionalText?: string,
    forceOcrFallback = false
  ) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsPipelineRunning(true);
    setShowPipelinePanel(true);
    setRepairUpdates([]);

    try {
      setPipelineStage(
        `Pass 1 (Gemini Flash): Mapping chapters & classifying tables in ${fileName}...`
      );
      const mapped = await runDocumentMapPass(
        {
          pdfBytes: targetPdfBytes,
          specText: optionalText,
          fileName,
        },
        controller.signal
      );
      setDocMap(mapped);

      setPipelineStage(
        forceOcrFallback
          ? `Pass 2 + OCR Fallback: Rasterizing pages & running OCR recovery across ${mapped.sections.length} sections...`
          : `Pass 2 (Gemini Pro, concurrency=3 + Auto OCR Fallback): Extracting ${mapped.sections.length} sections...`
      );
      const extractedSpec = await runSectionExtractionPass(
        {
          docMap: mapped,
          pdfBytes: targetPdfBytes,
          specText: optionalText,
          scannedPageTexts: pagesText,
          forceOcrFallback,
          onProgress: (prog) => setSectionProgress(prog),
        },
        controller.signal
      );
      setSpec(extractedSpec);

      const initialVal = validateIPSpec(extractedSpec);
      if (initialVal.errorCount > 0) {
        setPipelineStage(
          `Self-Repair Loop: Fixing ${initialVal.errorCount} deterministic validation error(s) against source pages (max 2 retries)...`
        );
        const repairedSpec = await runSelfRepairLoop(
          {
            spec: extractedSpec,
            pdfBytes: targetPdfBytes,
            specText: optionalText,
            maxRetries: 2,
            onRepairUpdate: (upd) =>
              setRepairUpdates((prev) => [...prev, upd]),
          },
          controller.signal
        );
        setSpec(repairedSpec);
        setPipelineStage(
          `Pipeline Complete: Extracted ${repairedSpec.registers.length} registers, ${repairedSpec.timingParameters.length} timing params, ${repairedSpec.requirements.length} requirements.`
        );
      } else {
        setPipelineStage(
          `Pipeline Complete: Extracted ${extractedSpec.registers.length} registers with 0 validation errors${forceOcrFallback ? ' (via OCR Fallback)' : ''}.`
        );
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setPipelineStage('Pipeline execution cancelled by user.');
      } else {
        setPipelineStage(
          `Pipeline error: ${err?.message || 'Unexpected error during extraction'}`
        );
      }
    } finally {
      setIsPipelineRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    setPdfBytes(bytes);
    setPdfFileName(file.name);
    setActivePage(1);
    setHighlightQuote(null);
    await runFullPipeline(bytes, file.name);
  };

  const handleCancelPipeline = () => {
    abortControllerRef.current?.abort();
  };

  const handleRunSingleRegisterRepair = async (regIndex: number) => {
    const targetReg = spec.registers[regIndex];
    if (!targetReg) return;
    setRepairingRegName(targetReg.name);
    setShowPipelinePanel(true);

    try {
      const singleSpec: IPSpec = {
        ...spec,
        registers: [targetReg],
      };
      const repairedSingle = await runSelfRepairLoop({
        spec: singleSpec,
        pdfBytes: pdfBytes ?? undefined,
        specText: pagesText[(targetReg.evidence.page || 1) - 1],
        maxRetries: 2,
        onRepairUpdate: (upd) => setRepairUpdates((prev) => [...prev, upd]),
      });

      const nextRegs = [...spec.registers];
      nextRegs[regIndex] = repairedSingle.registers[0];
      setSpec({ ...spec, registers: nextRegs });
      setPipelineStage(
        `Self-Repair finished for ${targetReg.name}: status = ${repairedSingle.registers[0].repairStatus}`
      );
    } finally {
      setRepairingRegName(null);
    }
  };

  const handleInjectFaultToTestSelfRepair = () => {
    const nextRegs = [...spec.registers];
    if (nextRegs.length === 0) return;
    const firstReg = { ...nextRegs[0], fields: [...nextRegs[0].fields] };
    const targetFieldIdx = firstReg.fields.findIndex(
      (f) => f.access !== 'RESERVED'
    );
    const idx = targetFieldIdx >= 0 ? targetFieldIdx : 0;
    if (firstReg.fields[idx]) {
      const origField = firstReg.fields[idx];
      firstReg.fields[idx] = {
        ...origField,
        msb: origField.lsb ?? 0,
        lsb: (origField.msb ?? 0) + 1,
      };
    }
    firstReg.resetValue = '0x0000DEAD';
    firstReg.repairStatus = 'needs-human-review';
    nextRegs[0] = firstReg;
    setSpec({ ...spec, registers: nextRegs });
    setActivePage(firstReg.evidence.page);
    setHighlightQuote(firstReg.evidence.quote);
    setPipelineStage(
      `Injected synthetic bit-order & reset faults into ${firstReg.name} (${firstReg.offset}) — click "AI Self-Repair Register" to test Gemini self-repair.`
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* Top Bar Contract: 3-Zone Header (Brand Wordmark — 5 Nav Links — 1 Primary Action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white dark:bg-[#0E1420] border-b border-slate-200 dark:border-slate-800 transition-colors">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#review"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('review');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          SpecSync
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium overflow-x-auto">
          {(
            [
              { id: 'review', label: 'Review & Pipeline' },
              { id: 'generators', label: 'Output Generators' },
              { id: 'crosscheck', label: 'Consistency Checker' },
              { id: 'diff', label: 'Revision Diff' },
              { id: 'eval', label: 'Evaluation' },
            ] as const
          ).map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => setActiveTab(nav.id)}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === nav.id
                  ? 'border-sky-500 dark:border-sky-400 text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleLoadDemo}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Load Demo Spec
          </button>
        </div>
      </header>

      {/* Workspace Summary Telemetry Strip + Spec Selector + Theme Toggle (Light / Dark / System) */}
      <div className="px-6 py-2.5 bg-slate-100 dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs transition-colors">
        <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1.5 mr-1 font-sans">
            <FileSpreadsheet className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            <label htmlFor="spec-preset-select" className="sr-only">
              Select Demo Hardware Specification
            </label>
            <select
              id="spec-preset-select"
              value={selectedPresetId}
              onChange={(e) =>
                handleSelectPreset(e.target.value as DemoPresetId)
              }
              className="px-2 py-1 rounded bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-xs font-semibold focus:outline-none focus:border-sky-500"
            >
              {Object.values(DEMO_SPEC_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span>Base: {spec.baseAddress ?? 'not specified'}</span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span>Bus: {spec.busWidth}-bit</span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span>
            <strong className="text-slate-900 dark:text-white">{totalRegisters}</strong> Registers
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span>
            <strong className="text-slate-900 dark:text-white">{totalFields}</strong> Fields
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span
            className={
              validationReport.errorCount > 0
                ? 'text-rose-600 dark:text-rose-400 font-semibold'
                : 'text-emerald-600 dark:text-emerald-400'
            }
          >
            {validationReport.errorCount} Errors
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span
            className={
              validationReport.warningCount > 0
                ? 'text-amber-600 dark:text-amber-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400'
            }
          >
            {validationReport.warningCount} Warnings
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span className="text-sky-600 dark:text-sky-300">{autoFixedCount} Auto-Fixed</span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span>Avg Conf: {avgConfidence}%</span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-[11px]">
            <ShieldAlert className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            <span>
              All IR state stays in your browser; uploaded PDFs & RTL/headers are sent to the Gemini API for schema extraction (Temp = 0).
            </span>
          </div>

          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </div>

      {/* Main Workspace Container */}
      <main className="flex-1 flex flex-col px-6 py-4 gap-4 max-w-[1600px] w-full mx-auto">
        {activeTab === 'review' && (
          <>
            {/* Ingestion Pipeline Toolbar & Expandable Section Progress Drawer */}
            <div className="bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowPipelinePanel((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-300 hover:text-sky-500 dark:hover:text-sky-200 whitespace-nowrap shrink-0"
                  >
                    {showPipelinePanel ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    <span>2-Pass AI Ingestion & Self-Repair Pipeline</span>
                  </button>
                  <span className="text-slate-400 dark:text-slate-600">·</span>
                  <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {pipelineStage}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <button
                    type="button"
                    onClick={handleInjectFaultToTestSelfRepair}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-[#0B0F17] hover:bg-amber-100 dark:hover:bg-slate-800 text-amber-700 dark:text-amber-300 border border-amber-400/50 dark:border-amber-500/30 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                    title="Injects a bit-order & reset error into the first register so you can test the deterministic validator and Gemini Self-Repair loop"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    Simulate Extraction Fault
                  </button>

                  {!isPipelineRunning ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (pdfBytes) {
                            runFullPipeline(
                              pdfBytes,
                              pdfFileName,
                              pagesText.join('\n\n--- PAGE BREAK ---\n\n'),
                              true
                            );
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                        title="Simulates an image-based / scanned PDF section where standard extraction fails and tests the multi-stage OCR fallback (PDF.js Rasterization + Tesseract.js OCR + Gemini Vision + Deterministic OCR)"
                      >
                        <ScanEye className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        Test Scanned PDF OCR Fallback
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (pdfBytes) {
                            runFullPipeline(
                              pdfBytes,
                              pdfFileName,
                              pagesText.join('\n\n--- PAGE BREAK ---\n\n'),
                              false
                            );
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        Run Live Gemini Extraction
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCancelPipeline}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded text-xs transition-colors whitespace-nowrap shrink-0"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Cancel Pipeline
                    </button>
                  )}

                  <label className="flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded text-xs cursor-pointer transition-colors whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Vendor Spec PDF</span>
                    <input
                      type="file"
                      accept=".pdf"
                      disabled={isPipelineRunning}
                      onChange={handlePdfUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {showPipelinePanel && (
                <div className="px-4 py-3 bg-slate-50 dark:bg-[#0B0F17] border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                  <div className="lg:col-span-6 space-y-2">
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Pass 1 (Gemini Flash): Document Map ({docMap.sections.length} Chapters)
                    </div>
                    <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                      {docMap.sections.map((sec) => (
                        <div
                          key={sec.id}
                          onClick={() => setActivePage(sec.startPage)}
                          className="p-2 rounded bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                              {sec.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {sec.summary}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                            <span className="text-slate-500 dark:text-slate-400">
                              p.{sec.startPage}–{sec.endPage}
                            </span>
                            {sec.hasRegisters && (
                              <span className="text-sky-600 dark:text-sky-400">REGS</span>
                            )}
                            {sec.hasTiming && (
                              <span className="text-emerald-600 dark:text-emerald-400">TIMING</span>
                            )}
                            {sec.hasRequirements && (
                              <span className="text-amber-600 dark:text-amber-400">REQS</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-6 space-y-2">
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Pass 2 (Gemini Pro, Concurrency=3), OCR Fallback & Self-Repair Telemetry
                    </div>
                    {sectionProgress.length === 0 && repairUpdates.length === 0 ? (
                      <div className="p-3 rounded bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 leading-relaxed">
                        Upload any semiconductor datasheet PDF, click{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          "Run Live Gemini Extraction"
                        </strong>
                        , or click{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          "Test Scanned PDF OCR Fallback"
                        </strong>{' '}
                        to watch Pass 1 chapter mapping, client-side{' '}
                        <code className="text-sky-600 dark:text-sky-300">pdf-lib</code> page-range splitting, parallel Pass 2 extraction, automatic OCR fallback for image-based tables, and the deterministic Self-Repair loop.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-44 overflow-auto pr-1">
                        {sectionProgress.map((sp) => (
                          <div
                            key={sp.sectionId}
                            className="p-2 rounded bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-800 dark:text-slate-200 font-medium truncate">
                                {sp.title} (p.{sp.startPage}–{sp.endPage})
                              </span>
                              <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                                {sp.usedOcrFallback && (
                                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                    OCR FALLBACK ({sp.ocrMethod ?? 'ocr'}) · {sp.registersFound} regs
                                  </span>
                                )}
                                <span className="text-sky-600 dark:text-sky-300 uppercase">
                                  {sp.status} · {sp.progressPercent}%
                                </span>
                              </div>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
                              <div
                                className={`h-full transition-transform duration-150 origin-left ${
                                  sp.status === 'error'
                                    ? 'bg-rose-500'
                                    : sp.status === 'ocr-fallback'
                                    ? 'bg-amber-500'
                                    : sp.status === 'completed'
                                    ? 'bg-emerald-500 dark:bg-emerald-400'
                                    : 'bg-sky-500 dark:bg-sky-400'
                                }`}
                                style={{
                                  transform: `scaleX(${sp.progressPercent / 100})`,
                                }}
                              />
                            </div>
                          </div>
                        ))}

                        {repairUpdates.map((ru, i) => (
                          <div
                            key={i}
                            className="p-2 rounded bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 flex items-center justify-between font-mono text-[11px]"
                          >
                            <span className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                              <Sparkles className="w-3.5 h-3.5" />
                              Self-Repair {ru.registerName} (Attempt {ru.attempt}/{ru.maxAttempts})
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-300 uppercase">
                              {ru.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Split-Pane Workbench: Left PDF.js Evidence Viewer (5 cols) + Right Register Table Editor (7 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-[640px] items-stretch">
              <div className="lg:col-span-5 flex flex-col h-[680px]">
                <PdfEvidenceViewer
                  pdfBytes={pdfBytes}
                  fallbackPagesText={pagesText}
                  activePage={activePage}
                  highlightQuote={highlightQuote}
                  onPageChange={(p) => setActivePage(p)}
                  fileName={pdfFileName}
                />
              </div>

              <div className="lg:col-span-7 flex flex-col h-[680px]">
                <RegisterTableEditor
                  spec={spec}
                  validationReport={validationReport}
                  onUpdateSpec={setSpec}
                  onSelectEvidence={(page, quote) => {
                    setActivePage(page);
                    setHighlightQuote(quote);
                  }}
                  onRunSingleRepair={handleRunSingleRegisterRepair}
                  repairingRegName={repairingRegName}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'generators' && <GeneratorsView spec={spec} />}

        {activeTab === 'crosscheck' && (
          <CrossCheckView
            spec={spec}
            defaultRtlCode={currentPreset.rtlCode}
            defaultHeaderCode={currentPreset.cHeaderCode}
            onJumpToEvidence={handleSelectEvidence}
          />
        )}

        {activeTab === 'diff' && (
          <RevisionDiffView
            baseSpec={spec}
            defaultSecondSpec={currentPreset.specV2}
          />
        )}

        {activeTab === 'eval' && (
          <EvalView
            currentSpec={spec}
            sessionHistory={evalHistory}
            onRecordRun={(res) => setEvalHistory((prev) => [res, ...prev])}
          />
        )}
      </main>
    </div>
  );
}
