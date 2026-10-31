import React, { useEffect, useState } from 'react';
import {
  Award,
  Play,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  History,
} from 'lucide-react';
import { IPSpec } from '../schema/index.ts';
import {
  evaluateAgainstGroundTruth,
  EvaluationRunResult,
} from '../eval/index.ts';

interface EvalViewProps {
  currentSpec: IPSpec;
  sessionHistory: EvaluationRunResult[];
  onRecordRun: (result: EvaluationRunResult) => void;
}

export const EvalView: React.FC<EvalViewProps> = ({
  currentSpec,
  sessionHistory,
  onRecordRun,
}) => {
  const [groundTruthText, setGroundTruthText] = useState<string>(() =>
    JSON.stringify(currentSpec, null, 2)
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<EvaluationRunResult>(() =>
    evaluateAgainstGroundTruth(currentSpec, currentSpec)
  );

  useEffect(() => {
    setGroundTruthText(JSON.stringify(currentSpec, null, 2));
    setLatestResult(evaluateAgainstGroundTruth(currentSpec, currentSpec));
  }, [currentSpec]);

  const handleRunEvaluation = () => {
    setParseError(null);
    try {
      const parsedGT = JSON.parse(groundTruthText) as IPSpec;
      if (!parsedGT || !Array.isArray(parsedGT.registers)) {
        throw new Error('Ground-truth JSON must contain a "registers" array.');
      }
      const res = evaluateAgainstGroundTruth(currentSpec, parsedGT);
      setLatestResult(res);
      onRecordRun(res);
    } catch (err: any) {
      setParseError(err?.message || 'Invalid JSON syntax');
    }
  };

  const handleLoadPerturbedBenchmark = () => {
    const regs = currentSpec.registers;
    const perturbed: IPSpec = {
      ...currentSpec,
      registers: [
        ...regs.slice(0, Math.max(1, regs.length - 1)),
        {
          ...(regs[0] || {}),
          id: 'gt-extra-reg',
          name: `${currentSpec.name}_DIAG_GT`,
          offset: '0xFC',
          resetValue: '0x0000000F',
          fields: regs[0]?.fields || [],
          evidence: { page: 1, quote: 'Synthetic ground-truth test register' },
        },
      ],
    };
    const jsonStr = JSON.stringify(perturbed, null, 2);
    setGroundTruthText(jsonStr);
    const res = evaluateAgainstGroundTruth(currentSpec, perturbed);
    setLatestResult(res);
    onRecordRun(res);
  };

  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="flex flex-col gap-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-3.5 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Extraction Credibility & Ground-Truth Benchmark Evaluation
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Computes Precision, Recall, and F1 across Registers (name+offset), Fields (name+bit range), and Reset Values.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              const str = JSON.stringify(currentSpec, null, 2);
              setGroundTruthText(str);
              const res = evaluateAgainstGroundTruth(currentSpec, currentSpec);
              setLatestResult(res);
              onRecordRun(res);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-[#0B0F17] hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Exact Ground Truth
          </button>

          <button
            type="button"
            onClick={handleLoadPerturbedBenchmark}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            Test Miss / False-Positive Detection
          </button>

          <button
            type="button"
            onClick={handleRunEvaluation}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded text-xs transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            Compute Precision / Recall / F1
          </button>
        </div>
      </div>

      {/* Scorecard Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            title: 'Registers (Name + Offset)',
            metric: latestResult.registerScore,
          },
          {
            title: 'Bitfields (Name + [MSB:LSB])',
            metric: latestResult.fieldScore,
          },
          {
            title: 'Reset Values (Hex Match)',
            metric: latestResult.resetScore,
          },
        ].map((card, i) => (
          <div
            key={i}
            className="bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2 transition-colors"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.title}</div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                F1: {fmtPct(card.metric.f1)}
              </span>
              <span className="text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400">
                TP:{card.metric.truePositives} · FP:{card.metric.falsePositives} · FN:{card.metric.falseNegatives}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-200 dark:border-slate-800/80">
              <span>Precision: {fmtPct(card.metric.precision)}</span>
              <span>·</span>
              <span>Recall: {fmtPct(card.metric.recall)}</span>
            </div>
          </div>
        ))}

        <div className="bg-white dark:bg-[#0F1623] border border-sky-500/40 rounded-lg p-4 flex flex-col justify-between transition-colors">
          <div className="text-xs font-medium text-sky-700 dark:text-sky-300">
            Macro-Averaged Extraction F1
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmtPct(latestResult.overallF1)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {latestResult.discrepancies.length === 0
              ? 'Zero misses or false positives'
              : `${latestResult.discrepancies.length} total discrepancy items`}
          </div>
        </div>
      </div>

      {/* Main Split: Left Ground Truth JSON Editor + Right Discrepancies & Session History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 flex flex-col bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
          <div className="px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Ground-Truth Canonical JSON Input
            </span>
            {parseError && (
              <span className="text-xs text-rose-600 dark:text-rose-400 font-mono">{parseError}</span>
            )}
          </div>
          <textarea
            value={groundTruthText}
            onChange={(e) => setGroundTruthText(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-[420px] p-3.5 bg-slate-50 dark:bg-[#090D14] text-slate-800 dark:text-slate-200 font-mono text-xs leading-relaxed focus:outline-none resize-none"
          />
        </div>

        <div className="lg:col-span-6 flex flex-col gap-4">
          {/* Misses & False Positives Table */}
          <div className="bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex-1 transition-colors">
            <div className="px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200">
              Misses (False Negatives) & False Positives ({latestResult.discrepancies.length})
            </div>
            <div className="max-h-[250px] overflow-auto">
              {latestResult.discrepancies.length === 0 ? (
                <div className="p-6 flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>100% agreement with Ground-Truth JSON across all registers, fields, and resets.</span>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-[#111827] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3">Expected</th>
                      <th className="py-2 px-3">Extracted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {latestResult.discrepancies.map((d, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#141E30]">
                        <td className="py-2 px-3 font-mono whitespace-nowrap">
                          {d.type === 'miss' ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                              <AlertCircle className="w-3 h-3" /> MISS (FN)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                              <AlertCircle className="w-3 h-3" /> FALSE POS (FP)
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono uppercase text-slate-500 dark:text-slate-400">
                          {d.category}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-900 dark:text-white">{d.item}</td>
                        <td className="py-2 px-3 font-mono text-emerald-600 dark:text-emerald-300">
                          {d.expected}
                        </td>
                        <td className="py-2 px-3 font-mono text-rose-600 dark:text-rose-300">
                          {d.extracted}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Session Score History */}
          <div className="bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
            <div className="px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <History className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Session Evaluation Run History ({sessionHistory.length})</span>
            </div>
            <div className="max-h-[160px] overflow-auto">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead className="bg-slate-50 dark:bg-[#111827] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-3">IP Block</th>
                    <th className="py-2 px-3 text-right">Reg F1</th>
                    <th className="py-2 px-3 text-right">Field F1</th>
                    <th className="py-2 px-3 text-right">Reset F1</th>
                    <th className="py-2 px-3 text-right">Overall F1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sessionHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-[#141E30]">
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{h.timestamp}</td>
                      <td className="py-2 px-3 text-slate-900 dark:text-white">{h.ipName}</td>
                      <td className="py-2 px-3 text-right text-sky-600 dark:text-sky-300">
                        {fmtPct(h.registerScore.f1)}
                      </td>
                      <td className="py-2 px-3 text-right text-sky-600 dark:text-sky-300">
                        {fmtPct(h.fieldScore.f1)}
                      </td>
                      <td className="py-2 px-3 text-right text-sky-600 dark:text-sky-300">
                        {fmtPct(h.resetScore.f1)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {fmtPct(h.overallF1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
