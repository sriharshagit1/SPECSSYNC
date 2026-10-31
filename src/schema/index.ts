/**
 * Canonical Register-Map Intermediate Representation (IR) Schema
 *
 * CORE PRINCIPLE:
 * The LLM only EXTRACTS into this strict schema. Everything else
 * (validation, code generation, cross-checking, revision diffing, evaluation)
 * is deterministic TypeScript code.
 */

export type AccessType =
  | 'RW'
  | 'RO'
  | 'WO'
  | 'W1C'
  | 'W1S'
  | 'RC'
  | 'RW1C'
  | 'RESERVED';

export const VALID_ACCESS_TYPES: readonly AccessType[] = [
  'RW',
  'RO',
  'WO',
  'W1C',
  'W1S',
  'RC',
  'RW1C',
  'RESERVED',
] as const;

export interface Evidence {
  page: number;
  quote: string;
}

export interface EnumValue {
  name: string;
  value: string; // Hex or integer string e.g. "0x0" or "0"
  description?: string | null;
}

export interface Field {
  name: string;
  msb: number | null;
  lsb: number | null;
  access: AccessType | string | null;
  resetValue: string | null; // Hex string e.g. "0x0" or null if not specified
  description: string | null;
  enumValues: EnumValue[];
  evidence: Evidence;
}

export type RepairStatus = 'original' | 'auto-fixed' | 'needs-human-review';
export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited';

export interface RepairRecord {
  attempt: number;
  previousRegister: Omit<Register, 'repairHistory'>;
  errorsFixed: string[];
  remainingErrors: string[];
  timestamp: string;
}

export interface Register {
  id?: string;
  name: string;
  offset: string | null; // Hex string e.g. "0x00" or null if not specified
  width: number | null; // Bits e.g. 32
  description: string | null;
  resetValue: string | null; // Hex string e.g. "0x00000000" or null
  fields: Field[];
  evidence: Evidence;
  confidence: number; // 0 to 1
  repairStatus?: RepairStatus;
  reviewStatus?: ReviewStatus;
  repairHistory?: RepairRecord[];
}

export interface TimingParameter {
  name: string;
  symbol?: string | null;
  min: string | null;
  typ: string | null;
  max: string | null;
  unit: string | null;
  condition: string | null;
  evidence: Evidence;
}

export interface Requirement {
  id: string;
  text: string;
  section: string | null;
  page: number;
}

export interface IPSpec {
  name: string;
  version: string | null;
  busWidth: number; // Default 32 if not stated, or extracted
  baseAddress: string | null; // Hex string e.g. "0x4000_0000" or null
  registers: Register[];
  timingParameters: TimingParameter[];
  requirements: Requirement[];
}

/**
 * Pass 1: Document Map produced by Gemini Flash
 */
export interface DocumentSection {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  hasRegisters: boolean;
  hasTiming: boolean;
  hasRequirements: boolean;
  summary: string;
}

export interface DocumentMap {
  ipName: string | null;
  ipVersion: string | null;
  busWidth: number | null;
  baseAddress: string | null;
  totalPages: number;
  sections: DocumentSection[];
}

/**
 * Validation Issue Schema
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCode =
  | 'OVERLAPPING_FIELDS'
  | 'INVALID_BIT_ORDER'
  | 'FIELD_EXCEEDS_WIDTH'
  | 'FIELD_RESET_OVERFLOW'
  | 'RESET_COMPOSITION_MISMATCH'
  | 'OFFSET_COLLISION'
  | 'UNALIGNED_OFFSET'
  | 'DUPLICATE_REGISTER_NAME'
  | 'DUPLICATE_FIELD_NAME'
  | 'ILLEGAL_ACCESS_TYPE'
  | 'MISSING_REQUIRED_VALUE'
  | 'UNACCOUNTED_BIT_GAP'
  | 'OFFSET_GAP';

export interface ValidationIssue {
  id: string;
  code: ValidationCode;
  severity: ValidationSeverity;
  registerName?: string;
  registerOffset?: string | null;
  fieldName?: string;
  message: string;
  suggestion?: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issuesByRegister: Record<string, ValidationIssue[]>;
}
