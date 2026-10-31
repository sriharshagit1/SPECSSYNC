import { IPSpec, Register, Field } from '../schema/index.ts';
import { parseNumericValue, formatHex } from '../validators/index.ts';
import { normalizeHwName } from '../crosscheck/index.ts';

export type DiffChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface FieldChange {
  fieldName: string;
  changeType: DiffChangeType;
  changes: Array<{
    property: string;
    oldValue: string;
    newValue: string;
  }>;
}

export interface RegisterDiffItem {
  registerName: string;
  offsetOld: string | null;
  offsetNew: string | null;
  changeType: DiffChangeType;
  registerPropertyChanges: Array<{
    property: string;
    oldValue: string;
    newValue: string;
  }>;
  fieldChanges: FieldChange[];
  impactedArtifacts: string[];
  impactedRtlAndHeaderItems: string[];
}

export interface SpecRevisionDiffReport {
  oldVersion: string;
  newVersion: string;
  addedRegisters: number;
  removedRegisters: number;
  modifiedRegisters: number;
  unchangedRegisters: number;
  items: RegisterDiffItem[];
}

function fmtBits(f: Field): string {
  if (f.msb === null || f.lsb === null) return 'unspecified';
  return f.msb === f.lsb ? `[${f.msb}]` : `[${f.msb}:${f.lsb}]`;
}

/**
 * Computes a deterministic structural diff between two IPSpec revisions (v1 vs v2),
 * identifying added, removed, and modified registers/fields and impacted downstream files.
 */
export function computeSpecRevisionDiff(
  oldSpec: IPSpec,
  newSpec: IPSpec
): SpecRevisionDiffReport {
  const items: RegisterDiffItem[] = [];
  const oldRegMap = new Map<string, Register>();
  const newRegMap = new Map<string, Register>();

  for (const r of oldSpec.registers) {
    oldRegMap.set(normalizeHwName(r.name, oldSpec.name), r);
  }
  for (const r of newSpec.registers) {
    newRegMap.set(normalizeHwName(r.name, newSpec.name), r);
  }

  const allKeys = new Set<string>([...oldRegMap.keys(), ...newRegMap.keys()]);
  const prefix = newSpec.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

  for (const key of allKeys) {
    const oldReg = oldRegMap.get(key);
    const newReg = newRegMap.get(key);

    if (!oldReg && newReg) {
      const rUpper = newReg.name.toUpperCase();
      items.push({
        registerName: newReg.name,
        offsetOld: null,
        offsetNew: newReg.offset,
        changeType: 'added',
        registerPropertyChanges: [
          { property: 'offset', oldValue: '—', newValue: newReg.offset ?? 'null' },
          { property: 'resetValue', oldValue: '—', newValue: newReg.resetValue ?? 'null' },
        ],
        fieldChanges: newReg.fields.map((f) => ({
          fieldName: f.name,
          changeType: 'added',
          changes: [
            { property: 'bits', oldValue: '—', newValue: fmtBits(f) },
            { property: 'access', oldValue: '—', newValue: f.access ?? 'null' },
            { property: 'reset', oldValue: '—', newValue: f.resetValue ?? 'null' },
          ],
        })),
        impactedArtifacts: [
          `C Header: Add #define ${prefix}_${rUpper}_OFFSET & field masks`,
          `SystemRDL: Add reg ${newReg.name.toLowerCase()} @ ${newReg.offset}`,
          `UVM RAL: Add class ${prefix.toLowerCase()}_reg_${newReg.name.toLowerCase()}`,
          `IP-XACT: Add <ipxact:register> ${newReg.name}`,
          `Python Driver: Add read_${newReg.name.toLowerCase()}() / write_${newReg.name.toLowerCase()}()`,
        ],
        impactedRtlAndHeaderItems: [
          `RTL Address Decoder: Decode offset ${newReg.offset} for ${newReg.name}`,
          `Firmware Header: Define ${prefix}_${rUpper}_OFFSET`,
        ],
      });
      continue;
    }

    if (oldReg && !newReg) {
      const rUpper = oldReg.name.toUpperCase();
      items.push({
        registerName: oldReg.name,
        offsetOld: oldReg.offset,
        offsetNew: null,
        changeType: 'removed',
        registerPropertyChanges: [
          { property: 'offset', oldValue: oldReg.offset ?? 'null', newValue: 'Removed' },
        ],
        fieldChanges: oldReg.fields.map((f) => ({
          fieldName: f.name,
          changeType: 'removed',
          changes: [{ property: 'bits', oldValue: fmtBits(f), newValue: 'Removed' }],
        })),
        impactedArtifacts: [
          `C Header: Deprecate/remove #define ${prefix}_${rUpper}_OFFSET`,
          `UVM RAL: Remove ${oldReg.name.toLowerCase()} from reg_block map`,
          `SystemRDL & IP-XACT: Remove register ${oldReg.name}`,
        ],
        impactedRtlAndHeaderItems: [
          `RTL: Remove register ${oldReg.name} at ${oldReg.offset} and return bus error/0`,
          `Firmware: Audit C code referencing ${prefix}_${rUpper}_* macros`,
        ],
      });
      continue;
    }

    if (oldReg && newReg) {
      const regChanges: Array<{ property: string; oldValue: string; newValue: string }> = [];
      const impactedArtifacts = new Set<string>();
      const impactedRtlHdr = new Set<string>();
      const rUpper = newReg.name.toUpperCase();

      const oldOff = parseNumericValue(oldReg.offset);
      const newOff = parseNumericValue(newReg.offset);
      if (oldOff !== newOff) {
        regChanges.push({
          property: 'offset',
          oldValue: oldOff !== null ? formatHex(oldOff, 8) : String(oldReg.offset),
          newValue: newOff !== null ? formatHex(newOff, 8) : String(newReg.offset),
        });
        impactedArtifacts.add(`C Header: #define ${prefix}_${rUpper}_OFFSET changed`);
        impactedArtifacts.add(`UVM RAL: default_map.add_reg(${newReg.name.toLowerCase()}) offset changed`);
        impactedArtifacts.add(`SystemRDL / IP-XACT: addressOffset updated`);
        impactedRtlHdr.add(`RTL Address Decode: localparam ADDR_${rUpper} (${oldReg.offset} -> ${newReg.offset})`);
        impactedRtlHdr.add(`Firmware Header: ${prefix}_${rUpper}_OFFSET`);
      }

      const oldRst = parseNumericValue(oldReg.resetValue);
      const newRst = parseNumericValue(newReg.resetValue);
      if (oldRst !== newRst) {
        regChanges.push({
          property: 'resetValue',
          oldValue: oldRst !== null ? formatHex(oldRst, 32) : String(oldReg.resetValue),
          newValue: newRst !== null ? formatHex(newRst, 32) : String(newReg.resetValue),
        });
        impactedArtifacts.add(`C Header: #define ${prefix}_${rUpper}_RESET updated`);
        impactedArtifacts.add(`UVM RAL & IP-XACT: Reset value updated`);
        impactedRtlHdr.add(`RTL Reset Block: ${newReg.name.toLowerCase()}_q <= ${newReg.resetValue}`);
      }

      // Compare fields
      const oldFields = new Map<string, Field>();
      const newFields = new Map<string, Field>();
      for (const f of oldReg.fields) {
        if ((f.access ?? '').toUpperCase() !== 'RESERVED') {
          oldFields.set(normalizeHwName(f.name), f);
        }
      }
      for (const f of newReg.fields) {
        if ((f.access ?? '').toUpperCase() !== 'RESERVED') {
          newFields.set(normalizeHwName(f.name), f);
        }
      }

      const fKeys = new Set<string>([...oldFields.keys(), ...newFields.keys()]);
      const fieldChanges: FieldChange[] = [];

      for (const fk of fKeys) {
        const of = oldFields.get(fk);
        const nf = newFields.get(fk);
        if (!of && nf) {
          fieldChanges.push({
            fieldName: nf.name,
            changeType: 'added',
            changes: [
              { property: 'bits', oldValue: '—', newValue: fmtBits(nf) },
              { property: 'access', oldValue: '—', newValue: nf.access ?? 'null' },
              { property: 'resetValue', oldValue: '—', newValue: nf.resetValue ?? 'null' },
            ],
          });
          impactedArtifacts.add(`C Header: Add ${prefix}_${rUpper}_${nf.name.toUpperCase()}_MASK/SHIFT`);
          impactedArtifacts.add(`Python Driver: Add get/set_${newReg.name.toLowerCase()}_${nf.name.toLowerCase()}()`);
          impactedRtlHdr.add(`RTL: Wire new field ${newReg.name}.${nf.name} ${fmtBits(nf)}`);
        } else if (of && !nf) {
          fieldChanges.push({
            fieldName: of.name,
            changeType: 'removed',
            changes: [{ property: 'bits', oldValue: fmtBits(of), newValue: 'Removed' }],
          });
          impactedArtifacts.add(`C Header: Remove ${prefix}_${rUpper}_${of.name.toUpperCase()}_MASK/SHIFT`);
          impactedRtlHdr.add(`RTL & Firmware: Remove references to ${oldReg.name}.${of.name}`);
        } else if (of && nf) {
          const fPropChanges: Array<{ property: string; oldValue: string; newValue: string }> = [];
          if (of.msb !== nf.msb || of.lsb !== nf.lsb) {
            fPropChanges.push({
              property: 'bits',
              oldValue: fmtBits(of),
              newValue: fmtBits(nf),
            });
            impactedArtifacts.add(`C Header: Update ${prefix}_${rUpper}_${nf.name.toUpperCase()}_MASK & _SHIFT`);
            impactedArtifacts.add(`UVM RAL: Update ${nf.name.toLowerCase()}.configure() bit offset/width`);
            impactedRtlHdr.add(`RTL Slice & Firmware Mask: ${newReg.name}.${nf.name} moved ${fmtBits(of)} -> ${fmtBits(nf)}`);
          }
          if ((of.access ?? '').toUpperCase() !== (nf.access ?? '').toUpperCase()) {
            fPropChanges.push({
              property: 'access',
              oldValue: of.access ?? 'null',
              newValue: nf.access ?? 'null',
            });
            impactedArtifacts.add(`SystemRDL / UVM RAL: Update access policy for ${newReg.name}.${nf.name}`);
            impactedRtlHdr.add(`RTL Write Logic: ${newReg.name}.${nf.name} access changed ${of.access} -> ${nf.access}`);
          }
          const ofRst = parseNumericValue(of.resetValue);
          const nfRst = parseNumericValue(nf.resetValue);
          if (ofRst !== nfRst) {
            fPropChanges.push({
              property: 'resetValue',
              oldValue: of.resetValue ?? 'null',
              newValue: nf.resetValue ?? 'null',
            });
            impactedRtlHdr.add(`RTL Reset & RAL: ${newReg.name}.${nf.name} reset ${of.resetValue} -> ${nf.resetValue}`);
          }

          if (fPropChanges.length > 0) {
            fieldChanges.push({
              fieldName: nf.name,
              changeType: 'modified',
              changes: fPropChanges,
            });
          }
        }
      }

      const isModified = regChanges.length > 0 || fieldChanges.length > 0;
      items.push({
        registerName: newReg.name,
        offsetOld: oldReg.offset,
        offsetNew: newReg.offset,
        changeType: isModified ? 'modified' : 'unchanged',
        registerPropertyChanges: regChanges,
        fieldChanges,
        impactedArtifacts: Array.from(impactedArtifacts),
        impactedRtlAndHeaderItems: Array.from(impactedRtlHdr),
      });
    }
  }

  return {
    oldVersion: oldSpec.version ?? 'v1.0',
    newVersion: newSpec.version ?? 'v2.0',
    addedRegisters: items.filter((i) => i.changeType === 'added').length,
    removedRegisters: items.filter((i) => i.changeType === 'removed').length,
    modifiedRegisters: items.filter((i) => i.changeType === 'modified').length,
    unchangedRegisters: items.filter((i) => i.changeType === 'unchanged').length,
    items,
  };
}
