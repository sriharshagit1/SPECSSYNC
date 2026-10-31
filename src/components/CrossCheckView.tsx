import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Play,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { IPSpec, Register } from '../schema/index.ts';
import {
  CrossCheckReport,
  MismatchSeverity,
  parseCHeaderDeterministic,
  parseRTLDeterministic,
  runCrossArtifactCheck,
  exportCrossCheckCSV,
  exportCrossCheckMarkdown,
} from '../crosscheck/index.ts';
import { DEMO_RTL_CODE, DEMO_C_HEADER_CODE } from '../pipeline/demoData.ts';

interface CrossCheckViewProps {
  spec: IPSpec;
  defaultRtlCode?: string;
  defaultHeaderCode?: string;
  onJumpToEvidence: (page: number, quote: string) => void;
}

export const CrossCheckView: React.FC<CrossCheckViewProps> = ({
  spec,
  defaultRtlCode = DEMO_RTL_CODE,
  defaultHeaderCode = DEMO_C_HEADER_CODE,
  onJumpToEvidence,
}) => {
  const [rtlCode, setRtlCode] = useState<string>(defaultRtlCode);
  const [headerCode, setHeaderCode] = useState<string>(defaultHeaderCode);
  const [ralCode, setRalCode] = useState<string>('');
  const [activeInputTab, setActiveInputTab] = useState<'rtl' | 'header' | 'ral'>('rtl');
  const [severityFilter, setSeverityFilter] = useState<
    'all' | MismatchSeverity
  >('all');
  const [isRunningAI, setIsRunningAI] = useState<boolean>(false);
  const [report, setReport] = useState<CrossCheckReport>(() => {
    const rtlRegs = parseRTLDeterministic(defaultRtlCode, spec.name);
    const hdrParsed = parseCHeaderDeterministic(defaultHeaderCode, spec.name);
    return runCrossArtifactCheck(
      spec,
      rtlRegs,
      hdrParsed.registers,
      [],
      hdrParsed.unparseableLines
    );
  });

  useEffect(() => {
    setRtlCode(defaultRtlCode);
    setHeaderCode(defaultHeaderCode);
  }, [defaultRtlCode, defaultHeaderCode]);

  useEffect(() => {
    const rtlRegs = parseRTLDeterministic(rtlCode, spec.name);
    const hdrParsed = parseCHeaderDeterministic(headerCode, spec.name);
    const nextReport = runCrossArtifactCheck(
      spec,
      rtlRegs,
      hdrParsed.registers,
      [],
      hdrParsed.unparseableLines
    );
    setReport(nextReport);
  }, [spec, rtlCode, headerCode]);

  const handleRunWithGeminiFallback = async () => {
    setIsRunningAI(true);
    try {
      const hdrParsed = parseCHeaderDeterministic(headerCode, spec.name);
      let headerRegisters: Register[] = [...hdrParsed.registers];

      if (hdrParsed.unparseableLines.length > 0) {
        const res = await fetch('/api/crosscheck/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: hdrParsed.unparseableLines.join('\n'),
            artifactType: 'c_header',
            ipName: spec.name,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.registers) && data.registers.length > 0) {
            headerRegisters = [...headerRegisters, ...data.registers];
          }
        }
      }

      let rtlRegisters = parseRTLDeterministic(rtlCode, spec.name);
      if (rtlCode.trim()) {
        const res = await fetch('/api/crosscheck/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: rtlCode,
            artifactType: 'rtl',
            ipName: spec.name,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.registers) && data.registers.length > 0) {
            if (rtlRegisters.length === 0) {
              rtlRegisters = data.registers;
            }
          }
        }
      }

      const nextReport = runCrossArtifactCheck(
        spec,
        rtlRegisters,
        headerRegisters,
        [],
        hdrParsed.unparseableLines
      );
      setReport(nextReport);
    } finally {
      setIsRunningAI(false);
    }
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'rtl' | 'header' | 'ral'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (target === 'rtl') setRtlCode(text);
      else if (target === 'header') setHeaderCode(text);
      else setRalCode(text);
    };
    reader.readAsText(file);
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredRows = report.rows.filter((r) =>
    severityFilter === 'all' ? true : r.severity === severityFilter
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Top Summary & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-3.5 transition-colors">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Cross-Artifact Consistency Checker (Spec IR vs. RTL vs. Firmware C Header)
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            <span className="text-rose-600 dark:text-rose-400 font-semibold">
              {report.criticalCount} Critical Mismatches
            </span>
            <span>·</span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              {report.majorCount} Major Mismatches
            </span>
            <span>·</span>
            <span className="text-sky-600 dark:text-sky-300">
              {report.minorCount} Minor Differences
            </span>
            <span>·</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              {report.matchCount} Verified Matches
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setRtlCode(defaultRtlCode);
              setHeaderCode(defaultHeaderCode);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-[#0B0F17] hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Demo RTL & Header
          </button>

          <button
            type="button"
            disabled={isRunningAI}
            onClick={handleRunWithGeminiFallback}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold rounded text-xs transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            {isRunningAI ? 'Analyzing Artifacts...' : 'Run Deep Consistency Check'}
          </button>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                `${spec.name.toLowerCase()}_crosscheck_report.csv`,
                exportCrossCheckCSV(report)
              )
            }
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Export CSV
          </button>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                `${spec.name.toLowerCase()}_crosscheck_report.md`,
                exportCrossCheckMarkdown(report, spec.name)
              )
            }
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Export Markdown
          </button>
        </div>
      </div>

      {/* Main Split: Left Artifact Code Inputs + Right Discrepancy Report Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-5 flex flex-col bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-[#0B0F17] p-1 rounded border border-slate-300 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setActiveInputTab('rtl')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeInputTab === 'rtl'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                SystemVerilog RTL (.sv)
              </button>
              <button
                type="button"
                onClick={() => setActiveInputTab('header')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeInputTab === 'header'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Firmware Header (.h)
              </button>
              <button
                type="button"
                onClick={() => setActiveInputTab('ral')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeInputTab === 'ral'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                UVM RAL / RDL
              </button>
            </div>

            <label className="flex items-center gap-1 px-2.5 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-xs cursor-pointer transition-colors whitespace-nowrap shrink-0">
              <Upload className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Upload File</span>
              <input
                type="file"
                accept=".v,.sv,.vh,.svh,.h,.hpp,.rdl"
                onChange={(e) => handleFileUpload(e, activeInputTab)}
                className="hidden"
              />
            </label>
          </div>

          <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#0B0F17] border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
            {activeInputTab === 'header'
              ? `Deterministic #define regex parser active (${report.headerExtractedRegisters.length} registers parsed, ${report.unparseableHeaderLines.length} unparsed macro lines).`
              : activeInputTab === 'rtl'
              ? `RTL parser active (${report.rtlExtractedRegisters.length} registers extracted). Edit code below to test live re-checking.`
              : 'Optional UVM RAL (.sv) or SystemRDL (.rdl) input for 4-way verification.'}
          </div>

          <textarea
            value={
              activeInputTab === 'rtl'
                ? rtlCode
                : activeInputTab === 'header'
                ? headerCode
                : ralCode
            }
            onChange={(e) => {
              if (activeInputTab === 'rtl') setRtlCode(e.target.value);
              else if (activeInputTab === 'header') setHeaderCode(e.target.value);
              else setRalCode(e.target.value);
            }}
            spellCheck={false}
            placeholder={
              activeInputTab === 'ral'
                ? '// Paste optional UVM RAL or SystemRDL file here...'
                : ''
            }
            className="flex-1 min-h-[460px] w-full p-3.5 bg-slate-50 dark:bg-[#090D14] text-slate-800 dark:text-slate-200 font-mono text-xs leading-relaxed focus:outline-none resize-none"
          />
        </div>

        {/* Right: Discrepancy & Verification Report Table */}
        <div className="lg:col-span-7 flex flex-col bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Discrepancy & Consistency Matrix ({filteredRows.length} items)
            </span>

            <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-[#0B0F17] p-0.5 rounded border border-slate-300 dark:border-slate-800 text-xs">
              {(
                [
                  { id: 'all', label: `All (${report.rows.length})` },
                  { id: 'critical', label: `Critical (${report.criticalCount})` },
                  { id: 'major', label: `Major (${report.majorCount})` },
                  { id: 'minor', label: `Minor (${report.minorCount})` },
                  { id: 'match', label: `Matched (${report.matchCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSeverityFilter(tab.id)}
                  className={`px-2 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                    severityFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto max-h-[520px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-100 dark:bg-[#131C2E] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 z-10">
                <tr>
                  <th className="py-2.5 px-3 font-medium">Item</th>
                  <th className="py-2.5 px-3 font-medium">Spec Value</th>
                  <th className="py-2.5 px-3 font-medium">RTL Value</th>
                  <th className="py-2.5 px-3 font-medium">Header Value</th>
                  <th className="py-2.5 px-3 font-medium">Severity</th>
                  <th className="py-2.5 px-3 font-medium text-right">Match Conf</th>
                  <th className="py-2.5 px-3 font-medium text-right">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                {filteredRows.map((row) => {
                  const isCrit = row.severity === 'critical';
                  const isMaj = row.severity === 'major';
                  const isMin = row.severity === 'minor';

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        isCrit
                          ? 'bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/35'
                          : isMaj
                          ? 'bg-amber-50 dark:bg-amber-950/15 hover:bg-amber-100/70 dark:hover:bg-amber-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-[#141E30]'
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                        <div>{row.item}</div>
                        {row.severity !== 'match' && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                            {row.summary}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-sky-700 dark:text-sky-300">
                        {row.specValue}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono tabular-nums ${
                          row.rtlValue !== row.specValue &&
                          row.rtlValue !== '—' &&
                          row.severity !== 'match'
                            ? 'text-rose-600 dark:text-rose-300 font-semibold'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {row.rtlValue}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono tabular-nums ${
                          row.headerValue !== row.specValue &&
                          row.headerValue !== '—' &&
                          row.severity !== 'match'
                            ? 'text-rose-600 dark:text-rose-300 font-semibold'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {row.headerValue}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {isCrit ? (
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                            <AlertCircle className="w-3.5 h-3.5" />
                            CRITICAL
                          </span>
                        ) : isMaj ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            MAJOR
                          </span>
                        ) : isMin ? (
                          <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-300 font-medium">
                            MINOR
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            MATCH
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-500 dark:text-slate-400">
                        {row.matchConfidence > 0
                          ? `${Math.round(row.matchConfidence * 100)}%`
                          : 'Unmatched'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                        {row.evidencePage ? (
                          <button
                            type="button"
                            onClick={() =>
                              onJumpToEvidence(
                                row.evidencePage!,
                                row.evidenceQuote || row.registerName
                              )
                            }
                            className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300"
                            title={row.evidenceQuote}
                          >
                            <span>p.{row.evidencePage}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
