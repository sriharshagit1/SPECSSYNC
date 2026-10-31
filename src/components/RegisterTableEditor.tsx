import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Edit3,
  Plus,
  Trash2,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Wrench,
  ExternalLink,
  Search,
  Sparkles,
  History,
} from 'lucide-react';
import {
  IPSpec,
  Register,
  Field,
  ValidationReport,
  VALID_ACCESS_TYPES,
} from '../schema/index.ts';
import { fillReservedBitGaps } from '../validators/index.ts';

interface RegisterTableEditorProps {
  spec: IPSpec;
  validationReport: ValidationReport;
  onUpdateSpec: (updated: IPSpec) => void;
  onSelectEvidence: (page: number, quote: string) => void;
  onRunSingleRepair?: (regIndex: number) => void;
  repairingRegName?: string | null;
}

export const RegisterTableEditor: React.FC<RegisterTableEditorProps> = ({
  spec,
  validationReport,
  onUpdateSpec,
  onSelectEvidence,
  onRunSingleRepair,
  repairingRegName,
}) => {
  const [subTab, setSubTab] = useState<'registers' | 'timing' | 'requirements'>('registers');
  const [expandedRegs, setExpandedRegs] = useState<Record<string, boolean>>({
    CTRL: true,
    STATUS: true,
    BAUD_DIV: true,
    FIFO_CTRL: true,
  });
  const [editingRegName, setEditingRegName] = useState<string | null>(null);
  const [inspectHistoryReg, setInspectHistoryReg] = useState<Register | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'errors' | 'warnings' | 'auto-fixed'
  >('all');

  const toggleExpand = (regName: string) => {
    setExpandedRegs((prev) => ({ ...prev, [regName]: !prev[regName] }));
  };

  const updateRegisterAt = (index: number, updatedReg: Register) => {
    const nextRegs = [...spec.registers];
    nextRegs[index] = updatedReg;
    onUpdateSpec({ ...spec, registers: nextRegs });
  };

  const deleteRegisterAt = (index: number) => {
    const nextRegs = spec.registers.filter((_, i) => i !== index);
    onUpdateSpec({ ...spec, registers: nextRegs });
  };

  const addNewRegister = () => {
    const nextIdx = spec.registers.length + 1;
    const newReg: Register = {
      id: `reg-custom-${Date.now()}`,
      name: `NEW_REG_${nextIdx}`,
      offset: `0x${(nextIdx * 4).toString(16).toUpperCase().padStart(2, '0')}`,
      width: spec.busWidth || 32,
      description: 'New register added manually',
      resetValue: '0x00000000',
      confidence: 1.0,
      repairStatus: 'original',
      reviewStatus: 'edited',
      evidence: { page: 1, quote: 'Manually added by engineer' },
      fields: [
        {
          name: 'DATA',
          msb: 31,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0',
          description: 'Register data field',
          enumValues: [],
          evidence: { page: 1, quote: 'Manually added by engineer' },
        },
      ],
    };
    setExpandedRegs((prev) => ({ ...prev, [newReg.name]: true }));
    setEditingRegName(newReg.name);
    onUpdateSpec({ ...spec, registers: [...spec.registers, newReg] });
  };

  const updateFieldAt = (regIdx: number, fieldIdx: number, patch: Partial<Field>) => {
    const targetReg = spec.registers[regIdx];
    const nextFields = [...targetReg.fields];
    nextFields[fieldIdx] = { ...nextFields[fieldIdx], ...patch };
    updateRegisterAt(regIdx, {
      ...targetReg,
      fields: nextFields,
      reviewStatus: 'edited',
    });
  };

  const addFieldToReg = (regIdx: number) => {
    const targetReg = spec.registers[regIdx];
    const newField: Field = {
      name: `FIELD_${targetReg.fields.length + 1}`,
      msb: 0,
      lsb: 0,
      access: 'RW',
      resetValue: '0x0',
      description: 'New bitfield',
      enumValues: [],
      evidence: targetReg.evidence,
    };
    updateRegisterAt(regIdx, {
      ...targetReg,
      fields: [...targetReg.fields, newField],
      reviewStatus: 'edited',
    });
  };

  const deleteFieldAt = (regIdx: number, fieldIdx: number) => {
    const targetReg = spec.registers[regIdx];
    updateRegisterAt(regIdx, {
      ...targetReg,
      fields: targetReg.fields.filter((_, i) => i !== fieldIdx),
      reviewStatus: 'edited',
    });
  };

  const handleFillReserved = (regIdx: number) => {
    const targetReg = spec.registers[regIdx];
    const filled = fillReservedBitGaps(targetReg, spec.busWidth || 32);
    updateRegisterAt(regIdx, { ...filled, reviewStatus: 'edited' });
  };

  const filteredRegisters = spec.registers
    .map((reg, originalIndex) => ({ reg, originalIndex }))
    .filter(({ reg }) => {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchesReg =
          reg.name.toLowerCase().includes(q) ||
          (reg.offset ?? '').toLowerCase().includes(q) ||
          (reg.description ?? '').toLowerCase().includes(q);
        const matchesField = reg.fields.some(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            (f.description ?? '').toLowerCase().includes(q)
        );
        if (!matchesReg && !matchesField) return false;
      }

      const regIssues = validationReport.issuesByRegister[reg.name] ?? [];
      const hasErr = regIssues.some((i) => i.severity === 'error');
      const hasWarn = regIssues.some((i) => i.severity === 'warning');

      if (statusFilter === 'errors') return hasErr;
      if (statusFilter === 'warnings') return hasWarn;
      if (statusFilter === 'auto-fixed') return reg.repairStatus === 'auto-fixed';
      return true;
    });

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0F1623] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden transition-colors">
      {/* Top Sub-Navigation & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-100 dark:bg-[#131C2E] border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-[#0B0F17] p-1 rounded-md border border-slate-300 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setSubTab('registers')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'registers'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Registers ({spec.registers.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('timing')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'timing'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Timing ({spec.timingParameters.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('requirements')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'requirements'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Requirements ({spec.requirements.length})
          </button>
        </div>

        {subTab === 'registers' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter registers or fields..."
                className="pl-8 pr-3 py-1 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-800 rounded text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-500 w-48"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-[#0B0F17] p-0.5 rounded border border-slate-300 dark:border-slate-800 text-xs">
              {(['all', 'errors', 'warnings', 'auto-fixed'] as const).map((fKey) => (
                <button
                  key={fKey}
                  type="button"
                  onClick={() => setStatusFilter(fKey)}
                  className={`px-2 py-1 rounded capitalize transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === fKey
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {fKey}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={addNewRegister}
              className="flex items-center gap-1 px-2.5 py-1 bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 border border-sky-500/30 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Register
            </button>
          </div>
        )}
      </div>

      {/* Before / After Self-Repair Modal Drawer */}
      {inspectHistoryReg && inspectHistoryReg.repairHistory && (
        <div className="px-4 py-3 bg-sky-50 dark:bg-[#17223B] border-b border-sky-200 dark:border-sky-700/50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-800 dark:text-sky-300">
              <History className="w-4 h-4" />
              <span>
                Self-Repair Audit Trail for {inspectHistoryReg.name} (
                {inspectHistoryReg.repairHistory.length} attempt
                {inspectHistoryReg.repairHistory.length > 1 ? 's' : ''})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setInspectHistoryReg(null)}
              className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800"
            >
              Close
            </button>
          </div>
          {inspectHistoryReg.repairHistory.map((rec, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-white dark:bg-[#0B0F17] p-3 rounded border border-slate-200 dark:border-slate-800 font-mono"
            >
              <div>
                <div className="text-amber-700 dark:text-amber-400 font-sans font-medium mb-1">
                  Before Repair (Attempt #{rec.attempt}) — Validation Errors:
                </div>
                <ul className="list-disc list-inside text-rose-600 dark:text-rose-300 space-y-0.5 mb-2 font-sans">
                  {rec.errorsFixed.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <div className="text-slate-600 dark:text-slate-400">
                  Fields:{' '}
                  {rec.previousRegister.fields
                    .map((f) => `${f.name}[${f.msb}:${f.lsb}]`)
                    .join(', ')}
                </div>
              </div>
              <div>
                <div className="text-emerald-700 dark:text-emerald-400 font-sans font-medium mb-1">
                  After Gemini Self-Repair (Verified against Page {inspectHistoryReg.evidence.page}):
                </div>
                <div className="text-slate-700 dark:text-slate-300 mb-1 font-sans">
                  Source Quote: "{inspectHistoryReg.evidence.quote}"
                </div>
                <div className="text-emerald-700 dark:text-emerald-300">
                  Fields:{' '}
                  {inspectHistoryReg.fields
                    .map((f) => `${f.name}[${f.msb}:${f.lsb}]`)
                    .join(', ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        {subTab === 'registers' && (
          <div className="divide-y divide-slate-200 dark:divide-slate-800/80">
            {filteredRegisters.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No registers match the current filter.
              </div>
            ) : (
              filteredRegisters.map(({ reg, originalIndex }) => {
                const isExpanded = !!expandedRegs[reg.name];
                const isEditing = editingRegName === reg.name;
                const regIssues = validationReport.issuesByRegister[reg.name] ?? [];
                const errors = regIssues.filter((i) => i.severity === 'error');
                const warnings = regIssues.filter((i) => i.severity === 'warning');
                const hasBitGap = warnings.some((w) => w.code === 'UNACCOUNTED_BIT_GAP');

                return (
                  <div
                    key={reg.id || `${reg.name}-${originalIndex}`}
                    className={`transition-colors ${
                      reg.reviewStatus === 'rejected'
                        ? 'opacity-50 bg-rose-50 dark:bg-rose-950/10'
                        : ''
                    }`}
                  >
                    {/* Register Row Header */}
                    <div
                      className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-[#0F1623] hover:bg-slate-50 dark:hover:bg-[#141E30] cursor-pointer"
                      onClick={() => {
                        toggleExpand(reg.name);
                        onSelectEvidence(reg.evidence.page, reg.evidence.quote);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0"
                          aria-label="Toggle Fields"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>

                        {isEditing ? (
                          <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={reg.offset ?? ''}
                              placeholder="0x00"
                              onChange={(e) =>
                                updateRegisterAt(originalIndex, {
                                  ...reg,
                                  offset: e.target.value || null,
                                  reviewStatus: 'edited',
                                })
                              }
                              className="w-20 px-2 py-0.5 bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded font-mono text-xs text-sky-700 dark:text-sky-300"
                            />
                            <input
                              type="text"
                              value={reg.name}
                              onChange={(e) =>
                                updateRegisterAt(originalIndex, {
                                  ...reg,
                                  name: e.target.value,
                                  reviewStatus: 'edited',
                                })
                              }
                              className="w-36 px-2 py-0.5 bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded font-mono text-xs font-semibold text-slate-900 dark:text-white"
                            />
                            <input
                              type="text"
                              value={reg.resetValue ?? ''}
                              placeholder="Reset (null if none)"
                              onChange={(e) =>
                                updateRegisterAt(originalIndex, {
                                  ...reg,
                                  resetValue: e.target.value.trim() || null,
                                  reviewStatus: 'edited',
                                })
                              }
                              className="w-28 px-2 py-0.5 bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded font-mono text-xs text-emerald-700 dark:text-emerald-300"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                              {reg.offset ?? 'not specified in spec'}
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                              {reg.name}
                            </span>
                            <span className="text-slate-400 dark:text-slate-600">·</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              Reset:{' '}
                              <strong className="text-slate-800 dark:text-slate-200 font-normal">
                                {reg.resetValue ?? 'not specified in spec'}
                              </strong>
                            </span>
                            <span className="text-slate-400 dark:text-slate-600">·</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {reg.width ?? spec.busWidth}b ({reg.fields.length} fields)
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right Metadata & Action Controls */}
                      <div
                        className="flex items-center gap-3 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 text-xs">
                          {errors.length > 0 ? (
                            <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {errors.length} Error{errors.length > 1 ? 's' : ''}
                            </span>
                          ) : warnings.length > 0 ? (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {warnings.length} Warn
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Valid
                            </span>
                          )}

                          {reg.repairStatus === 'auto-fixed' && (
                            <button
                              type="button"
                              onClick={() =>
                                setInspectHistoryReg(
                                  inspectHistoryReg?.name === reg.name ? null : reg
                                )
                              }
                              className="flex items-center gap-1 text-sky-600 dark:text-sky-300 hover:text-sky-500 dark:hover:text-sky-200 underline decoration-sky-500/50 underline-offset-2"
                              title="Click to inspect before/after self-repair diff"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              Auto-Fixed
                            </button>
                          )}

                          {reg.repairStatus === 'needs-human-review' && (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-300 font-medium">
                              <Wrench className="w-3.5 h-3.5" />
                              Needs Human Review
                            </span>
                          )}
                        </div>

                        <span className="text-slate-300 dark:text-slate-700">|</span>

                        <span
                          className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400"
                          title="Gemini Extraction Confidence"
                        >
                          Conf: {Math.round((reg.confidence ?? 1) * 100)}%
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            onSelectEvidence(reg.evidence.page, reg.evidence.quote)
                          }
                          className="flex items-center gap-1 text-xs font-mono text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300"
                          title={`Jump to Page ${reg.evidence.page}: "${reg.evidence.quote}"`}
                        >
                          <span>p.{reg.evidence.page}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              updateRegisterAt(originalIndex, {
                                ...reg,
                                reviewStatus: 'accepted',
                              })
                            }
                            className={`p-1 rounded transition-colors ${
                              reg.reviewStatus === 'accepted'
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-emerald-600 dark:hover:text-emerald-300'
                            }`}
                            title="Accept Register"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateRegisterAt(originalIndex, {
                                ...reg,
                                reviewStatus:
                                  reg.reviewStatus === 'rejected' ? 'pending' : 'rejected',
                              })
                            }
                            className={`p-1 rounded transition-colors ${
                              reg.reviewStatus === 'rejected'
                                ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                                : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-rose-600 dark:hover:text-rose-300'
                            }`}
                            title="Reject Register"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRegName(isEditing ? null : reg.name);
                              if (!isExpanded) toggleExpand(reg.name);
                            }}
                            className={`p-1 rounded transition-colors ${
                              isEditing
                                ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
                                : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-sky-300'
                            }`}
                            title="Edit Register & Fields"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Register Detail & Bitfields Table */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 bg-slate-50/80 dark:bg-[#0B0F17]/90 border-t border-slate-200 dark:border-slate-800/60 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                          {isEditing ? (
                            <input
                              type="text"
                              value={reg.description ?? ''}
                              onChange={(e) =>
                                updateRegisterAt(originalIndex, {
                                  ...reg,
                                  description: e.target.value || null,
                                  reviewStatus: 'edited',
                                })
                              }
                              className="flex-1 px-2 py-1 bg-white dark:bg-[#131C2E] border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 text-xs"
                              placeholder="Register description..."
                            />
                          ) : (
                            <p className="text-slate-700 dark:text-slate-300">
                              {reg.description ?? 'Description not specified in spec'}
                            </p>
                          )}

                          <div className="flex items-center gap-2 shrink-0">
                            {hasBitGap && (
                              <button
                                type="button"
                                onClick={() => handleFillReserved(originalIndex)}
                                className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                              >
                                Fill RESERVED Bit Gaps
                              </button>
                            )}
                            {errors.length > 0 && onRunSingleRepair && (
                              <button
                                type="button"
                                disabled={repairingRegName === reg.name}
                                onClick={() => onRunSingleRepair(originalIndex)}
                                className="flex items-center gap-1 px-2.5 py-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-700 dark:text-sky-300 border border-sky-500/40 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                              >
                                <Wrench className="w-3 h-3" />
                                {repairingRegName === reg.name
                                  ? 'Repairing via Gemini...'
                                  : 'AI Self-Repair Register'}
                              </button>
                            )}
                            {isEditing && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => addFieldToReg(originalIndex)}
                                  className="flex items-center gap-1 px-2 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-xs whitespace-nowrap shrink-0"
                                >
                                  <Plus className="w-3 h-3" /> Add Field
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteRegisterAt(originalIndex)}
                                  className="flex items-center gap-1 px-2 py-1 bg-rose-100 dark:bg-rose-950/60 hover:bg-rose-200 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 rounded text-xs whitespace-nowrap shrink-0"
                                >
                                  <Trash2 className="w-3 h-3" /> Delete Reg
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {regIssues.length > 0 && (
                          <div className="space-y-1 bg-white dark:bg-[#111827] p-2.5 rounded border border-slate-200 dark:border-slate-800">
                            {regIssues.map((iss) => (
                              <div
                                key={iss.id}
                                className="flex items-start gap-2 text-xs leading-relaxed"
                              >
                                {iss.severity === 'error' ? (
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
                                ) : iss.severity === 'warning' ? (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0 mt-0.5" />
                                )}
                                <div>
                                  <span
                                    className={
                                      iss.severity === 'error'
                                        ? 'text-rose-700 dark:text-rose-300 font-medium'
                                        : iss.severity === 'warning'
                                        ? 'text-amber-700 dark:text-amber-300 font-medium'
                                        : 'text-sky-700 dark:text-sky-300'
                                    }
                                  >
                                    [{iss.code}] {iss.message}
                                  </span>
                                  {iss.suggestion && (
                                    <span className="text-slate-500 dark:text-slate-400 ml-1.5">
                                      — {iss.suggestion}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Visual 32-Bit Register Allocation Bar */}
                        <div className="flex w-full h-6 rounded overflow-hidden border border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-[#070A10] text-[10px] font-mono">
                          {reg.fields.map((f, fIdx) => {
                            const w = Math.max(
                              1,
                              (f.msb ?? 0) - (f.lsb ?? 0) + 1
                            );
                            const pct = Math.max(
                              3,
                              (w / (reg.width || 32)) * 100
                            );
                            const isRsvd =
                              (f.access ?? '').toUpperCase() === 'RESERVED';
                            return (
                              <div
                                key={fIdx}
                                style={{ width: `${pct}%` }}
                                onClick={() =>
                                  onSelectEvidence(
                                    f.evidence.page,
                                    f.evidence.quote
                                  )
                                }
                                className={`flex items-center justify-center px-1 truncate border-r border-slate-300 dark:border-slate-800 last:border-r-0 cursor-pointer transition-colors ${
                                  isRsvd
                                    ? 'bg-slate-200 dark:bg-slate-900/80 text-slate-500'
                                    : 'bg-sky-100 dark:bg-sky-950/60 hover:bg-sky-200 dark:hover:bg-sky-900/70 text-sky-900 dark:text-sky-200'
                                }`}
                                title={`${f.name} [${f.msb}:${f.lsb}] (${f.access})`}
                              >
                                {f.name}
                              </div>
                            );
                          })}
                        </div>

                        {/* Bitfields Table */}
                        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100 dark:bg-[#131C2E] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                <th className="py-2 px-3 font-medium">Bits</th>
                                <th className="py-2 px-3 font-medium">Field Name</th>
                                <th className="py-2 px-3 font-medium">Access</th>
                                <th className="py-2 px-3 font-medium">Reset</th>
                                <th className="py-2 px-3 font-medium">Description & Enums</th>
                                <th className="py-2 px-3 font-medium text-right">Evidence</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                              {reg.fields.map((field, fIdx) => {
                                const isRsvd =
                                  (field.access ?? '').toUpperCase() === 'RESERVED';
                                return (
                                  <tr
                                    key={`${field.name}-${fIdx}`}
                                    onClick={() =>
                                      onSelectEvidence(
                                        field.evidence.page,
                                        field.evidence.quote
                                      )
                                    }
                                    className={`cursor-pointer transition-colors ${
                                      isRsvd
                                        ? 'bg-slate-50 dark:bg-[#0A0E17] text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-[#111726]'
                                        : 'bg-white dark:bg-[#0F1623] text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162033]'
                                    }`}
                                  >
                                    <td
                                      className="py-2 px-3 font-mono tabular-nums whitespace-nowrap"
                                      onClick={(e) => isEditing && e.stopPropagation()}
                                    >
                                      {isEditing ? (
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            value={field.msb ?? ''}
                                            onChange={(e) =>
                                              updateFieldAt(originalIndex, fIdx, {
                                                msb:
                                                  e.target.value === ''
                                                    ? null
                                                    : Number(e.target.value),
                                              })
                                            }
                                            className="w-12 px-1 py-0.5 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded text-center text-sky-700 dark:text-sky-300"
                                          />
                                          <span>:</span>
                                          <input
                                            type="number"
                                            value={field.lsb ?? ''}
                                            onChange={(e) =>
                                              updateFieldAt(originalIndex, fIdx, {
                                                lsb:
                                                  e.target.value === ''
                                                    ? null
                                                    : Number(e.target.value),
                                              })
                                            }
                                            className="w-12 px-1 py-0.5 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded text-center text-sky-700 dark:text-sky-300"
                                          />
                                        </div>
                                      ) : field.msb !== null && field.lsb !== null ? (
                                        field.msb === field.lsb ? (
                                          `[${field.msb}]`
                                        ) : (
                                          `[${field.msb}:${field.lsb}]`
                                        )
                                      ) : (
                                        <span className="text-amber-600 dark:text-amber-400">
                                          not specified in spec
                                        </span>
                                      )}
                                    </td>

                                    <td
                                      className="py-2 px-3 font-mono font-medium whitespace-nowrap"
                                      onClick={(e) => isEditing && e.stopPropagation()}
                                    >
                                      {isEditing ? (
                                        <input
                                          type="text"
                                          value={field.name}
                                          onChange={(e) =>
                                            updateFieldAt(originalIndex, fIdx, {
                                              name: e.target.value,
                                            })
                                          }
                                          className="w-32 px-1.5 py-0.5 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white"
                                        />
                                      ) : (
                                        field.name
                                      )}
                                    </td>

                                    <td
                                      className="py-2 px-3 font-mono whitespace-nowrap"
                                      onClick={(e) => isEditing && e.stopPropagation()}
                                    >
                                      {isEditing ? (
                                        <select
                                          value={field.access ?? ''}
                                          onChange={(e) =>
                                            updateFieldAt(originalIndex, fIdx, {
                                              access: e.target.value || null,
                                            })
                                          }
                                          className="px-1.5 py-0.5 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded text-sky-700 dark:text-sky-300"
                                        >
                                          <option value="">null (unspecified)</option>
                                          {VALID_ACCESS_TYPES.map((acc) => (
                                            <option key={acc} value={acc}>
                                              {acc}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <span
                                          className={
                                            isRsvd
                                              ? 'text-slate-400 dark:text-slate-500'
                                              : 'text-sky-700 dark:text-sky-300'
                                          }
                                        >
                                          {field.access ?? 'not specified in spec'}
                                        </span>
                                      )}
                                    </td>

                                    <td
                                      className="py-2 px-3 font-mono tabular-nums whitespace-nowrap"
                                      onClick={(e) => isEditing && e.stopPropagation()}
                                    >
                                      {isEditing ? (
                                        <input
                                          type="text"
                                          value={field.resetValue ?? ''}
                                          placeholder="null"
                                          onChange={(e) =>
                                            updateFieldAt(originalIndex, fIdx, {
                                              resetValue: e.target.value.trim() || null,
                                            })
                                          }
                                          className="w-20 px-1.5 py-0.5 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded text-emerald-700 dark:text-emerald-300"
                                        />
                                      ) : field.resetValue !== null &&
                                        field.resetValue !== undefined ? (
                                        <span className="text-emerald-600 dark:text-emerald-300">
                                          {field.resetValue}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 dark:text-slate-500 italic">
                                          not specified in spec
                                        </span>
                                      )}
                                    </td>

                                    <td
                                      className="py-2 px-3 max-w-md"
                                      onClick={(e) => isEditing && e.stopPropagation()}
                                    >
                                      {isEditing ? (
                                        <input
                                          type="text"
                                          value={field.description ?? ''}
                                          onChange={(e) =>
                                            updateFieldAt(originalIndex, fIdx, {
                                              description: e.target.value || null,
                                            })
                                          }
                                          className="w-full px-1.5 py-0.5 bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                                        />
                                      ) : (
                                        <div>
                                          <span>
                                            {field.description ?? 'not specified in spec'}
                                          </span>
                                          {field.enumValues &&
                                            field.enumValues.length > 0 && (
                                              <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-mono text-sky-700 dark:text-sky-300/90">
                                                {field.enumValues.map((ev, k) => (
                                                  <span key={k}>
                                                    {ev.name}={ev.value}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                        </div>
                                      )}
                                    </td>

                                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                                      <div className="inline-flex items-center gap-1.5">
                                        <span className="text-sky-600 dark:text-sky-400 hover:underline">
                                          p.{field.evidence.page}
                                        </span>
                                        {isEditing && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteFieldAt(originalIndex, fIdx);
                                            }}
                                            className="text-rose-500 dark:text-rose-400 hover:text-rose-400 ml-1"
                                            title="Remove field"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Timing Parameters Sub-Tab */}
        {subTab === 'timing' && (
          <div className="p-4">
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#131C2E] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2.5 px-3 font-medium">Parameter</th>
                    <th className="py-2.5 px-3 font-medium text-right">Min</th>
                    <th className="py-2.5 px-3 font-medium text-right">Typ</th>
                    <th className="py-2.5 px-3 font-medium text-right">Max</th>
                    <th className="py-2.5 px-3 font-medium">Unit</th>
                    <th className="py-2.5 px-3 font-medium">Condition</th>
                    <th className="py-2.5 px-3 font-medium text-right">Source Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {spec.timingParameters.map((tp, idx) => (
                    <tr
                      key={idx}
                      onClick={() =>
                        onSelectEvidence(tp.evidence.page, tp.evidence.quote)
                      }
                      className="hover:bg-slate-50 dark:hover:bg-[#141E30] cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-white">
                        {tp.name}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 dark:text-slate-200">
                        {tp.min ?? (
                          <span className="text-slate-400 dark:text-slate-500">not specified</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-sky-600 dark:text-sky-300">
                        {tp.typ ?? (
                          <span className="text-slate-400 dark:text-slate-500">not specified</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 dark:text-slate-200">
                        {tp.max ?? (
                          <span className="text-slate-400 dark:text-slate-500">not specified</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-600 dark:text-emerald-300">
                        {tp.unit ?? '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {tp.condition ?? 'not specified in spec'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sky-600 dark:text-sky-400">
                        p.{tp.evidence.page}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Normative Requirements Sub-Tab */}
        {subTab === 'requirements' && (
          <div className="p-4">
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#131C2E] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2.5 px-3 font-medium">Req ID</th>
                    <th className="py-2.5 px-3 font-medium">Section</th>
                    <th className="py-2.5 px-3 font-medium">Normative Statement ("shall" / "must")</th>
                    <th className="py-2.5 px-3 font-medium text-right">Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {spec.requirements.map((req, idx) => (
                    <tr
                      key={idx}
                      onClick={() => onSelectEvidence(req.page, req.text)}
                      className="hover:bg-slate-50 dark:hover:bg-[#141E30] cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono font-semibold text-sky-600 dark:text-sky-400 whitespace-nowrap">
                        {req.id}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {req.section ?? '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200 leading-relaxed">
                        {req.text}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sky-600 dark:text-sky-400 whitespace-nowrap">
                        p.{req.page}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
