import { IPSpec } from '../schema/index.ts';
import { parseNumericValue, formatHex } from '../validators/index.ts';
import { normalizeHwName } from '../crosscheck/index.ts';

export interface MetricScore {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number; // 0 to 1
  recall: number; // 0 to 1
  f1: number; // 0 to 1
}

export interface EvalDiscrepancy {
  category: 'register' | 'field' | 'reset';
  type: 'miss' | 'false_positive';
  item: string;
  expected?: string;
  extracted?: string;
}

export interface EvaluationRunResult {
  id: string;
  timestamp: string;
  ipName: string;
  registerScore: MetricScore;
  fieldScore: MetricScore;
  resetScore: MetricScore;
  overallF1: number;
  discrepancies: EvalDiscrepancy[];
}

function calcMetrics(tp: number, fp: number, fn: number): MetricScore {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  };
}

/**
 * Evaluates extracted IPSpec against a Ground-Truth IPSpec JSON.
 * Computes Precision, Recall, and F1 for:
 *  1. Registers (matched by normalized name + offset)
 *  2. Fields (matched by register + normalized field name + [msb:lsb] bit range)
 *  3. Reset Values (register and field reset accuracy)
 */
export function evaluateAgainstGroundTruth(
  extracted: IPSpec,
  groundTruth: IPSpec
): EvaluationRunResult {
  const discrepancies: EvalDiscrepancy[] = [];

  // 1. Register evaluation (name + offset)
  const gtRegKeyMap = new Map<string, string>();
  for (const r of groundTruth.registers) {
    const norm = normalizeHwName(r.name, groundTruth.name);
    const off = parseNumericValue(r.offset);
    const offStr = off !== null ? formatHex(off, 8) : 'null';
    gtRegKeyMap.set(`${norm}@${offStr}`, `${r.name} (${offStr})`);
  }

  const extRegKeyMap = new Map<string, string>();
  for (const r of extracted.registers) {
    const norm = normalizeHwName(r.name, extracted.name);
    const off = parseNumericValue(r.offset);
    const offStr = off !== null ? formatHex(off, 8) : 'null';
    extRegKeyMap.set(`${norm}@${offStr}`, `${r.name} (${offStr})`);
  }

  let regTP = 0;
  let regFP = 0;
  let regFN = 0;

  for (const [k, label] of gtRegKeyMap.entries()) {
    if (extRegKeyMap.has(k)) {
      regTP++;
    } else {
      regFN++;
      discrepancies.push({
        category: 'register',
        type: 'miss',
        item: label,
        expected: label,
        extracted: 'Missing or wrong offset',
      });
    }
  }
  for (const [k, label] of extRegKeyMap.entries()) {
    if (!gtRegKeyMap.has(k)) {
      regFP++;
      discrepancies.push({
        category: 'register',
        type: 'false_positive',
        item: label,
        expected: 'Not in ground truth',
        extracted: label,
      });
    }
  }

  // 2. Field evaluation (register + field name + [msb:lsb])
  const gtFieldMap = new Map<string, string>();
  for (const r of groundTruth.registers) {
    const rNorm = normalizeHwName(r.name, groundTruth.name);
    for (const f of r.fields) {
      if ((f.access ?? '').toUpperCase() === 'RESERVED') continue;
      const fNorm = normalizeHwName(f.name);
      const key = `${rNorm}.${fNorm}[${f.msb}:${f.lsb}]`;
      gtFieldMap.set(key, `${r.name}.${f.name} [${f.msb}:${f.lsb}]`);
    }
  }

  const extFieldMap = new Map<string, string>();
  for (const r of extracted.registers) {
    const rNorm = normalizeHwName(r.name, extracted.name);
    for (const f of r.fields) {
      if ((f.access ?? '').toUpperCase() === 'RESERVED') continue;
      const fNorm = normalizeHwName(f.name);
      const key = `${rNorm}.${fNorm}[${f.msb}:${f.lsb}]`;
      extFieldMap.set(key, `${r.name}.${f.name} [${f.msb}:${f.lsb}]`);
    }
  }

  let fieldTP = 0;
  let fieldFP = 0;
  let fieldFN = 0;

  for (const [k, label] of gtFieldMap.entries()) {
    if (extFieldMap.has(k)) {
      fieldTP++;
    } else {
      fieldFN++;
      discrepancies.push({
        category: 'field',
        type: 'miss',
        item: label,
        expected: label,
        extracted: 'Missing or wrong bit range',
      });
    }
  }
  for (const [k, label] of extFieldMap.entries()) {
    if (!gtFieldMap.has(k)) {
      fieldFP++;
      discrepancies.push({
        category: 'field',
        type: 'false_positive',
        item: label,
        expected: 'Not in ground truth',
        extracted: label,
      });
    }
  }

  // 3. Reset Value evaluation (across registers and active fields)
  const gtResetMap = new Map<string, { label: string; val: string }>();
  for (const r of groundTruth.registers) {
    const rNorm = normalizeHwName(r.name, groundTruth.name);
    const rRst = parseNumericValue(r.resetValue);
    const rHex = rRst !== null ? formatHex(rRst, 32) : 'null';
    gtResetMap.set(`reg:${rNorm}`, { label: `${r.name} reset`, val: rHex });

    for (const f of r.fields) {
      if ((f.access ?? '').toUpperCase() === 'RESERVED') continue;
      const fNorm = normalizeHwName(f.name);
      const fRst = parseNumericValue(f.resetValue);
      const fHex = fRst !== null ? formatHex(fRst) : 'null';
      gtResetMap.set(`fld:${rNorm}.${fNorm}`, {
        label: `${r.name}.${f.name} reset`,
        val: fHex,
      });
    }
  }

  const extResetMap = new Map<string, { label: string; val: string }>();
  for (const r of extracted.registers) {
    const rNorm = normalizeHwName(r.name, extracted.name);
    const rRst = parseNumericValue(r.resetValue);
    const rHex = rRst !== null ? formatHex(rRst, 32) : 'null';
    extResetMap.set(`reg:${rNorm}`, { label: `${r.name} reset`, val: rHex });

    for (const f of r.fields) {
      if ((f.access ?? '').toUpperCase() === 'RESERVED') continue;
      const fNorm = normalizeHwName(f.name);
      const fRst = parseNumericValue(f.resetValue);
      const fHex = fRst !== null ? formatHex(fRst) : 'null';
      extResetMap.set(`fld:${rNorm}.${fNorm}`, {
        label: `${r.name}.${f.name} reset`,
        val: fHex,
      });
    }
  }

  let rstTP = 0;
  let rstFP = 0;
  let rstFN = 0;

  for (const [k, gtItem] of gtResetMap.entries()) {
    const extItem = extResetMap.get(k);
    if (extItem && extItem.val === gtItem.val) {
      rstTP++;
    } else {
      rstFN++;
      if (extItem) {
        rstFP++;
      }
      discrepancies.push({
        category: 'reset',
        type: 'miss',
        item: gtItem.label,
        expected: gtItem.val,
        extracted: extItem ? extItem.val : 'Not extracted',
      });
    }
  }

  for (const [k, extItem] of extResetMap.entries()) {
    if (!gtResetMap.has(k)) {
      rstFP++;
      discrepancies.push({
        category: 'reset',
        type: 'false_positive',
        item: extItem.label,
        expected: 'Not in ground truth',
        extracted: extItem.val,
      });
    }
  }

  const registerScore = calcMetrics(regTP, regFP, regFN);
  const fieldScore = calcMetrics(fieldTP, fieldFP, fieldFN);
  const resetScore = calcMetrics(rstTP, rstFP, rstFN);
  const overallF1 = Number(
    ((registerScore.f1 + fieldScore.f1 + resetScore.f1) / 3).toFixed(4)
  );

  return {
    id: `eval-${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    ipName: extracted.name,
    registerScore,
    fieldScore,
    resetScore,
    overallF1,
    discrepancies,
  };
}
