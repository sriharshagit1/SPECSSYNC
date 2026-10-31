import { Type, type Schema } from '@google/genai';

/**
 * Gemini responseSchema definitions matching the Canonical Schema in src/schema/index.ts.
 * Used exclusively by server.ts for structured extraction and self-repair.
 */

export const EVIDENCE_SCHEMA: Schema = {
  type: Type.OBJECT,
  description: 'Exact source evidence from the specification document.',
  properties: {
    page: {
      type: Type.INTEGER,
      description: '1-based page number where this item appears.',
    },
    quote: {
      type: Type.STRING,
      description: 'Short verbatim quote (10-120 chars) from the source text/table proving this extraction.',
    },
  },
  required: ['page', 'quote'],
};

export const ENUM_VALUE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: 'Symbolic name of the enumerated value.',
    },
    value: {
      type: Type.STRING,
      description: 'Hexadecimal or integer value string (e.g., "0x0", "0x1").',
    },
    description: {
      type: Type.STRING,
      nullable: true,
      description: 'Description of this enum state, or null if not stated.',
    },
  },
  required: ['name', 'value'],
};

export const FIELD_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: 'Field name (e.g., "ENABLE", "TX_EMPTY", "RESERVED").',
    },
    msb: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Most significant bit index (inclusive). Return null if not stated.',
    },
    lsb: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Least significant bit index (inclusive). For a single-bit field at bit N, msb=N and lsb=N. Return null if not stated.',
    },
    access: {
      type: Type.STRING,
      nullable: true,
      description: 'Access policy: one of RW, RO, WO, W1C, W1S, RC, RW1C, RESERVED. Return null if not stated.',
    },
    resetValue: {
      type: Type.STRING,
      nullable: true,
      description: 'Field reset value formatted in hex (e.g. "0x0", "0x1"). If not stated in source, return null. Never guess.',
    },
    description: {
      type: Type.STRING,
      nullable: true,
      description: 'Functional description of the field, or null if not stated.',
    },
    enumValues: {
      type: Type.ARRAY,
      items: ENUM_VALUE_SCHEMA,
      description: 'Enumerated encodings for this field, or empty array if none.',
    },
    evidence: EVIDENCE_SCHEMA,
  },
  required: ['name', 'msb', 'lsb', 'access', 'resetValue', 'description', 'enumValues', 'evidence'],
};

export const REGISTER_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: 'Register identifier name (e.g., "CTRL", "STATUS", "BAUD_DIV").',
    },
    offset: {
      type: Type.STRING,
      nullable: true,
      description: 'Hexadecimal byte offset from IP base address (e.g., "0x00", "0x04"). Return null if not stated.',
    },
    width: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Register width in bits (typically 32, 16, or 8). Return null if not stated.',
    },
    description: {
      type: Type.STRING,
      nullable: true,
      description: 'Concise register description, or null if not stated.',
    },
    resetValue: {
      type: Type.STRING,
      nullable: true,
      description: 'Full register reset value in hex (e.g., "0x00000000"). Return null if not stated. Never guess.',
    },
    fields: {
      type: Type.ARRAY,
      items: FIELD_SCHEMA,
      description: 'All bitfields defined for this register.',
    },
    evidence: EVIDENCE_SCHEMA,
    confidence: {
      type: Type.NUMBER,
      description: 'Extraction confidence score between 0.0 and 1.0 based on clarity and completeness of the source table.',
    },
  },
  required: [
    'name',
    'offset',
    'width',
    'description',
    'resetValue',
    'fields',
    'evidence',
    'confidence',
  ],
};

export const TIMING_PARAMETER_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: 'Name or symbol of the timing parameter (e.g., "f_SCLK", "t_SETUP", "Baud Clock Tolerance").',
    },
    min: {
      type: Type.STRING,
      nullable: true,
      description: 'Minimum value as string, or null if not stated.',
    },
    typ: {
      type: Type.STRING,
      nullable: true,
      description: 'Typical value as string, or null if not stated.',
    },
    max: {
      type: Type.STRING,
      nullable: true,
      description: 'Maximum value as string, or null if not stated.',
    },
    unit: {
      type: Type.STRING,
      nullable: true,
      description: 'Unit (e.g., "ns", "MHz", "%", "cycles"), or null if not stated.',
    },
    condition: {
      type: Type.STRING,
      nullable: true,
      description: 'Operating or test conditions, or null if not stated.',
    },
    evidence: EVIDENCE_SCHEMA,
  },
  required: ['name', 'min', 'typ', 'max', 'unit', 'condition', 'evidence'],
};

export const REQUIREMENT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    id: {
      type: Type.STRING,
      description: 'Requirement ID from the spec (e.g. "REQ-UART-001") or generated sequential ID if untagged.',
    },
    text: {
      type: Type.STRING,
      description: 'Verbatim requirement statement containing "shall", "must", or normative specification mandate.',
    },
    section: {
      type: Type.STRING,
      nullable: true,
      description: 'Section number or heading where this requirement appears.',
    },
    page: {
      type: Type.INTEGER,
      description: '1-based page number where this requirement appears.',
    },
  },
  required: ['id', 'text', 'section', 'page'],
};

export const DOCUMENT_MAP_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    ipName: {
      type: Type.STRING,
      nullable: true,
      description: 'Hardware IP block name if stated (e.g. "AXI_UART_16550", "APB_TIMER"). Null if not stated.',
    },
    ipVersion: {
      type: Type.STRING,
      nullable: true,
      description: 'IP version or revision string (e.g. "v1.2", "2.0"). Null if not stated.',
    },
    busWidth: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Data bus width in bits (e.g., 32, 64, 16, 8). Null if not stated.',
    },
    baseAddress: {
      type: Type.STRING,
      nullable: true,
      description: 'Base address in hex (e.g., "0x40000000") if stated, otherwise null.',
    },
    sections: {
      type: Type.ARRAY,
      description: 'Logical sections/chapters of the document with 1-based inclusive page ranges.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'Unique section identifier (e.g., "sec-1", "sec-2").',
          },
          title: {
            type: Type.STRING,
            description: 'Chapter or section title.',
          },
          startPage: {
            type: Type.INTEGER,
            description: '1-based start page number (inclusive).',
          },
          endPage: {
            type: Type.INTEGER,
            description: '1-based end page number (inclusive).',
          },
          hasRegisters: {
            type: Type.BOOLEAN,
            description: 'True if this section contains register maps, address maps, or bitfield descriptions.',
          },
          hasTiming: {
            type: Type.BOOLEAN,
            description: 'True if this section contains AC/DC timing tables, clock specifications, or latency parameters.',
          },
          hasRequirements: {
            type: Type.BOOLEAN,
            description: 'True if this section contains normative engineering requirements ("shall" / "must" statements).',
          },
          summary: {
            type: Type.STRING,
            description: '1-sentence summary of the section contents.',
          },
        },
        required: [
          'id',
          'title',
          'startPage',
          'endPage',
          'hasRegisters',
          'hasTiming',
          'hasRequirements',
          'summary',
        ],
      },
    },
  },
  required: ['ipName', 'ipVersion', 'busWidth', 'baseAddress', 'sections'],
};

export const SECTION_EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    ipName: {
      type: Type.STRING,
      nullable: true,
      description: 'Hardware IP block name if stated in this section, else null.',
    },
    ipVersion: {
      type: Type.STRING,
      nullable: true,
      description: 'IP version if stated in this section, else null.',
    },
    busWidth: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Bus width in bits if stated in this section, else null.',
    },
    baseAddress: {
      type: Type.STRING,
      nullable: true,
      description: 'Base address in hex if stated in this section, else null.',
    },
    registers: {
      type: Type.ARRAY,
      items: REGISTER_SCHEMA,
      description: 'Extracted registers and their bitfields from this section.',
    },
    timingParameters: {
      type: Type.ARRAY,
      items: TIMING_PARAMETER_SCHEMA,
      description: 'Extracted timing parameters from this section.',
    },
    requirements: {
      type: Type.ARRAY,
      items: REQUIREMENT_SCHEMA,
      description: 'Extracted normative requirements ("shall"/"must" statements) from this section.',
    },
  },
  required: ['registers', 'timingParameters', 'requirements'],
};
