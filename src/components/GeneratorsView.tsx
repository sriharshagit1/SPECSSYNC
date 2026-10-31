import React, { useMemo, useState } from 'react';
import { Download, Copy, Check, FileCode } from 'lucide-react';
import { IPSpec } from '../schema/index.ts';
import {
  generateAllArtifacts,
  GeneratorFormat,
} from '../generators/index.ts';

interface GeneratorsViewProps {
  spec: IPSpec;
}

function renderHighlightedLine(line: string, language: string): React.ReactNode {
  const trimmed = line.trim();
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    (language === 'python' && trimmed.startsWith('#'))
  ) {
    return <span className="text-slate-400 dark:text-slate-500">{line}</span>;
  }

  if (language === 'c' && trimmed.startsWith('#')) {
    return <span className="text-sky-700 dark:text-sky-300">{line}</span>;
  }

  if (language === 'xml') {
    return <span className="text-amber-700 dark:text-amber-200/90">{line}</span>;
  }

  const parts = line.split(/(0x[0-9a-fA-F]+UL|0x[0-9a-fA-F]+U|0x[0-9a-fA-F]+|\d*'h[0-9a-fA-F_]+)/g);
  return parts.map((part, idx) => {
    if (/^(0x[0-9a-fA-F]+|\d*'h[0-9a-fA-F_]+)/i.test(part)) {
      return (
        <span key={idx} className="text-emerald-600 dark:text-emerald-300 font-semibold">
          {part}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export const GeneratorsView: React.FC<GeneratorsViewProps> = ({ spec }) => {
  const artifacts = useMemo(() => generateAllArtifacts(spec), [spec]);
  const [selectedFormat, setSelectedFormat] = useState<GeneratorFormat>('c_header');
  const [copied, setCopied] = useState<boolean>(false);

  const activeArtifact =
    artifacts.find((a) => a.format === selectedFormat) ?? artifacts[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeArtifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback
    }
  };

  const handleDownload = (filename: string, content: string) => {
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

  const handleDownloadAll = () => {
    artifacts.forEach((art, idx) => {
      setTimeout(() => {
        handleDownload(art.filename, art.content);
      }, idx * 120);
    });
  };

  const lines = activeArtifact.content.split('\n');

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header Description & Bulk Download */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg px-5 py-3.5 transition-colors">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Deterministic Output Code & Artifact Generators
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            100% deterministic TypeScript template compilation from the verified Canonical IR — zero LLM involvement in code generation.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadAll}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          Download All 8 Formats
        </button>
      </div>

      {/* Main Split: Format Selector Tabs on Left + Code Viewport on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-[540px]">
        <div className="lg:col-span-3 flex flex-col gap-1.5 bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg p-3 transition-colors">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 px-2 pb-1.5 border-b border-slate-200 dark:border-slate-800">
            Target Output Formats (8)
          </div>
          {artifacts.map((art) => {
            const isSelected = art.format === activeArtifact.format;
            return (
              <button
                key={art.format}
                type="button"
                onClick={() => setSelectedFormat(art.format)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-colors ${
                  isSelected
                    ? 'bg-sky-500/15 border border-sky-500/40 text-slate-900 dark:text-white'
                    : 'hover:bg-slate-100 dark:hover:bg-[#141E30] text-slate-700 dark:text-slate-300 border border-transparent'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{art.label}</div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {art.filename}
                  </div>
                </div>
                <span className="text-[11px] font-mono text-sky-600 dark:text-sky-400 shrink-0 ml-2">
                  {art.extension}
                </span>
              </button>
            );
          })}
        </div>

        {/* Code Preview Panel */}
        <div className="lg:col-span-9 flex flex-col bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                {activeArtifact.filename}
              </span>
              <span className="text-slate-400 dark:text-slate-600">·</span>
              <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
                {activeArtifact.description}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    Copy Code
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  handleDownload(activeArtifact.filename, activeArtifact.content)
                }
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded text-xs transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Download {activeArtifact.extension}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 bg-slate-50 dark:bg-[#090D14] font-mono text-xs leading-relaxed">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-slate-200/60 dark:hover:bg-slate-900/50">
                    <td className="select-none pr-4 text-right text-slate-400 dark:text-slate-600 w-10 tabular-nums align-top">
                      {idx + 1}
                    </td>
                    <td className="text-slate-800 dark:text-slate-200 whitespace-pre">
                      {renderHighlightedLine(line, activeArtifact.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
