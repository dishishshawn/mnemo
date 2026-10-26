// Calculation questions: Gemini sets the problem and writes the arithmetic, the app works out the
// answer itself. A small evaluator (no eval), number extraction from answers written in text or
// LaTeX, and the tolerance check used both to vet Gemini's questions and to grade the student.

import type { NumericAnswer } from "./db";

const FUNCS: Record<string, (x: number) => number> = {
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sqrt: Math.sqrt,
  abs: Math.abs,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };

/** Writes the multiplication, minus and power signs people use as the ones the evaluator reads. */
function normalize(s: string): string {
  return s
    // "10⁻¹⁴" is 10^-14.
    .replace(/[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (sup) => `^${[...sup].map((c) => SUPERSCRIPT[c]).join("")}`)
    .replace(/[×·⋅∙]/g, "*")
    .replace(/[−–]/g, "-")
    .replace(/÷/g, "/")
    .replace(/\*\*/g, "^")
    // "3.2 x 10^8", "3.2x10^8": an x between a number and 10^ is a times sign.
    .replace(/(\d)\s*[xX]\s*(?=10\s*\^)/g, "$1*");
}

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Z][a-zA-Z0-9]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected "${ch}"`);
  }
  return out;
}

/** Evaluates arithmetic: + - * / ^, parentheses, ln log log2 exp sqrt abs, pi and e. Throws on anything else. */
export function evaluate(expression: string): number {
  const tokens = tokenize(normalize(expression));
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`);
    pos++;
  };

  const expr = (): number => {
    let v = term();
    while (isOp("+") || isOp("-")) v = tokens[pos++].v === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (isOp("*") || isOp("/")) v = tokens[pos++].v === "*" ? v * unary() : v / unary();
    return v;
  };
  // Unary minus binds looser than ^, so -2^2 is -4.
  const unary = (): number => {
    if (isOp("-")) {
      pos++;
      return -unary();
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (isOp("^")) {
      pos++;
      return base ** unary();
    }
    return base;
  };
  const primary = (): number => {
    const tok = peek();
    if (!tok) throw new Error("Unexpected end");
    if (tok.t === "num") {
      pos++;
      return tok.v;
    }
    if (tok.t === "id") {
      pos++;
      if (FUNCS[tok.v] && isOp("(")) {
        pos++;
        const v = expr();
        expect(")");
        return FUNCS[tok.v](v);
      }
      if (tok.v in CONSTS) return CONSTS[tok.v];
      throw new Error(`Unknown name "${tok.v}"`);
    }
    if (tok.v === "(") {
      pos++;
      const v = expr();
      expect(")");
      return v;
    }
    throw new Error(`Unexpected "${tok.v}"`);
  };

  const v = expr();
  if (pos !== tokens.length) throw new Error("Unexpected input after the expression");
  if (!Number.isFinite(v)) throw new Error("Not a finite number");
  return v;
}

/** LaTeX and typography around numbers, flattened so the numbers can be read out. */
function plainNumbers(text: string): string {
  return normalize(
    text
      .replace(/\\text\{([^}]*)\}/g, " $1 ")
      .replace(/\\(?:times|cdot)/g, "*")
      .replace(/\\[,;!]|\\ |~/g, " ")
      .replace(/\{,\}/g, ".")
      .replace(/[${}]/g, " "),
  )
    // Thousands separators: "120,000" is 120000.
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

/** Every number written in a piece of text: "3.2e8", "3.2 × 10^8", "$3.2 \times 10^{8}$", "10^-3", "120,000". */
export function numbersIn(text: string): number[] {
  const s = plainNumbers(text);
  const out: number[] = [];
  const re = /(-?(?:\d+\.?\d*|\.\d+))(?:\s*[eE]\s*([+-]?\d+)|\s*\*\s*10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?)?(\s*\^\s*\(?\s*([+-]?\d+)\s*\)?)?/g;
  for (const m of s.matchAll(re)) {
    const mantissa = Number(m[1]);
    // A letter right before the number makes it part of a name ("log2", "CO2"), not a value.
    const before = s[m.index! - 1];
    if (before && /[a-zA-Z_]/.test(before)) continue;
    if (m[2] !== undefined) out.push(mantissa * 10 ** Number(m[2]));
    else if (m[3] !== undefined) out.push(mantissa * 10 ** Number(m[3]));
    else if (m[4] !== undefined && Math.abs(mantissa) === 10) out.push(Math.sign(mantissa) * 10 ** Number(m[5]));
    else out.push(mantissa);
  }
  return out.filter(Number.isFinite);
}

/** Within 2%. Loose enough for rounding in the working, tight enough to tell answers apart. */
export const TOLERANCE = 0.02;

/** Relative, however small the target ([H+] at pH 13 is 1e-13); only a target of exactly zero needs an absolute margin. */
export function matches(value: number, target: number, tolerance = TOLERANCE): boolean {
  return Math.abs(value - target) <= (target === 0 ? 1e-12 : tolerance * Math.abs(target));
}

/** What the student typed, as a number: an expression ("1/4", "3.2*10^8"), or the first number in it ("3.2e8 cells/mL"). */
export function parseAnswer(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  try {
    return evaluate(s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1"));
  } catch {
    return numbersIn(s)[0] ?? null;
  }
}

/** Three significant figures; large and tiny values as LaTeX scientific notation. */
export function formatNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) {
    const exp = Math.floor(Math.log10(abs));
    const mantissa = v / 10 ** exp;
    return `$${mantissa.toPrecision(3)} \\times 10^{${exp}}$`;
  }
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}

export type CalcCheck = { ok: true; numeric?: NumericAnswer } | { ok: false; reason: string };

/**
 * Vets a generated question that involves a calculation. A numeric question needs an expression
 * that evaluates, and its written answer must arrive at the same number. A multiple-choice
 * question with an expression must show that number in its correct option and in no other.
 * Anything that disagrees is dropped: one of the two is wrong and there's no telling which.
 */
export function checkCalculation(q: {
  type: string;
  expression?: string;
  unit?: string;
  answer: string;
  options: string[];
  answerIndex: number;
}): CalcCheck {
  const expression = q.expression?.trim();
  if (q.type !== "numeric" && (q.type !== "mcq" || !expression)) return { ok: true };
  if (!expression) return { ok: false, reason: "no expression" };
  let value: number;
  try {
    value = evaluate(expression);
  } catch (err) {
    return { ok: false, reason: `expression: ${(err as Error).message}` };
  }
  const numeric: NumericAnswer = { value, unit: q.unit?.trim() ?? "", expression };
  if (q.type === "numeric") {
    return numbersIn(q.answer).some((n) => matches(n, value)) ? { ok: true, numeric } : { ok: false, reason: "answer disagrees with the expression" };
  }
  const hits = q.options.map((o) => numbersIn(o).some((n) => matches(n, value)));
  if (!hits[q.answerIndex]) return { ok: false, reason: "correct option disagrees with the expression" };
  if (hits.filter(Boolean).length > 1) return { ok: false, reason: "several options match" };
  return { ok: true, numeric };
}
