import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, type Schema } from '@google/genai';
import {
  DOCUMENT_MAP_SCHEMA,
  SECTION_EXTRACTION_SCHEMA,
  REGISTER_SCHEMA,
} from './src/schema/geminiSchemas.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const FLASH_MODEL = 'gemini-flash-latest';
const PRO_MODEL = 'gemini-4-argon';
const FALLBACK_PRO_MODEL = 'gemini-3.8-flash';

/**
 * Helper that calls Gemini with temperature=0, responseMimeType="application/json",
 * exponential backoff on rate limits (429/503), malformed JSON retry, and automatic fallback
 * from gemini-4-argon to gemini-3.8-flash if the user declined a paid API key.
 */
async function callGeminiStructured<T>(params: {
  preferredModel: string;
  systemInstruction: string;
  parts: any[];
  responseSchema: Schema;
  maxRetries?: number;
}): Promise<T> {
  const {
    preferredModel,
    systemInstruction,
    parts,
    responseSchema,
    maxRetries = 3,
  } = params;
  const ai = getGenAIClient();
  let currentModel = preferredModel;
  let lastError: any = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: currentModel,
        contents: { parts },
        config: {
          systemInstruction,
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const rawText = response.text?.trim();
      if (!rawText) {
        throw new Error('Model returned empty JSON response');
      }
      return JSON.parse(rawText) as T;
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err || '');

      // If preferredModel is gemini-4-argon and fails due to billing/permission/not-found on free key, fall back immediately
      if (
        currentModel === PRO_MODEL &&
        (msg.includes('403') ||
          msg.includes('404') ||
          msg.includes('400') ||
          msg.toLowerCase().includes('permission') ||
          msg.toLowerCase().includes('billing') ||
          msg.toLowerCase().includes('paid'))
      ) {
        currentModel = FALLBACK_PRO_MODEL;
        continue;
      }

      // Exponential backoff on rate limit (429) or transient 503
      const delayMs = Math.min(8000, 800 * Math.pow(2, attempt));
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new Error(
    lastError?.message || 'Gemini structured extraction failed after retries'
  );
}

/**
 * Pass 1 (Flash): Document Map & Chapter Classification
 */
app.post('/api/pipeline/map', async (req, res) => {
  try {
    const { pdfBase64, specText, totalPages = 1, fileName = 'spec.pdf' } = req.body;

    const parts: any[] = [];
    if (pdfBase64) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      });
    } else if (specText) {
      parts.push({ text: specText });
    } else {
      res.status(400).json({ error: 'Either pdfBase64 or specText is required.' });
      return;
    }

    parts.push({
      text: `Analyze this hardware IP specification ("${fileName}", ${totalPages} pages total) and produce a complete Document Map of logical chapters/sections with 1-based inclusive page ranges (startPage..endPage).
Flag each section accurately:
- hasRegisters: true if the section contains register map tables, address offsets, or bitfield descriptions.
- hasTiming: true if the section contains AC/DC electrical or clock timing parameters.
- hasRequirements: true if the section contains normative "shall" or "must" engineering requirements.
Also extract top-level IP metadata (ipName, ipVersion, busWidth, baseAddress) if stated. If any value is not stated in the source, return null. Never guess.`,
    });

    const result = await callGeminiStructured({
      preferredModel: FLASH_MODEL,
      systemInstruction:
        'You are a precision semiconductor specification parser. Map the document into chapters with exact 1-based page ranges. If a value is not stated, return null. Never guess.',
      parts,
      responseSchema: DOCUMENT_MAP_SCHEMA,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Document mapping failed' });
  }
});

/**
 * Pass 2 (Pro): Section Register, Timing, and Requirement Extraction
 */
app.post('/api/pipeline/extract', async (req, res) => {
  try {
    const { section, pdfBase64, specText } = req.body;
    if (!section) {
      res.status(400).json({ error: 'Missing section metadata' });
      return;
    }

    const parts: any[] = [];
    if (pdfBase64) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      });
    } else if (specText) {
      parts.push({ text: specText });
    } else {
      res.status(400).json({ error: 'Missing section PDF or text payload' });
      return;
    }

    parts.push({
      text: `Extract all hardware registers, bitfields, timing parameters, and normative ("shall"/"must") requirements from section "${section.title}" (Document Pages ${section.startPage} to ${section.endPage}).
CRITICAL RULES:
1. If a value (such as resetValue, offset, width, access, min, typ, max) is not explicitly stated in the source, return null. Never guess or hallucinate.
2. Every register, field, and timing parameter MUST include an evidence object with the exact 1-based document page number (between ${section.startPage} and ${section.endPage}) and a short verbatim quote from the source text/table.
3. Format hexadecimal values cleanly with "0x" prefix (e.g., "0x00", "0x00000001").
4. For single-bit fields at bit N, set msb = N and lsb = N.
5. Handle multi-page or rotated register tables carefully.`,
    });

    const result = await callGeminiStructured({
      preferredModel: PRO_MODEL,
      systemInstruction:
        'You are a deterministic hardware IP register extractor. Extract strictly what is stated in the source into the canonical schema. If a value is not stated, return null. Never guess.',
      parts,
      responseSchema: SECTION_EXTRACTION_SCHEMA,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Section extraction failed' });
  }
});

/**
 * Pass 2B (OCR Fallback): Image-Based / Scanned PDF Section Extraction
 * Combines high-DPI rasterized page PNG images and client-side Tesseract OCR transcripts
 * to recover register tables when native PDF extraction yields 0 registers.
 */
app.post('/api/pipeline/ocr-extract', async (req, res) => {
  try {
    const { section, pageImages = [], ocrTranscripts = [] } = req.body;
    if (!section) {
      res.status(400).json({ error: 'Missing section metadata for OCR fallback' });
      return;
    }

    const parts: any[] = [];

    if (Array.isArray(pageImages) && pageImages.length > 0) {
      for (const img of pageImages) {
        if (img?.imageBase64) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType || 'image/png',
              data: img.imageBase64,
            },
          });
          parts.push({
            text: `[Rasterized Scanned Page Image — Document Page ${img.pageNumber}]`,
          });
        }
      }
    }

    if (Array.isArray(ocrTranscripts) && ocrTranscripts.length > 0) {
      const combinedTranscript = ocrTranscripts
        .map(
          (t: any) =>
            `--- OCR TRANSCRIPT (Document Page ${t.pageNumber}, Confidence: ${Math.round((t.confidence ?? 0.85) * 100)}%) ---\n${t.text}`
        )
        .join('\n\n');
      parts.push({
        text: `OCR TEXT TRANSCRIPT FROM SCANNED SECTION:\n${combinedTranscript}`,
      });
    }

    if (parts.length === 0) {
      res.status(400).json({
        error: 'OCR fallback requires at least pageImages or ocrTranscripts',
      });
      return;
    }

    parts.push({
      text: `OCR FALLBACK EXTRACTION MODE:
Native PDF extraction failed or returned 0 registers for image-based/scanned section "${section.title}" (Document Pages ${section.startPage} to ${section.endPage}).
Using the rasterized page image(s) and the OCR text transcript above, extract ALL hardware registers, bitfields, timing parameters, and normative ("shall"/"must") requirements into the canonical schema.
CRITICAL OCR RECOVERY RULES:
1. Correct obvious OCR character confusions in hexadecimal literals (e.g., "0x0O" -> "0x00", "0x1l" -> "0x11") and bit ranges (e.g., "[3l:O]" -> "[31:0]").
2. If a value (such as resetValue, offset, width, access, min, typ, max) is not stated in the scanned page or OCR transcript, return null. Never guess.
3. Every register, field, and timing parameter MUST include an evidence object with the exact 1-based document page number (between ${section.startPage} and ${section.endPage}) and a short verbatim quote.`,
    });

    const result = await callGeminiStructured({
      preferredModel: PRO_MODEL,
      systemInstruction:
        'You are a precision OCR hardware specification recovery engine. Extract all registers, bitfields, timing parameters, and requirements from scanned page images and OCR transcripts into the canonical schema. If a value is not stated, return null. Never guess.',
      parts,
      responseSchema: SECTION_EXTRACTION_SCHEMA,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'OCR fallback extraction failed' });
  }
});

/**
 * Self-Repair Loop Endpoint:
 * Receives erroneous Register JSON + evidence page PDF/text + exact deterministic error list.
 */
app.post('/api/pipeline/repair', async (req, res) => {
  try {
    const {
      register,
      busWidth = 32,
      errors = [],
      evidencePagePdfBase64,
      specText,
      pageNumber = 1,
    } = req.body;

    const parts: any[] = [];
    if (evidencePagePdfBase64) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: evidencePagePdfBase64,
        },
      });
    } else if (specText) {
      parts.push({ text: specText });
    }

    parts.push({
      text: `The following extracted register JSON failed deterministic hardware validation on source page ${pageNumber} (busWidth = ${busWidth} bits).

CURRENT REGISTER JSON:
${JSON.stringify(register, null, 2)}

DETERMINISTIC VALIDATION ERRORS TO FIX:
${errors.map((e: string, i: number) => `${i + 1}. ${e}`).join('\n')}

INSTRUCTION:
Fix only what the errors indicate, using the source page. If the value is not stated in the source page, return null. Never guess.`,
    });

    const repaired = await callGeminiStructured({
      preferredModel: PRO_MODEL,
      systemInstruction:
        'Fix only what the validation errors indicate, using the source page. If a value is not stated, return null. Never guess.',
      parts,
      responseSchema: REGISTER_SCHEMA,
    });

    res.json(repaired);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Self-repair call failed' });
  }
});

/**
 * Cross-Artifact Consistency Checker AI Extractor:
 * Extracts canonical register facts from RTL (Verilog/SystemVerilog) or unparseable C Header / RAL code.
 */
app.post('/api/crosscheck/extract', async (req, res) => {
  try {
    const { code, artifactType = 'rtl', ipName = 'IP' } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing artifact source code' });
      return;
    }

    const parts = [
      {
        text: `Extract all register definitions, address offsets, reset values, and bitfields (name, msb, lsb, access, resetValue) from this ${artifactType.toUpperCase()} source file for IP "${ipName}".
If a value is not stated in the source code, return null. Never guess.
For evidence.page, return the approximate 1-based line number where the register/field is defined, and for evidence.quote return the exact code snippet.

SOURCE CODE:
\`\`\`
${code.slice(0, 45000)}
\`\`\``,
      },
    ];

    const result = await callGeminiStructured<{
      registers: any[];
    }>({
      preferredModel: PRO_MODEL,
      systemInstruction:
        'Extract hardware registers, offsets, bit positions, access modes, and reset values from RTL or firmware code into the canonical schema. If a value is not stated, return null. Never guess.',
      parts,
      responseSchema: SECTION_EXTRACTION_SCHEMA,
    });

    res.json({ registers: result.registers ?? [] });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Artifact extraction failed' });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpecSync server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
