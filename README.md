# SpecSync — AI-Assisted Semiconductor Register-Map Compiler & Verifier

SpecSync converts hardware IP specification PDFs into a verified, canonical register-map Intermediate Representation (IR), compiles 8 deterministic output formats from it, and cross-checks the specification against Verilog/SystemVerilog RTL and Firmware C Headers to catch silicon-to-firmware discrepancies.

## Core Architectural Principle

> **The LLM only EXTRACTS into a strict schema (`temperature = 0`). Everything else — hardware invariant validation, self-repair triggering, output code generation, cross-artifact consistency checking, spec revision diffing, and precision/recall evaluation — is 100% deterministic TypeScript code.**
>
> Every extracted register, bitfield, and timing parameter carries source evidence (`{ page, quote }`) so a hardware or firmware engineer can verify it in one click.

---

## Directory Structure

```text
/
├── server.ts                         # Express backend handling Gemini API extraction & repair
├── src/
│   ├── schema/
│   │   ├── index.ts                  # Canonical IR TypeScript interfaces (IPSpec, Register, Field, etc.)
│   │   └── geminiSchemas.ts          # Matching @google/genai responseSchema definitions
│   ├── validators/
│   │   ├── index.ts                  # Pure deterministic register & IP invariant validators
│   │   └── validators.test.ts        # Unit tests for all deterministic validation checks
│   ├── pipeline/
│   │   ├── map.ts                    # Pass 1 (Flash): Document chapter mapping & pdf-lib page slicing
│   │   ├── extract.ts                # Pass 2 (Pro): Parallel section extraction (concurrency=3) & merging
│   │   ├── repair.ts                 # Self-Repair Loop (up to 2 retries with evidence page + error list)
│   │   └── demoData.ts               # Built-in AXI_UART_16550 spec, PDF generator, buggy RTL & C header
│   ├── generators/
│   │   ├── index.ts                  # 8 deterministic template-based code generators (.rdl, .xml, .sv, .h, .py, .md, .csv, .json)
│   │   └── generators.test.ts        # Unit tests for all deterministic output generators
│   ├── crosscheck/
│   │   └── index.ts                  # Deterministic C #define regex parser, RTL parser, fuzzy matcher & diff engine
│   ├── diff/
│   │   └── index.ts                  # Spec Revision Diff (v1 vs v2) & downstream artifact impact analyzer
│   ├── eval/
│   │   └── index.ts                  # Ground-Truth Precision, Recall, and F1 benchmark evaluator
│   └── components/
│       ├── PdfEvidenceViewer.tsx     # PDF.js canvas viewer with page jump & verbatim quote highlighting
│       ├── RegisterTableEditor.tsx   # Interactive register/field editor with live validation & self-repair audit
│       ├── GeneratorsView.tsx        # Syntax-highlighted preview & download for all 8 output formats
│       ├── CrossCheckView.tsx        # Spec vs. RTL vs. Firmware C Header consistency checker UI
│       ├── RevisionDiffView.tsx      # Spec revision comparison & impact analysis UI
│       └── EvalView.tsx              # Precision / Recall / F1 evaluation mode UI
```

---

## Canonical Schema (`src/schema/index.ts`)

- **`IPSpec`**: `{ name, version, busWidth, baseAddress, registers[], timingParameters[], requirements[] }`
- **`Register`**: `{ name, offset (hex|null), width (bits|null), description, resetValue (hex|null), fields[], evidence: { page, quote }, confidence (0..1), repairStatus, reviewStatus, repairHistory }`
- **`Field`**: `{ name, msb, lsb, access ('RW'|'RO'|'WO'|'W1C'|'W1S'|'RC'|'RW1C'|'RESERVED'|null), resetValue (hex|null), description, enumValues[], evidence: { page, quote } }`
- **`TimingParameter`**: `{ name, min, typ, max, unit, condition, evidence: { page, quote } }`
- **`Requirement`**: `{ id, text, section, page }`

---

## Running & Testing Instructions

### 1. Run Unit Tests (Validators & Deterministic Generators)
```bash
npm test
```

### 2. Type-Check & Lint
```bash
npm run lint
```

### 3. Build for Production
```bash
npm run build
```

### 4. Start Development Server
```bash
npm run dev
```
