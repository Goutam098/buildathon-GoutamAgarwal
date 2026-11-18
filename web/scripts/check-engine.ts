/**
 * Engine checks.
 *
 * These fixtures are NOT model output and are not a substitute for it. They are
 * hand-written transcriptions of the two sample bills, used to test the matching,
 * validation and export code on its own, without spending an API call. The live
 * extraction path is exercised separately by running the app.
 *
 *   npx tsx scripts/check-engine.ts
 */
import { STOCK_ITEMS } from "../src/lib/masters";
import { gstinIsValid, similarity } from "../src/lib/engine";
import { buildInvoice } from "../src/lib/review";
import { buildTallyXml } from "../src/lib/tally";
import type { ExtractedInvoice } from "../src/lib/types";

const stock: Record<string, number> = {};
for (const s of STOCK_ITEMS) stock[s.id] = s.openingQty;

let failed = 0;
let passed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* --- fixtures: exactly what is printed on the two sample bills ---------- */

const BILL_1: ExtractedInvoice = {
  invoiceNumber: "SBS/25-26/0412",
  invoiceDate: "18-11-2026",
  partyName: "Maheshwari Bhandar",
  partyGstin: "08MNOPQ9876R1Z1",
  supplierName: "SHREE BALAJI STEEL HOUSE",
  supplierGstin: "08ABCDE1234F1Z0",
  lines: [
    { description: "Steel Thali 11 inch", hsn: "7323", qty: 48, unit: "PCS", rate: 185, amount: 8880 },
    { description: "SS Water Bottle 1 Litre", hsn: "7323", qty: 24, unit: "PCS", rate: 240, amount: 5760 },
    { description: "Kadhai 24 cm Heavy Base", hsn: "7323", qty: 12, unit: "PCS", rate: 430, amount: 5160 },
  ],
  taxableValue: 19800,
  cgst: 495,
  sgst: 495,
  igst: null,
  roundOff: null,
  grandTotal: 20790,
  unreadableFields: [],
};

const BILL_2: ExtractedInvoice = {
  invoiceNumber: "SBS/25-26/0413",
  invoiceDate: "18-11-2026",
  partyName: "Shagun Crockery Mart",
  partyGstin: "08QRSTU5678K1ZV",
  supplierName: "SHREE BALAJI STEEL HOUSE",
  supplierGstin: "08ABCDE1234F1Z0",
  lines: [
    { description: "SS Box 2 Ltr", hsn: "7323", qty: 30, unit: "PCS", rate: 310, amount: 9300 },
    { description: "Tadka Pan Small", hsn: "7323", qty: 18, unit: "PCS", rate: 150, amount: 2700 },
    { description: "Steel Thali 11 inch", hsn: "7323", qty: 200, unit: "PCS", rate: 185, amount: 37000 },
  ],
  taxableValue: 49000,
  cgst: 1225,
  sgst: 1225,
  igst: null,
  roundOff: null,
  grandTotal: 51540, // printed; the real sum is 51,450
  unreadableFields: [],
};

const mk = (e: ExtractedInvoice, id: string, overrides = {}) =>
  buildInvoice(e, { id, fileName: `${id}.png`, stock, seenInvoiceNumbers: [], direction: "sales", overrides });

/* --- 1. the clean bill -------------------------------------------------- */
console.log("\nClean bill posts straight through");
const a = mk(BILL_1, "bill-1");
check("status is ready", a.status === "ready", a.flags.map((f) => f.code).join(","));
check("party matched by GSTIN", a.partyLedgerName === "Maheshwari Bhandar" && a.partyScore === 1);
check("all three lines matched", a.lines.every((l) => l.stockItemId !== null));
check("no error flags", !a.flags.some((f) => f.severity === "error"));
check("total reconciles", a.computed.totalDelta === 0, String(a.computed.totalDelta));

/* --- 2. the messy bill -------------------------------------------------- */
console.log("\nMessy bill is held back, with reasons");
const b = mk(BILL_2, "bill-2");
const codes = b.flags.map((f) => f.code);
check("status is review", b.status === "review");
check("unknown party flagged", codes.includes("PARTY_NOT_IN_MASTERS"));
check("two items low confidence", codes.filter((c) => c === "ITEM_LOW_CONFIDENCE").length === 2, codes.join(","));
check("transposed total caught", codes.includes("TOTAL_MISMATCH"));
check("delta is +90", b.computed.totalDelta === 90, String(b.computed.totalDelta));
check("stock shortfall warned", codes.includes("INSUFFICIENT_STOCK"));
check(
  "SS Box 2 Ltr suggests Steel Container 2 Litre",
  b.lines[0].suggestions[0]?.name === "Steel Container 2 Litre",
  b.lines[0].suggestions.map((s) => `${s.name} ${s.score}`).join(" | "),
);
check(
  "Tadka Pan Small suggests Tadka Pan 10 cm",
  b.lines[1].suggestions[0]?.name === "Tadka Pan 10 cm",
  b.lines[1].suggestions.map((s) => `${s.name} ${s.score}`).join(" | "),
);

/* --- 3. size conflicts must not match ----------------------------------- */
console.log("\nSize is meaning");
check("11 inch vs 13 inch is rejected", similarity("Steel Thali 13 inch", "Steel Thali 11 inch") < 0.5,
  similarity("Steel Thali 13 inch", "Steel Thali 11 inch").toFixed(2));
check("11 inch vs 11 inch matches", similarity("Steel Thali 11 inch", "Steel Thali 11 inch") === 1);
check("1 Litre bottle vs 2 Litre container is rejected",
  similarity("SS Water Bottle 1 Litre", "Steel Container 2 Litre") < 0.5);

/* --- 4. human corrections clear the right flags ------------------------- */
console.log("\nHuman decisions are replayed, not patched");
const fixed = mk(BILL_2, "bill-2", {
  createPartyAsNew: true,
  lineItems: { "0": "SI-004", "1": "SI-005" },
});
const fixedCodes = fixed.flags.map((f) => f.code);
check("party resolved", !fixedCodes.includes("PARTY_NOT_IN_MASTERS"));
check("items resolved", !fixedCodes.includes("ITEM_LOW_CONFIDENCE"));
check("ledger will be created", fixedCodes.includes("LEDGER_WILL_BE_CREATED"));
check("the wrong total still blocks it", fixedCodes.includes("TOTAL_MISMATCH") && fixed.status === "review");

const corrected = mk(BILL_2, "bill-2", {
  createPartyAsNew: true,
  lineItems: { "0": "SI-004", "1": "SI-005" },
  edits: { grandTotal: 51450 },
});
check("correcting the total releases it", corrected.status === "ready",
  corrected.flags.filter((f) => f.severity === "error").map((f) => f.code).join(","));
check("stock warning survives the fix", corrected.flags.some((f) => f.code === "INSUFFICIENT_STOCK"));

/* --- 5. Tally XML ------------------------------------------------------- */
console.log("\nTally XML");
const xml = buildTallyXml([a, corrected], [corrected]);
check("is an import envelope", xml.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>"));
check("creates the new ledger first",
  xml.indexOf("<LEDGER NAME=\"Shagun Crockery Mart\"") < xml.indexOf("<VOUCHER"));
check("party is debited as negative", xml.includes("<AMOUNT>-20790.00</AMOUNT>"));
check("tax heads are CGST + SGST", xml.includes("Output CGST 2.5%") && xml.includes("Output SGST 2.5%"));
check("no IGST on an intra-state bill", !xml.includes("Output IGST"));
check("inventory moves with the voucher", xml.includes("<ACTUALQTY>48 PCS</ACTUALQTY>"));
check("rate carries its unit", xml.includes("<RATE>185.00/PCS</RATE>"));
check("bill reference for outstanding", xml.includes("<BILLTYPE>New Ref</BILLTYPE>"));

/* --- 6. purchases are the mirror image --------------------------------- */
console.log("\nPurchases run the same engine the other way round");

const PURCHASE: ExtractedInvoice = {
  invoiceNumber: "JSU/2026-27/1184",
  invoiceDate: "18-11-2026",
  partyName: "Shree Balaji Steel House", // billed TO us
  partyGstin: "08ABCDE1234F1Z0",
  supplierName: "Jindal Steel Udyog", // issued BY them
  supplierGstin: "08JKLMN3579S1ZW",
  lines: [
    { description: "Steel Thali 11 inch", hsn: "7323", qty: 100, unit: "PCS", rate: 142, amount: 14200 },
    { description: "Kadhai 24 cm Heavy Base", hsn: "7323", qty: 30, unit: "PCS", rate: 338, amount: 10140 },
  ],
  taxableValue: 24340,
  cgst: 608.5,
  sgst: 608.5,
  igst: null,
  roundOff: null,
  grandTotal: 25557,
  unreadableFields: [],
};

const pur = buildInvoice(PURCHASE, {
  id: "pur-1",
  fileName: "pur-1.png",
  stock,
  seenInvoiceNumbers: [],
  direction: "purchase",
});
check("counterparty is the issuer, not the bill-to", pur.partyLedgerName === "Jindal Steel Udyog",
  String(pur.partyLedgerName));
check("status is ready", pur.status === "ready", pur.flags.map((f) => f.code).join(","));

// A purchase for more units than we hold is normal — that is what restocking is.
const big = buildInvoice(
  { ...PURCHASE, invoiceNumber: "JSU/2026-27/9999", lines: [{ description: "Steel Thali 11 inch", hsn: "7323", qty: 5000, unit: "PCS", rate: 142, amount: 710000 }], taxableValue: 710000, cgst: 17750, sgst: 17750, grandTotal: 745500 },
  { id: "pur-2", fileName: "pur-2.png", stock, seenInvoiceNumbers: [], direction: "purchase" },
);
check("a large purchase is not a stock shortfall",
  !big.flags.some((f) => f.code === "INSUFFICIENT_STOCK"), big.flags.map((f) => f.code).join(","));

// A customer must never satisfy a supplier lookup, or money lands in the wrong ledger.
const wrongPool = buildInvoice(
  { ...PURCHASE, supplierName: "Maheshwari Bhandar", supplierGstin: "08MNOPQ9876R1Z1" },
  { id: "pur-3", fileName: "pur-3.png", stock, seenInvoiceNumbers: [], direction: "purchase" },
);
check("a customer cannot be matched as a supplier",
  wrongPool.partyLedgerName === null, String(wrongPool.partyLedgerName));

const pxml = buildTallyXml([pur]);
check("emits a Purchase voucher", pxml.includes('VCHTYPE="Purchase"'));
check("supplier is credited (positive, not deemed positive)",
  pxml.includes("<AMOUNT>25557.00</AMOUNT>"));
check("purchase ledger is debited", pxml.includes("Purchase - Local 5%") && pxml.includes("<AMOUNT>-14200.00</AMOUNT>"));
check("input GST, not output", pxml.includes("Input CGST 2.5%") && !pxml.includes("Output CGST"));

/* --- 7. the actual sample bill shipped in web/public/samples ------------ */
console.log("\nSample bill 2 (purchase-invoice-2.png), exactly as printed");

// These are the figures printed on the bill the demo uploads. The grand total
// is deliberately transposed: 48,609 printed against 48,069 computed.
const SAMPLE_2: ExtractedInvoice = {
  invoiceNumber: "NSA/26-27/0912",
  invoiceDate: "18-11-2026",
  partyName: "Shree Balaji Steel House",
  partyGstin: "08ABCDE1234F1Z0",
  supplierName: "Narayan Steel Agency",
  supplierGstin: "08NARAY7531V1ZN",
  lines: [
    { description: "SS Box 2 Ltr", hsn: "7323", qty: 80, unit: "PCS", rate: 236, amount: 18880 },
    { description: "Tadka Pan Small", hsn: "7323", qty: 50, unit: "PCS", rate: 112, amount: 5600 },
    { description: "Steel Thali 11 inch", hsn: "7323", qty: 150, unit: "PCS", rate: 142, amount: 21300 },
  ],
  taxableValue: 45780,
  cgst: 1144.5,
  sgst: 1144.5,
  igst: null,
  roundOff: null,
  grandTotal: 48609,
  unreadableFields: [],
};

const s2 = buildInvoice(SAMPLE_2, {
  id: "sample-2",
  fileName: "purchase-invoice-2.png",
  stock,
  seenInvoiceNumbers: [],
  direction: "purchase",
});
const s2codes = s2.flags.map((f) => f.code);
check("held for review", s2.status === "review");
check("supplier has no ledger", s2codes.includes("PARTY_NOT_IN_MASTERS"));
check("lines add to 45,780", s2.computed.lineSum === 45780, String(s2.computed.lineSum));
check("recomputed total is 48,069", s2.computed.expectedTotal === 48069, String(s2.computed.expectedTotal));
check("difference is exactly 540", s2.computed.totalDelta === 540, String(s2.computed.totalDelta));
check("transposed total flagged", s2codes.includes("TOTAL_MISMATCH"));
check("two items need confirming", s2codes.filter((c) => c === "ITEM_LOW_CONFIDENCE").length === 2, s2codes.join(","));
check("the third item matched outright", s2.lines[2].stockItemName === "Steel Thali 11 inch");
check("a correct GSTIN raises nothing", !s2codes.some((c) => c.startsWith("GSTIN")), s2codes.join(","));

// the whole point: correcting one thing does not release the others
const s2fixed = buildInvoice(SAMPLE_2, {
  id: "sample-2",
  fileName: "purchase-invoice-2.png",
  stock,
  seenInvoiceNumbers: [],
  direction: "purchase",
  overrides: { createPartyAsNew: true, lineItems: { "0": "SI-004", "1": "SI-005" } },
});
check("still blocked by the wrong total", s2fixed.status === "review",
  s2fixed.flags.map((f) => f.code).join(","));

const s2done = buildInvoice(SAMPLE_2, {
  id: "sample-2",
  fileName: "purchase-invoice-2.png",
  stock,
  seenInvoiceNumbers: [],
  direction: "purchase",
  overrides: {
    createPartyAsNew: true,
    lineItems: { "0": "SI-004", "1": "SI-005" },
    edits: { grandTotal: 48069 },
  },
});
check("releases once the total is corrected", s2done.status === "ready",
  s2done.flags.filter((f) => f.severity === "error").map((f) => f.code).join(","));

/* --- 8. GSTIN check digit ---------------------------------------------- */
console.log("\nGSTIN check digit catches what a format check cannot");
check("real-world GSTIN validates", gstinIsValid("27AAPFU0939F1ZV"));
check("second real-world GSTIN validates", gstinIsValid("29AAGCB7383J1Z4"));
check("our invented supplier GSTIN is self-consistent", gstinIsValid("08NARAY7531V1ZN"));
check("our invented shop GSTIN is self-consistent", gstinIsValid("08ABCDE1234F1Z0"));
check(
  "a well-formed GSTIN with one wrong character is rejected",
  !gstinIsValid("08NARAY7531V1Z5"),
);
check(
  "an observed misread is rejected",
  !gstinIsValid("08ANARJ7531V1Z5"),
  "this exact string came back from a real run on the blurred photo",
);

const badGstin = buildInvoice(
  { ...SAMPLE_2, supplierGstin: "08ANARJ7531V1Z5" },
  { id: "g", fileName: "g.png", stock, seenInvoiceNumbers: [], direction: "purchase" },
);
check("a misread GSTIN blocks the voucher",
  badGstin.flags.some((f) => f.code === "GSTIN_CHECKSUM_FAILED" && f.severity === "error"),
  badGstin.flags.map((f) => f.code).join(","));

console.log(failed ? `\n${failed} check(s) failed\n` : `\nAll ${passed} checks passed\n`);
process.exit(failed ? 1 : 0);
