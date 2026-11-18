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
import { similarity } from "../src/lib/engine";
import { buildInvoice } from "../src/lib/review";
import { buildTallyXml } from "../src/lib/tally";
import type { ExtractedInvoice } from "../src/lib/types";

const stock: Record<string, number> = {};
for (const s of STOCK_ITEMS) stock[s.id] = s.openingQty;

let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
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
  partyGstin: "08MNOPQ9876R1Z4",
  supplierName: "SHREE BALAJI STEEL HOUSE",
  supplierGstin: "08ABCDE1234F1Z5",
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
  partyGstin: "08QRSTU5678K1Z2",
  supplierName: "SHREE BALAJI STEEL HOUSE",
  supplierGstin: "08ABCDE1234F1Z5",
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

console.log(failed ? `\n${failed} check(s) failed\n` : "\nAll checks passed\n");
process.exit(failed ? 1 : 0);
