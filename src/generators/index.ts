import { IPSpec, Register, Field } from '../schema/index.ts';
import { parseNumericValue, formatHex } from '../validators/index.ts';

export type GeneratorFormat =
  | 'systemrdl'
  | 'ipxact'
  | 'uvm_ral'
  | 'c_header'
  | 'markdown'
  | 'json'
  | 'python'
  | 'traceability_csv';

export interface GeneratedArtifact {
  format: GeneratorFormat;
  label: string;
  filename: string;
  extension: string;
  language: string;
  content: string;
  description: string;
}

function sanitizeIdentifier(raw: string, fallback = 'UNNAMED'): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!cleaned) return fallback;
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

function getSortedRegisters(spec: IPSpec): Register[] {
  return [...spec.registers].sort((a, b) => {
    const offA = parseNumericValue(a.offset) ?? 0xffffffffn;
    const offB = parseNumericValue(b.offset) ?? 0xffffffffn;
    return offA < offB ? -1 : offA > offB ? 1 : 0;
  });
}

function getSortedFields(reg: Register): Field[] {
  return [...reg.fields].sort((a, b) => (b.msb ?? 0) - (a.msb ?? 0));
}

/**
 * 1. SystemRDL 2.0 (.rdl) Generator
 */
export function generateSystemRDL(spec: IPSpec): string {
  const ipId = sanitizeIdentifier(spec.name, 'ip_block').toLowerCase();
  const busWidth = spec.busWidth || 32;
  const lines: string[] = [];

  lines.push(`// =============================================================================`);
  lines.push(`// SystemRDL 2.0 Register Description`);
  lines.push(`// IP Block : ${spec.name} (${spec.version ?? 'unversioned'})`);
  lines.push(`// Generated deterministically by SpecSync Canonical Compiler`);
  lines.push(`// =============================================================================`);
  lines.push('');
  lines.push(`addrmap ${ipId}_map {`);
  lines.push(`    name = "${spec.name}";`);
  lines.push(`    default regwidth = ${busWidth};`);
  lines.push(`    default accesswidth = ${busWidth};`);
  lines.push(`    addressing = compact;`);
  lines.push('');

  for (const reg of getSortedRegisters(spec)) {
    const regId = sanitizeIdentifier(reg.name).toLowerCase();
    const regWidth = reg.width ?? busWidth;
    const offVal = parseNumericValue(reg.offset);
    const offStr = offVal !== null ? formatHex(offVal, 8) : '0x00';

    lines.push(`    reg {`);
    lines.push(`        name = "${reg.name}";`);
    if (reg.description) {
      lines.push(`        desc = "${reg.description.replace(/"/g, '\\"')}";`);
    }
    lines.push(`        regwidth = ${regWidth};`);

    for (const field of getSortedFields(reg)) {
      const accessUpper = (field.access ?? 'RW').toUpperCase();
      if (accessUpper === 'RESERVED') continue;

      const fId = sanitizeIdentifier(field.name).toLowerCase();
      const msb = field.msb ?? 0;
      const lsb = field.lsb ?? 0;
      const fResetVal = parseNumericValue(field.resetValue);
      const resetHex = fResetVal !== null ? formatHex(fResetVal) : null;

      let sw = 'rw';
      let hw = 'r';
      let extraProp = '';
      if (accessUpper === 'RO') {
        sw = 'r';
        hw = 'w';
      } else if (accessUpper === 'WO') {
        sw = 'w';
        hw = 'r';
      } else if (accessUpper === 'W1C' || accessUpper === 'RW1C') {
        sw = 'rw';
        hw = 'w';
        extraProp = '        onwrite = woclr;';
      } else if (accessUpper === 'W1S') {
        sw = 'rw';
        hw = 'w';
        extraProp = '        onwrite = woset;';
      } else if (accessUpper === 'RC') {
        sw = 'r';
        hw = 'w';
        extraProp = '        onread = rclr;';
      }

      lines.push(`        field {`);
      if (field.description) {
        lines.push(`            desc = "${field.description.replace(/"/g, '\\"')}";`);
      }
      lines.push(`            sw = ${sw};`);
      lines.push(`            hw = ${hw};`);
      if (extraProp) lines.push(`    ${extraProp}`);
      lines.push(
        `        } ${fId}[${msb}:${lsb}]${resetHex !== null ? ` = ${resetHex}` : ''};`
      );
    }

    lines.push(`    } ${regId} @ ${offStr};`);
    lines.push('');
  }

  lines.push(`};`);
  return lines.join('\n');
}

/**
 * 2. IP-XACT (IEEE 1685-2014 XML subset) Generator
 */
export function generateIPXACT(spec: IPSpec): string {
  const ipName = sanitizeIdentifier(spec.name, 'IP_BLOCK');
  const version = spec.version ?? '1.0';
  const busWidth = spec.busWidth || 32;
  const baseAddr = spec.baseAddress ?? '0x00000000';

  const escXml = (s: string | null | undefined) =>
    (s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const mapAccessToIpxact = (access: string | null): string => {
    const a = (access ?? 'RW').toUpperCase();
    switch (a) {
      case 'RO':
      case 'RC':
        return 'read-only';
      case 'WO':
        return 'write-only';
      case 'W1C':
      case 'RW1C':
      case 'W1S':
      case 'RW':
      default:
        return 'read-write';
    }
  };

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<ipxact:component xmlns:ipxact="http://www.accellera.org/XMLSchema/IPXACT/1685-2014">`);
  lines.push(`  <ipxact:vendor>specsync.eda</ipxact:vendor>`);
  lines.push(`  <ipxact:library>ip</ipxact:library>`);
  lines.push(`  <ipxact:name>${escXml(ipName)}</ipxact:name>`);
  lines.push(`  <ipxact:version>${escXml(version)}</ipxact:version>`);
  lines.push(`  <ipxact:memoryMaps>`);
  lines.push(`    <ipxact:memoryMap>`);
  lines.push(`      <ipxact:name>${escXml(ipName)}_mem_map</ipxact:name>`);
  lines.push(`      <ipxact:addressBlock>`);
  lines.push(`        <ipxact:name>regs</ipxact:name>`);
  lines.push(`        <ipxact:baseAddress>${escXml(baseAddr)}</ipxact:baseAddress>`);
  lines.push(`        <ipxact:range>0x1000</ipxact:range>`);
  lines.push(`        <ipxact:width>${busWidth}</ipxact:width>`);

  for (const reg of getSortedRegisters(spec)) {
    const regWidth = reg.width ?? busWidth;
    const offVal = parseNumericValue(reg.offset);
    const offHex = offVal !== null ? formatHex(offVal, 8) : '0x00';
    const resetVal = parseNumericValue(reg.resetValue);

    lines.push(`        <ipxact:register>`);
    lines.push(`          <ipxact:name>${escXml(sanitizeIdentifier(reg.name))}</ipxact:name>`);
    if (reg.description) {
      lines.push(`          <ipxact:description>${escXml(reg.description)}</ipxact:description>`);
    }
    lines.push(`          <ipxact:addressOffset>${offHex}</ipxact:addressOffset>`);
    lines.push(`          <ipxact:size>${regWidth}</ipxact:size>`);
    if (resetVal !== null) {
      lines.push(`          <ipxact:reset>`);
      lines.push(`            <ipxact:value>${formatHex(resetVal, regWidth)}</ipxact:value>`);
      lines.push(`          </ipxact:reset>`);
    }

    for (const field of getSortedFields(reg)) {
      const accessUpper = (field.access ?? 'RW').toUpperCase();
      if (accessUpper === 'RESERVED') continue;
      const msb = field.msb ?? 0;
      const lsb = field.lsb ?? 0;
      const width = Math.max(1, msb - lsb + 1);

      lines.push(`          <ipxact:field>`);
      lines.push(`            <ipxact:name>${escXml(sanitizeIdentifier(field.name))}</ipxact:name>`);
      if (field.description) {
        lines.push(`            <ipxact:description>${escXml(field.description)}</ipxact:description>`);
      }
      lines.push(`            <ipxact:bitOffset>${lsb}</ipxact:bitOffset>`);
      lines.push(`            <ipxact:bitWidth>${width}</ipxact:bitWidth>`);
      lines.push(`            <ipxact:access>${mapAccessToIpxact(field.access)}</ipxact:access>`);
      if (field.resetValue) {
        lines.push(`            <ipxact:resets>`);
        lines.push(`              <ipxact:reset>`);
        lines.push(`                <ipxact:value>${escXml(field.resetValue)}</ipxact:value>`);
        lines.push(`              </ipxact:reset>`);
        lines.push(`            </ipxact:resets>`);
      }
      lines.push(`          </ipxact:field>`);
    }

    lines.push(`        </ipxact:register>`);
  }

  lines.push(`      </ipxact:addressBlock>`);
  lines.push(`    </ipxact:memoryMap>`);
  lines.push(`  </ipxact:memoryMaps>`);
  lines.push(`</ipxact:component>`);
  return lines.join('\n');
}

/**
 * 3. UVM RAL (.sv) Generator
 */
export function generateUVMRAL(spec: IPSpec): string {
  const ipPrefix = sanitizeIdentifier(spec.name, 'ip').toLowerCase();
  const busWidth = spec.busWidth || 32;
  const busBytes = Math.max(1, Math.floor(busWidth / 8));
  const lines: string[] = [];

  lines.push(`// =============================================================================`);
  lines.push(`// SystemVerilog UVM Register Abstraction Layer (RAL)`);
  lines.push(`// IP Block : ${spec.name} (${spec.version ?? 'v1.0'})`);
  lines.push(`// Generated deterministically by SpecSync Canonical Compiler`);
  lines.push(`// =============================================================================`);
  lines.push('');
  lines.push(`package ${ipPrefix}_ral_pkg;`);
  lines.push(`  import uvm_pkg::*;`);
  lines.push(`  \`include "uvm_macros.svh"`);
  lines.push('');

  const sortedRegs = getSortedRegisters(spec);

  for (const reg of sortedRegs) {
    const regNameLow = sanitizeIdentifier(reg.name).toLowerCase();
    const className = `${ipPrefix}_reg_${regNameLow}`;
    const regWidth = reg.width ?? busWidth;
    const activeFields = getSortedFields(reg).filter(
      (f) => (f.access ?? 'RW').toUpperCase() !== 'RESERVED'
    );

    lines.push(`  // Register: ${reg.name} (${reg.offset ?? 'not specified in spec'})`);
    lines.push(`  class ${className} extends uvm_reg;`);
    lines.push(`    \`uvm_object_utils(${className})`);
    lines.push('');
    for (const f of activeFields) {
      const fNameLow = sanitizeIdentifier(f.name).toLowerCase();
      lines.push(`    rand uvm_reg_field ${fNameLow};`);
    }
    lines.push('');
    lines.push(`    function new(string name = "${className}");`);
    lines.push(`      super.new(name, ${regWidth}, UVM_NO_COVERAGE);`);
    lines.push(`    endfunction`);
    lines.push('');
    lines.push(`    virtual function void build();`);
    for (const f of activeFields) {
      const fNameLow = sanitizeIdentifier(f.name).toLowerCase();
      const msb = f.msb ?? 0;
      const lsb = f.lsb ?? 0;
      const width = Math.max(1, msb - lsb + 1);
      const accessRaw = (f.access ?? 'RW').toUpperCase();
      const uvmAccess = accessRaw === 'RW1C' ? 'W1C' : accessRaw;
      const fResetVal = parseNumericValue(f.resetValue) ?? 0n;
      const hasReset = f.resetValue !== null && f.resetValue !== undefined ? 1 : 0;
      const isVolatile = accessRaw === 'RO' || accessRaw === 'W1C' || accessRaw === 'RC' ? 1 : 0;

      lines.push(
        `      this.${fNameLow} = uvm_reg_field::type_id::create("${fNameLow}");`
      );
      lines.push(
        `      this.${fNameLow}.configure(this, ${width}, ${lsb}, "${uvmAccess}", ${isVolatile}, ${width}'h${fResetVal.toString(16).toUpperCase()}, ${hasReset}, 1, 0);`
      );
    }
    lines.push(`    endfunction`);
    lines.push(`  endclass`);
    lines.push('');
  }

  // Register Block class
  const blockClassName = `${ipPrefix}_reg_block`;
  lines.push(`  // Top-level Register Block for ${spec.name}`);
  lines.push(`  class ${blockClassName} extends uvm_reg_block;`);
  lines.push(`    \`uvm_object_utils(${blockClassName})`);
  lines.push('');
  for (const reg of sortedRegs) {
    const regNameLow = sanitizeIdentifier(reg.name).toLowerCase();
    lines.push(`    rand ${ipPrefix}_reg_${regNameLow} ${regNameLow};`);
  }
  lines.push('');
  lines.push(`    function new(string name = "${blockClassName}");`);
  lines.push(`      super.new(name, UVM_NO_COVERAGE);`);
  lines.push(`    endfunction`);
  lines.push('');
  lines.push(`    virtual function void build();`);
  const baseVal = parseNumericValue(spec.baseAddress) ?? 0n;
  lines.push(
    `      this.default_map = create_map("default_map", 'h${baseVal.toString(16).toUpperCase()}, ${busBytes}, UVM_LITTLE_ENDIAN);`
  );
  for (const reg of sortedRegs) {
    const regNameLow = sanitizeIdentifier(reg.name).toLowerCase();
    const className = `${ipPrefix}_reg_${regNameLow}`;
    const offVal = parseNumericValue(reg.offset) ?? 0n;
    const regAccess = reg.fields.every((f) => (f.access ?? '').toUpperCase() === 'RO')
      ? 'RO'
      : 'RW';
    lines.push(`      this.${regNameLow} = ${className}::type_id::create("${regNameLow}");`);
    lines.push(`      this.${regNameLow}.configure(this);`);
    lines.push(`      this.${regNameLow}.build();`);
    lines.push(
      `      this.default_map.add_reg(this.${regNameLow}, 'h${offVal.toString(16).toUpperCase()}, "${regAccess}");`
    );
  }
  lines.push(`      lock_model();`);
  lines.push(`    endfunction`);
  lines.push(`  endclass`);
  lines.push('');
  lines.push(`endpackage : ${ipPrefix}_ral_pkg`);
  return lines.join('\n');
}

/**
 * 4. C Firmware Header (.h) Generator
 */
export function generateCHeader(spec: IPSpec): string {
  const prefix = sanitizeIdentifier(spec.name, 'IP').toUpperCase();
  const guard = `_${prefix}_REGS_H_`;
  const busWidth = spec.busWidth || 32;
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * @file ${prefix.toLowerCase()}_regs.h`);
  lines.push(` * @brief Canonical C Firmware Register Definitions for ${spec.name} (${spec.version ?? 'v1.0'})`);
  lines.push(` * @note Deterministically generated by SpecSync. Do not hand-edit.`);
  lines.push(` */`);
  lines.push(`#ifndef ${guard}`);
  lines.push(`#define ${guard}`);
  lines.push('');
  lines.push(`#include <stdint.h>`);
  lines.push('');

  if (spec.baseAddress) {
    const baseVal = parseNumericValue(spec.baseAddress);
    lines.push(
      `#define ${prefix}_BASE_ADDR (${baseVal !== null ? formatHex(baseVal, 32) + 'UL' : spec.baseAddress})`
    );
    lines.push('');
  }

  for (const reg of getSortedRegisters(spec)) {
    const rName = sanitizeIdentifier(reg.name).toUpperCase();
    const rWidth = reg.width ?? busWidth;
    const offVal = parseNumericValue(reg.offset);
    const rstVal = parseNumericValue(reg.resetValue);

    lines.push(`/* -------------------------------------------------------------------------- */`);
    lines.push(`/* Register: ${reg.name} (${reg.offset ?? 'not specified in spec'}) - ${reg.description ?? 'No description'} */`);
    lines.push(`/* -------------------------------------------------------------------------- */`);
    if (offVal !== null) {
      lines.push(`#define ${prefix}_${rName}_OFFSET (${formatHex(offVal, 8)}U)`);
    }
    if (rstVal !== null) {
      lines.push(`#define ${prefix}_${rName}_RESET  (${formatHex(rstVal, rWidth)}UL)`);
    }

    for (const field of getSortedFields(reg)) {
      const accessUpper = (field.access ?? 'RW').toUpperCase();
      if (accessUpper === 'RESERVED') continue;
      if (field.msb === null || field.lsb === null) continue;

      const fName = sanitizeIdentifier(field.name).toUpperCase();
      const width = Math.max(1, field.msb - field.lsb + 1);
      const rawMask = ((1n << BigInt(width)) - 1n) << BigInt(field.lsb);

      lines.push(`#define ${prefix}_${rName}_${fName}_SHIFT (${field.lsb}U)`);
      lines.push(`#define ${prefix}_${rName}_${fName}_WIDTH (${width}U)`);
      lines.push(`#define ${prefix}_${rName}_${fName}_MASK  (${formatHex(rawMask, rWidth)}UL)`);

      for (const ev of field.enumValues ?? []) {
        const evName = sanitizeIdentifier(ev.name).toUpperCase();
        const evVal = parseNumericValue(ev.value);
        if (evVal !== null) {
          lines.push(
            `#define ${prefix}_${rName}_${fName}_${evName} (${formatHex(evVal)}U)`
          );
        }
      }
    }
    lines.push('');
  }

  lines.push(`#endif /* ${guard} */`);
  return lines.join('\n');
}

/**
 * 5. Markdown Register Documentation (.md) Generator
 */
export function generateMarkdownDoc(spec: IPSpec): string {
  const lines: string[] = [];
  lines.push(`# ${spec.name} Register & Architecture Specification`);
  lines.push('');
  lines.push(`- **Version**: ${spec.version ?? 'Not specified in spec'}`);
  lines.push(`- **Bus Width**: ${spec.busWidth} bits`);
  lines.push(`- **Base Address**: \`${spec.baseAddress ?? 'Not specified in spec'}\``);
  lines.push('');
  lines.push(`## 1. Register Map Summary`);
  lines.push('');
  lines.push(`| Offset | Register | Width | Reset Value | Description | Source Page |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

  for (const reg of getSortedRegisters(spec)) {
    lines.push(
      `| \`${reg.offset ?? 'N/A'}\` | **${reg.name}** | ${reg.width ?? spec.busWidth}-bit | \`${reg.resetValue ?? 'N/A'}\` | ${reg.description ?? '—'} | p. ${reg.evidence.page} |`
    );
  }
  lines.push('');
  lines.push(`## 2. Detailed Register Bitfields`);
  lines.push('');

  for (const reg of getSortedRegisters(spec)) {
    lines.push(`### ${reg.name} (\`${reg.offset ?? 'N/A'}\`)`);
    lines.push('');
    lines.push(
      `> **Reset**: \`${reg.resetValue ?? 'Not specified in spec'}\` · **Width**: ${reg.width ?? spec.busWidth}-bit · **Source**: Page ${reg.evidence.page} (*"${reg.evidence.quote}"*)`
    );
    lines.push('');
    if (reg.description) {
      lines.push(`${reg.description}`);
      lines.push('');
    }
    lines.push(`| Bits | Field Name | Access | Reset | Description |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const f of getSortedFields(reg)) {
      const bitStr =
        f.msb !== null && f.lsb !== null
          ? f.msb === f.lsb
            ? `[${f.msb}]`
            : `[${f.msb}:${f.lsb}]`
          : 'N/A';
      const enumStr =
        f.enumValues && f.enumValues.length > 0
          ? ` (Values: ${f.enumValues.map((e) => `\`${e.name}=${e.value}\``).join(', ')})`
          : '';
      lines.push(
        `| \`${bitStr}\` | \`${f.name}\` | ${f.access ?? 'N/A'} | \`${f.resetValue ?? 'N/A'}\` | ${f.description ?? '—'}${enumStr} |`
      );
    }
    lines.push('');
  }

  if (spec.timingParameters.length > 0) {
    lines.push(`## 3. Timing Parameters`);
    lines.push('');
    lines.push(`| Parameter | Min | Typ | Max | Unit | Condition | Page |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
    for (const tp of spec.timingParameters) {
      lines.push(
        `| **${tp.name}** | ${tp.min ?? '—'} | ${tp.typ ?? '—'} | ${tp.max ?? '—'} | ${tp.unit ?? '—'} | ${tp.condition ?? '—'} | p. ${tp.evidence.page} |`
      );
    }
    lines.push('');
  }

  if (spec.requirements.length > 0) {
    lines.push(`## 4. Extracted Engineering Requirements`);
    lines.push('');
    lines.push(`| ID | Section | Page | Requirement Statement |`);
    lines.push(`| :--- | :--- | :--- | :--- |`);
    for (const req of spec.requirements) {
      lines.push(
        `| \`${req.id}\` | ${req.section ?? '—'} | p. ${req.page} | ${req.text} |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 6. Canonical JSON IR (.json) Generator
 */
export function generateCanonicalJSON(spec: IPSpec): string {
  return JSON.stringify(spec, null, 2);
}

/**
 * 7. Python Silicon Bring-Up Stub (.py) Generator
 */
export function generatePythonStub(spec: IPSpec): string {
  const className = sanitizeIdentifier(spec.name, 'IPBlock');
  const baseVal = parseNumericValue(spec.baseAddress) ?? 0n;
  const lines: string[] = [];

  lines.push(`"""`);
  lines.push(`Silicon Bring-Up & Register Access Driver for ${spec.name} (${spec.version ?? 'v1.0'})`);
  lines.push(`Deterministically generated by SpecSync Canonical Compiler.`);
  lines.push(`"""`);
  lines.push(`from typing import Callable, Dict, Any`);
  lines.push('');
  lines.push(`class ${className}Driver:`);
  lines.push(`    BASE_ADDRESS = ${formatHex(baseVal, 32)}`);
  lines.push('');
  lines.push(`    def __init__(self, read_word: Callable[[int], int], write_word: Callable[[int, int], None], base_addr: int = BASE_ADDRESS):`);
  lines.push(`        self._read = read_word`);
  lines.push(`        self._write = write_word`);
  lines.push(`        self.base_addr = base_addr`);
  lines.push('');

  for (const reg of getSortedRegisters(spec)) {
    const rLow = sanitizeIdentifier(reg.name).toLowerCase();
    const offVal = parseNumericValue(reg.offset) ?? 0n;
    const offHex = formatHex(offVal, 8);

    lines.push(`    # ------------------------------------------------------------------`);
    lines.push(`    # Register: ${reg.name} (Offset ${offHex}) - ${reg.description ?? ''}`);
    lines.push(`    # ------------------------------------------------------------------`);
    lines.push(`    def read_${rLow}(self) -> int:`);
    lines.push(`        return self._read(self.base_addr + ${offHex})`);
    lines.push('');
    lines.push(`    def write_${rLow}(self, value: int) -> None:`);
    lines.push(`        self._write(self.base_addr + ${offHex}, value & 0xFFFFFFFF)`);
    lines.push('');
    lines.push(`    def decode_${rLow}(self) -> Dict[str, int]:`);
    lines.push(`        raw = self.read_${rLow}()`);
    lines.push(`        return {`);
    for (const f of getSortedFields(reg)) {
      if ((f.access ?? '').toUpperCase() === 'RESERVED') continue;
      if (f.msb === null || f.lsb === null) continue;
      const fLow = sanitizeIdentifier(f.name).toLowerCase();
      const width = Math.max(1, f.msb - f.lsb + 1);
      const maskHex = formatHex((1n << BigInt(width)) - 1n);
      lines.push(`            "${fLow}": (raw >> ${f.lsb}) & ${maskHex},`);
    }
    lines.push(`        }`);
    lines.push('');

    for (const f of getSortedFields(reg)) {
      const accessUpper = (f.access ?? 'RW').toUpperCase();
      if (accessUpper === 'RESERVED') continue;
      if (f.msb === null || f.lsb === null) continue;
      const fLow = sanitizeIdentifier(f.name).toLowerCase();
      const width = Math.max(1, f.msb - f.lsb + 1);
      const maskHex = formatHex((1n << BigInt(width)) - 1n);

      lines.push(`    def get_${rLow}_${fLow}(self) -> int:`);
      lines.push(`        """Read field ${reg.name}.${f.name} [${f.msb}:${f.lsb}] (${accessUpper})"""`);
      lines.push(`        return (self.read_${rLow}() >> ${f.lsb}) & ${maskHex}`);
      lines.push('');

      if (accessUpper !== 'RO' && accessUpper !== 'RC') {
        lines.push(`    def set_${rLow}_${fLow}(self, field_val: int) -> None:`);
        lines.push(`        """Modify field ${reg.name}.${f.name} [${f.msb}:${f.lsb}] (${accessUpper})"""`);
        lines.push(`        curr = self.read_${rLow}()`);
        lines.push(`        cleared = curr & ~(${maskHex} << ${f.lsb})`);
        lines.push(`        updated = cleared | ((field_val & ${maskHex}) << ${f.lsb})`);
        lines.push(`        self.write_${rLow}(updated)`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/**
 * 8. Requirement-to-Test Traceability CSV Skeleton (.csv) Generator
 */
export function generateTraceabilityCSV(spec: IPSpec): string {
  const escCsv = (val: string | number | null | undefined) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows: string[] = [
    'requirement_id,section,page,requirement_text,test_name,status',
  ];

  for (const req of spec.requirements) {
    rows.push(
      [
        escCsv(req.id),
        escCsv(req.section ?? ''),
        escCsv(req.page),
        escCsv(req.text),
        '', // empty test_name column for verification team
        '', // empty status column
      ].join(',')
    );
  }

  return rows.join('\n');
}

/**
 * Generates all 8 deterministic artifacts from the canonical IPSpec.
 */
export function generateAllArtifacts(spec: IPSpec): GeneratedArtifact[] {
  const baseName = sanitizeIdentifier(spec.name, 'specsync_ip').toLowerCase();
  return [
    {
      format: 'c_header',
      label: 'C Firmware Header (.h)',
      filename: `${baseName}_regs.h`,
      extension: '.h',
      language: 'c',
      description: 'ANSI C #defines for register offsets, reset values, bit masks, shifts, and enums.',
      content: generateCHeader(spec),
    },
    {
      format: 'systemrdl',
      label: 'SystemRDL 2.0 (.rdl)',
      filename: `${baseName}.rdl`,
      extension: '.rdl',
      language: 'systemrdl',
      description: 'Accellera SystemRDL 2.0 addrmap, reg, and field hierarchy with sw/hw access semantics.',
      content: generateSystemRDL(spec),
    },
    {
      format: 'uvm_ral',
      label: 'UVM RAL Model (.sv)',
      filename: `${baseName}_ral_pkg.sv`,
      extension: '.sv',
      language: 'systemverilog',
      description: 'SystemVerilog UVM Register Abstraction Layer with uvm_reg and uvm_reg_block classes.',
      content: generateUVMRAL(spec),
    },
    {
      format: 'ipxact',
      label: 'IP-XACT IEEE 1685 (.xml)',
      filename: `${baseName}_ipxact.xml`,
      extension: '.xml',
      language: 'xml',
      description: 'IEEE 1685-2014 IP-XACT XML component memoryMap and register definitions.',
      content: generateIPXACT(spec),
    },
    {
      format: 'python',
      label: 'Python Bring-Up Driver (.py)',
      filename: `${baseName}_driver.py`,
      extension: '.py',
      language: 'python',
      description: 'Python hardware bring-up helper class with named register/field read-modify-write accessors.',
      content: generatePythonStub(spec),
    },
    {
      format: 'markdown',
      label: 'Markdown Spec Doc (.md)',
      filename: `${baseName}_spec.md`,
      extension: '.md',
      language: 'markdown',
      description: 'Human-readable register reference manual with bitfield tables, timing, and source quotes.',
      content: generateMarkdownDoc(spec),
    },
    {
      format: 'traceability_csv',
      label: 'Requirement Traceability (.csv)',
      filename: `${baseName}_requirements_trace.csv`,
      extension: '.csv',
      language: 'csv',
      description: 'Verification traceability matrix skeleton mapping "shall/must" requirements to test cases.',
      content: generateTraceabilityCSV(spec),
    },
    {
      format: 'json',
      label: 'Canonical JSON IR (.json)',
      filename: `${baseName}_canonical_ir.json`,
      extension: '.json',
      language: 'json',
      description: 'Complete verified SpecSync Canonical Intermediate Representation with source evidence.',
      content: generateCanonicalJSON(spec),
    },
  ];
}
