/**
 * The deterministic layer between the model and the books.
 *
 * The language model reads the paper. It is NOT trusted to decide what the
 * entry should be. Everything below is plain, inspectable code:
 *   normalise -> match against the shop's real Tally masters -> score
 *   -> recompute the bill's own arithmetic -> flag anything uncertain.
 *
 * Rule of the house: a wrong entry in the books is worse than no entry.
 * When confidence is short, we flag. We never guess.
 */

import {
  AUTO_ACCEPT,
  LEDGERS,
  REVIEW_FLOOR,
  SHOP,
  STOCK_ITEMS,
  type Ledger,
  type StockItem,
} from "./masters";
import type {
  Computed,
  ExtractedInvoice,
  ExtractedLine,
  Flag,
  ResolvedLine,
  ReviewInvoice,
  Suggestion,
} from "./types";

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Shop bills and Tally masters almost never spell an item the same way.
 * "SS Box 2 Ltr" on paper is "Steel Container 2 Litre" in the books.
 * We canonicalise units and obvious trade abbreviations, and deliberately
 * do NOT invent synonyms (box != container) — that stays a fuzzy match a
 * human confirms once.
 */
const UNIT_RULES: [RegExp, string][] = [
  [/\b(?:litres?|liters?|ltrs?|lt|ltr)\b/g, "l"],
  [/\b(?:inches|inch|in)\b/g, "in"],
  [/\b(?:centimet(?:re|er)s?|cms|cm)\b/g, "cm"],
  [/\b(?:millilit(?:re|er)s?|mls|ml)\b/g, "ml"],
  [/\b(?:grams?|gms|gm|g)\b/g, "g"],
  [/\b(?:kilograms?|kgs|kg)\b/g, "kg"],
  [/\b(?:pieces?|pcs|pc|nos|no)\b/g, "pc"],
  [/\bs\.?s\.?\b/g, "stainless steel"],
  [/\bstainless\s+steel\b/g, "stainless steel"],
  [/\bheavy\s+base\b/g, "heavy"],
  [/\bset\s+of\s+(\d+)\b/g, "set $1"],
];

const STOPWORDS = new Set(["the", "of", "with", "and", "for", "a", "an"]);

export function normalise(input: string): string {
  let s = (input || "").toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9.\s]/g, " ");
  // "2.5l" -> "2.5 l", "24cm" -> "24 cm"
  s = s.replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2");
  for (const [re, to] of UNIT_RULES) s = s.replace(re, to);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function tokenise(input: string): string[] {
  return normalise(input)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    // trailing ".00" style noise
    .map((t) => (/^\d+\.0+$/.test(t) ? String(parseFloat(t)) : t));
}

const isNumeric = (t: string) => /^\d+(?:\.\d+)?$/.test(t);

/* ------------------------------------------------------------------ */
/* Similarity                                                          */
/* ------------------------------------------------------------------ */

function diceTokens(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Map<string, number>();
  for (const t of b) setB.set(t, (setB.get(t) ?? 0) + 1);
  let hits = 0;
  for (const t of a) {
    const n = setB.get(t) ?? 0;
    if (n > 0) {
      hits++;
      setB.set(t, n - 1);
    }
  }
  return (2 * hits) / (a.length + b.length);
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

function diceTrigram(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const g of A) if (B.has(g)) hits++;
  return (2 * hits) / (A.size + B.size);
}

/**
 * Size is meaning in a utensils shop. A 11 inch thali and a 13 inch thali
 * are different products at different prices, and their names are nearly
 * identical, so a plain string-similarity match would happily confuse them.
 * When both names carry size numbers and none agree, we crush the score.
 */
export function similarity(query: string, candidate: string): number {
  const qt = tokenise(query);
  const ct = tokenise(candidate);
  if (!qt.length || !ct.length) return 0;

  const base = Math.max(
    diceTokens(qt, ct),
    0.9 * diceTrigram(normalise(query), normalise(candidate)),
  );

  const qNums = qt.filter(isNumeric);
  const cNums = ct.filter(isNumeric);
  if (qNums.length && cNums.length) {
    const shared = qNums.some((n) => cNums.includes(n));
    if (!shared) return base * 0.4; // different size -> different product
  }
  return base;
}

type Named = { id: string; name: string; aliases: string[] };

function rank<T extends Named>(query: string, pool: T[]): { item: T; score: number }[] {
  const q = normalise(query);
  return pool
    .map((item) => {
      const exact = normalise(item.name) === q || item.aliases.some((a) => normalise(a) === q);
      if (exact) return { item, score: 1 };
      const score = Math.max(
        similarity(query, item.name),
        ...item.aliases.map((a) => similarity(query, a) * 0.98),
      );
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);
}

const asSuggestions = (r: { item: Named; score: number }[]): Suggestion[] =>
  r.slice(0, 3).map(({ item, score }) => ({ id: item.id, name: item.name, score: round2(score) }));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function tallyDate(printed: string): string {
  // "18-11-2026" | "18/11/2026" | "2026-11-18" -> "20261118"
  const d = (printed || "").trim();
  let m = d.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}${m[2].padStart(2, "0")}${m[3].padStart(2, "0")}`;
  m = d.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}${m[2].padStart(2, "0")}${m[1].padStart(2, "0")}`;
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Resolution + validation                                             */
/* ------------------------------------------------------------------ */

export function resolveInvoice(
  extraction: ExtractedInvoice,
  opts: {
    id: string;
    fileName: string;
    imageUrl?: string;
    stock: Record<string, number>;
    seenInvoiceNumbers: string[];
  },
): ReviewInvoice {
  const flags: Flag[] = [];

  /* ---- party -------------------------------------------------- */
  const gstin = (extraction.partyGstin || "").toUpperCase().replace(/\s/g, "");
  const byGstin = gstin ? LEDGERS.find((l) => l.gstin === gstin) : undefined;
  const ranked = rank(extraction.partyName || "", LEDGERS as unknown as Named[]) as {
    item: Ledger;
    score: number;
  }[];
  const top = ranked[0];

  let partyLedger: Ledger | null = null;
  let partyScore = 0;

  if (byGstin) {
    // GSTIN is a government-issued key. If it matches a ledger, that is the party,
    // even when the name on the bill is written differently.
    partyLedger = byGstin;
    partyScore = 1;
  } else if (top && top.score >= AUTO_ACCEPT) {
    partyLedger = top.item;
    partyScore = top.score;
  } else {
    partyScore = top?.score ?? 0;
    flags.push({
      code: "PARTY_NOT_IN_MASTERS",
      severity: "error",
      scope: "party",
      message:
        partyScore >= REVIEW_FLOOR
          ? `"${extraction.partyName}" is not an exact ledger. Closest is "${top.item.name}" (${Math.round(partyScore * 100)}%). Confirm or create the ledger.`
          : `"${extraction.partyName}" has no ledger in Tally. Create it before posting.`,
    });
  }

  if (gstin && !GSTIN_RE.test(gstin)) {
    flags.push({
      code: "GSTIN_MALFORMED",
      severity: "warn",
      scope: "party",
      message: `GSTIN "${gstin}" does not match the 15-character GST format.`,
    });
  }

  /* ---- place of supply ---------------------------------------- */
  const partyStateCode = partyLedger?.stateCode ?? (gstin ? gstin.slice(0, 2) : "");
  const supply: Computed["supply"] = partyStateCode
    ? partyStateCode === SHOP.stateCode
      ? "intra"
      : "inter"
    : "unknown";

  /* ---- lines --------------------------------------------------- */
  const lines: ResolvedLine[] = (extraction.lines || []).map((raw: ExtractedLine, i) => {
    const qty = num(raw.qty);
    const rate = num(raw.rate);
    const amount = num(raw.amount);

    const r = rank(raw.description || "", STOCK_ITEMS as unknown as Named[]) as {
      item: StockItem;
      score: number;
    }[];
    const best = r[0];
    const accepted = best && best.score >= AUTO_ACCEPT ? best.item : null;

    if (!accepted) {
      flags.push({
        code: best && best.score >= REVIEW_FLOOR ? "ITEM_LOW_CONFIDENCE" : "ITEM_NOT_IN_MASTERS",
        severity: "error",
        scope: "line",
        lineIndex: i,
        message:
          best && best.score >= REVIEW_FLOOR
            ? `"${raw.description}" is probably "${best.item.name}" (${Math.round(best.score * 100)}%). Confirm the stock item.`
            : `"${raw.description}" matches no stock item in Tally.`,
      });
    }

    // Arithmetic on the line itself: does qty x rate equal the printed amount?
    if (Math.abs(qty * rate - amount) > 0.5) {
      flags.push({
        code: "LINE_MATH_MISMATCH",
        severity: "error",
        scope: "line",
        lineIndex: i,
        message: `Line ${i + 1}: ${qty} x ${rate} = ${round2(qty * rate)}, but the bill says ${amount}.`,
      });
    }

    const availableQty = accepted ? (opts.stock[accepted.id] ?? 0) : null;
    if (accepted && availableQty !== null && qty > availableQty) {
      flags.push({
        code: "INSUFFICIENT_STOCK",
        severity: "warn",
        scope: "line",
        lineIndex: i,
        message: `Selling ${qty} ${accepted.unit} of "${accepted.name}" but only ${availableQty} in stock. Stock would go negative.`,
      });
    }

    return {
      ...raw,
      qty,
      rate,
      amount,
      stockItemId: accepted?.id ?? null,
      stockItemName: accepted?.name ?? null,
      matchScore: round2(best?.score ?? 0),
      suggestions: asSuggestions(r),
      availableQty,
      gstRate: accepted?.gstRate ?? null,
    };
  });

  if (!lines.length) {
    flags.push({
      code: "NO_LINES",
      severity: "error",
      scope: "invoice",
      message: "No line items could be read from this bill.",
    });
  }

  /* ---- invoice arithmetic -------------------------------------- */
  const lineSum = round2(lines.reduce((s, l) => s + l.amount, 0));
  const statedTaxable = extraction.taxableValue == null ? null : num(extraction.taxableValue);
  const cgst = num(extraction.cgst);
  const sgst = num(extraction.sgst);
  const igst = num(extraction.igst);
  const roundOff = num(extraction.roundOff);
  const statedTotal = extraction.grandTotal == null ? null : num(extraction.grandTotal);

  if (statedTaxable !== null && Math.abs(statedTaxable - lineSum) > 1) {
    flags.push({
      code: "TAXABLE_MISMATCH",
      severity: "error",
      scope: "invoice",
      message: `Line items add up to ${lineSum}, but the bill states a taxable value of ${statedTaxable}.`,
    });
  }

  const taxableBase = statedTaxable ?? lineSum;
  const statedTax = round2(cgst + sgst + igst);
  const rate = lines.find((l) => l.gstRate)?.gstRate ?? 18;
  const expectedTax = round2((taxableBase * rate) / 100);

  if (statedTax > 0 && Math.abs(statedTax - expectedTax) > 1) {
    flags.push({
      code: "GST_MISMATCH",
      severity: "error",
      scope: "invoice",
      message: `GST on the bill is ${statedTax}, but ${rate}% of ${taxableBase} is ${expectedTax}.`,
    });
  }

  if (supply === "intra" && igst > 0) {
    flags.push({
      code: "WRONG_TAX_HEADS",
      severity: "error",
      scope: "invoice",
      message: `Both parties are in ${SHOP.state} (state ${SHOP.stateCode}), so this should be CGST + SGST, not IGST.`,
    });
  }
  if (supply === "inter" && (cgst > 0 || sgst > 0)) {
    flags.push({
      code: "WRONG_TAX_HEADS",
      severity: "error",
      scope: "invoice",
      message: `Party is in state ${partyStateCode} and the shop is in ${SHOP.stateCode}, so this should be IGST.`,
    });
  }
  if (supply === "intra" && cgst > 0 && sgst > 0 && Math.abs(cgst - sgst) > 0.5) {
    flags.push({
      code: "CGST_SGST_UNEQUAL",
      severity: "error",
      scope: "invoice",
      message: `CGST (${cgst}) and SGST (${sgst}) must be equal on an intra-state bill.`,
    });
  }

  const expectedTotal = round2(taxableBase + statedTax + roundOff);
  const totalDelta = statedTotal === null ? null : round2(statedTotal - expectedTotal);

  if (totalDelta !== null && Math.abs(totalDelta) > 1) {
    flags.push({
      code: "TOTAL_MISMATCH",
      severity: "error",
      scope: "invoice",
      message: `Bill total is ${statedTotal}, but ${taxableBase} + ${statedTax} tax = ${expectedTotal}. Off by ${totalDelta}.`,
    });
  }

  /* ---- duplicate ----------------------------------------------- */
  const invNo = (extraction.invoiceNumber || "").trim();
  if (invNo && opts.seenInvoiceNumbers.includes(invNo.toUpperCase())) {
    flags.push({
      code: "DUPLICATE_INVOICE",
      severity: "error",
      scope: "invoice",
      message: `Invoice ${invNo} is already posted. Posting it again would double the sale and the stock movement.`,
    });
  }
  if (!invNo) {
    flags.push({
      code: "NO_INVOICE_NUMBER",
      severity: "error",
      scope: "invoice",
      message: "No invoice number could be read. Tally needs one to post the voucher.",
    });
  }

  for (const f of extraction.unreadableFields ?? []) {
    flags.push({
      code: "UNREADABLE",
      severity: "warn",
      scope: "invoice",
      message: `Could not read clearly: ${f}.`,
    });
  }

  const computed: Computed = {
    lineSum,
    expectedTax,
    expectedTotal,
    statedTotal,
    totalDelta,
    supply,
  };

  return {
    id: opts.id,
    fileName: opts.fileName,
    imageUrl: opts.imageUrl,
    extraction,
    partyLedgerId: partyLedger?.id ?? null,
    partyLedgerName: partyLedger?.name ?? null,
    partyScore: round2(partyScore),
    partySuggestions: asSuggestions(ranked),
    lines,
    flags,
    computed,
    status: flags.some((f) => f.severity === "error") ? "review" : "ready",
  };
}

/** Re-run every check after a human edits a match. Nothing is trusted twice. */
export function revalidate(
  inv: ReviewInvoice,
  stock: Record<string, number>,
  seen: string[],
): ReviewInvoice {
  const patched: ExtractedInvoice = { ...inv.extraction };
  const next = resolveInvoice(patched, {
    id: inv.id,
    fileName: inv.fileName,
    imageUrl: inv.imageUrl,
    stock,
    seenInvoiceNumbers: seen,
  });
  // keep human decisions
  next.partyLedgerId = inv.partyLedgerId ?? next.partyLedgerId;
  next.partyLedgerName = inv.partyLedgerName ?? next.partyLedgerName;
  return next;
}
