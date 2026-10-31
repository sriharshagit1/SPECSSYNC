import React, { useEffect, useMemo, useState } from 'react';
import {
  GitCompare,
  PlusCircle,
  MinusCircle,
  Edit,
  Upload,
  CheckCircle2,
  FileCode,
  Cpu,
} from 'lucide-react';
import { IPSpec } from '../schema/index.ts';
import { computeSpecRevisionDiff } from '../diff/index.ts';
import { DEMO_IP_SPEC_V2 } from '../pipeline/demoData.ts';
import { runDocumentMapPass } from '../pipeline/map.ts';
import { runSectionExtractionPass } from '../pipeline/extract.ts';
import { runSelfRepairLoop } from '../pipeline/repair.ts';

interface RevisionDiffViewProps {
  baseSpec: IPSpec;
  defaultSecondSpec?: IPSpec;
}

export const RevisionDiffView: React.FC<RevisionDiffViewProps> = ({
  baseSpec,
  defaultSecondSpec = DEMO_IP_SPEC_V2,
}) => {
  const [secondSpec, setSecondSpec] = useState<IPSpec>(defaultSecondSpec);
  const [isExtractingV2, setIsExtractingV2] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>(
    `Comparing baseline Spec IR (${baseSpec.version}) against Revision ${defaultSecondSpec.version}`
  );
  const [filterType, setFilterType] = useState<
    'all' | 'added' | 'modified' | 'removed'
  >('all');

  useEffect(() => {
    setSecondSpec(defaultSecondSpec);
    setStatusMsg(
      `Comparing baseline Spec IR (${baseSpec.version}) against Revision ${defaultSecondSpec.version}`
    );
  }, [baseSpec.name, baseSpec.version, defaultSecondSpec]);

  const diffReport = useMemo(
    () => computeSpecRevisionDiff(baseSpec, secondSpec),
    [baseSpec, secondSpec]
  );

  const handleUploadSecondPdf = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtractingV2(true);
    setStatusMsg(`Pass 1 (Flash): Mapping chapters in ${file.name}...`);

    try {
      const arrayBuf = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuf);

      const docMap = await runDocumentMapPass({
        pdfBytes,
        fileName: file.name,
      });

      setStatusMsg(
        `Pass 2 (Pro): Extracting ${docMap.sections.length} sections from ${file.name}...`
      );
      const extracted = await runSectionExtractionPass({
        docMap,
        pdfBytes,
        onProgress: () => {},
      });

      setStatusMsg(`Running deterministic validation & self-repair on ${file.name}...`);
      const repaired = await runSelfRepairLoop({
        spec: extracted,
        pdfBytes,
      });

      setSecondSpec(repaired);
      setStatusMsg(
        `Completed extraction of ${file.name} (${repaired.registers.length} registers).`
      );
    } catch (err: any) {
      setStatusMsg(`Error extracting second PDF: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsExtractingV2(false);
    }
  };

  const filteredItems = diffReport.items.filter((item) =>
    filterType === 'all' ? true : item.changeType === filterType
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header & Revision Upload Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-3.5 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Specification Revision Diff & Downstream Impact Analysis
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            <span>
              Baseline: <strong className="text-slate-800 dark:text-slate-200">{baseSpec.name} ({diffReport.oldVersion})</strong>
            </span>
            <span>→</span>
            <span>
              Target: <strong className="text-sky-700 dark:text-sky-300">{secondSpec.name} ({diffReport.newVersion})</strong>
            </span>
            <span>·</span>
            <span className="text-emerald-600 dark:text-emerald-400">+{diffReport.addedRegisters} Added</span>
            <span>·</span>
            <span className="text-amber-600 dark:text-amber-400">~{diffReport.modifiedRegisters} Modified</span>
            <span>·</span>
            <span className="text-rose-600 dark:text-rose-400">-{diffReport.removedRegisters} Removed</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setSecondSpec(defaultSecondSpec);
              setStatusMsg(
                `Loaded built-in ${defaultSecondSpec.name} ${defaultSecondSpec.version} revision spec.`
              );
            }}
            className="px-3 py-1.5 bg-slate-100 dark:bg-[#0B0F17] hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            Load Demo {defaultSecondSpec.version} Spec
          </button>

          <label className="flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded text-xs cursor-pointer transition-colors whitespace-nowrap shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>{isExtractingV2 ? 'Running Pipeline...' : 'Upload Revision 2 PDF'}</span>
            <input
              type="file"
              accept=".pdf"
              disabled={isExtractingV2}
              onChange={handleUploadSecondPdf}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Status & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-100 dark:bg-[#131C2E] border border-slate-200 dark:border-slate-800 rounded-lg text-xs transition-colors">
        <span className="text-slate-700 dark:text-slate-300">{statusMsg}</span>
        <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-[#0B0F17] p-0.5 rounded border border-slate-300 dark:border-slate-800">
          {(['all', 'added', 'modified', 'removed'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 rounded capitalize transition-colors whitespace-nowrap shrink-0 ${
                filterType === t
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Diff Items List */}
      <div className="space-y-3">
        {filteredItems.map((item) => {
          const isAdded = item.changeType === 'added';
          const isRemoved = item.changeType === 'removed';
          const isMod = item.changeType === 'modified';

          return (
            <div
              key={item.registerName}
              className="bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5 font-mono">
                  {isAdded ? (
                    <PlusCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  ) : isRemoved ? (
                    <MinusCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  ) : isMod ? (
                    <Edit className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                  )}
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {item.registerName}
                  </span>
                  <span className="text-xs text-sky-600 dark:text-sky-400 tabular-nums">
                    {item.offsetOld && item.offsetNew && item.offsetOld !== item.offsetNew
                      ? `${item.offsetOld} → ${item.offsetNew}`
                      : item.offsetNew ?? item.offsetOld}
                  </span>
                </div>

                <span
                  className={`text-xs font-mono uppercase font-semibold ${
                    isAdded
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isRemoved
                      ? 'text-rose-600 dark:text-rose-400'
                      : isMod
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-500'
                  }`}
                >
                  {item.changeType}
                </span>
              </div>

              {item.changeType !== 'unchanged' && (
                <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                  <div className="lg:col-span-6 space-y-2.5">
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Register & Bitfield Changes
                    </div>

                    {item.registerPropertyChanges.map((rc, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-slate-50 dark:bg-[#0B0F17] px-3 py-1.5 rounded border border-slate-200 dark:border-slate-800 font-mono"
                      >
                        <span className="text-slate-500 dark:text-slate-400">Register.{rc.property}</span>
                        <div>
                          <span className="text-rose-600 dark:text-rose-300 line-through mr-2">
                            {rc.oldValue}
                          </span>
                          <span className="text-emerald-600 dark:text-emerald-300 font-semibold">
                            → {rc.newValue}
                          </span>
                        </div>
                      </div>
                    ))}

                    {item.fieldChanges.map((fc, i) => (
                      <div
                        key={i}
                        className="bg-slate-50 dark:bg-[#0B0F17] p-2.5 rounded border border-slate-200 dark:border-slate-800 space-y-1"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span className="text-slate-900 dark:text-white font-semibold">
                            Field: {fc.fieldName}
                          </span>
                          <span
                            className={
                              fc.changeType === 'added'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : fc.changeType === 'removed'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {fc.changeType.toUpperCase()}
                          </span>
                        </div>
                        {fc.changes.map((c, j) => (
                          <div
                            key={j}
                            className="flex items-center justify-between font-mono text-[11px] text-slate-700 dark:text-slate-300"
                          >
                            <span className="text-slate-500 dark:text-slate-400">{c.property}:</span>
                            <span>
                              <span className="text-rose-600 dark:text-rose-300/90">{c.oldValue}</span>
                              {' → '}
                              <span className="text-emerald-600 dark:text-emerald-300 font-semibold">
                                {c.newValue}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Right: Impacted Generated Artifacts & Loaded RTL/Headers */}
                  <div className="lg:col-span-6 space-y-3">
                    <div className="bg-slate-50 dark:bg-[#0B0F17] p-3 rounded border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300 font-semibold">
                        <FileCode className="w-3.5 h-3.5" />
                        <span>Impacted Generated Output Files</span>
                      </div>
                      <ul className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        {item.impactedArtifacts.map((art, idx) => (
                          <li key={idx}>• {art}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-slate-50 dark:bg-[#0B0F17] p-3 rounded border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-semibold">
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Impacted RTL & Firmware Header Items</span>
                      </div>
                      <ul className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        {item.impactedRtlAndHeaderItems.map((imp, idx) => (
                          <li key={idx}>• {imp}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
