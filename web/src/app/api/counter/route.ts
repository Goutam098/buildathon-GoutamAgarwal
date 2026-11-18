import { NextResponse } from "next/server";
import { LEDGERS, SHOP, STOCK_ITEMS } from "@/lib/masters";
import { round2 } from "@/lib/engine";
import { buildInvoice, batchSummary } from "@/lib/review";
import { readDB, writeDB, seenInvoiceNumbers, type PostedLine } from "@/lib/store";
import type { ExtractedInvoice } from "@/lib/types";

export const runtime = "nodejs";

/**
 * A sale rung up at the counter.
 *
 * Nothing is read here, because nothing was ever printed. The bill is created
 * in our own system, so the line items already point at real stock items and
 * the arithmetic is ours. It still goes through the same engine as a
 * photographed bill — same validation, same stock check, same voucher — it
 * simply passes every check instantly, because there was never a transcription
 * step to get wrong.
 *
 * This is the half of the paper a shop should stop creating. The camera is for
 * the half that arrives from outside and never will be ours.
 */
export async function POST(req: Request) {
  const { ledgerId, lines } = (await req.json()) as {
    ledgerId: string;
    lines: { stockItemId: string; qty: number }[];
  };

  const ledger = LEDGERS.find((l) => l.id === ledgerId);
  if (!ledger) return NextResponse.json({ error: "Pick a customer." }, { status: 400 });

  const picked = (lines ?? [])
    .map((l) => ({ item: STOCK_ITEMS.find((s) => s.id === l.stockItemId), qty: Number(l.qty) }))
    .filter((l) => l.item && l.qty > 0) as { item: (typeof STOCK_ITEMS)[number]; qty: number }[];

  if (!picked.length) return NextResponse.json({ error: "Add at least one item." }, { status: 400 });

  const db = readDB();
  const number = `SBS/25-26/${String(db.seq).padStart(4, "0")}`;
  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;

  const invoiceLines = picked.map(({ item, qty }) => ({
    description: item.name,
    hsn: item.hsn,
    qty,
    unit: item.unit,
    rate: item.rate,
    amount: round2(item.rate * qty),
  }));

  const taxable = round2(invoiceLines.reduce((s, l) => s + l.amount, 0));
  const gstRate = picked[0].item.gstRate;
  const tax = round2((taxable * gstRate) / 100);
  const intra = ledger.stateCode === SHOP.stateCode;

  const extraction: ExtractedInvoice = {
    invoiceNumber: number,
    invoiceDate: date,
    partyName: ledger.name,
    partyGstin: ledger.gstin,
    supplierName: SHOP.name,
    supplierGstin: SHOP.gstin,
    lines: invoiceLines,
    taxableValue: taxable,
    cgst: intra ? round2(tax / 2) : null,
    sgst: intra ? round2(tax / 2) : null,
    igst: intra ? null : tax,
    roundOff: null,
    grandTotal: round2(taxable + tax),
    unreadableFields: [],
  };

  const inv = buildInvoice(extraction, {
    id: `counter-${Date.now()}`,
    fileName: "Counter sale",
    stock: db.stock,
    seenInvoiceNumbers: seenInvoiceNumbers(db),
    direction: "sales",
    source: "counter",
    extractionMs: 0,
  });

  db.seq += 1;
  db.batch = [inv, ...db.batch];

  // Born clean, so it posts the moment the customer pays. Stock moves now.
  if (inv.status === "ready") {
    const postedLines: PostedLine[] = [];
    for (const l of inv.lines) {
      if (!l.stockItemId) continue;
      db.stock[l.stockItemId] = round2((db.stock[l.stockItemId] ?? 0) - l.qty);
      postedLines.push({
        stockItemId: l.stockItemId,
        name: l.stockItemName ?? l.description,
        qty: l.qty,
        amount: l.amount,
      });
    }
    inv.approved = true;
    db.posted.push({
      id: inv.id,
      direction: "sales",
      invoiceNumber: number,
      invoiceDate: date,
      party: ledger.name,
      total: extraction.grandTotal ?? 0,
      postedAt: new Date().toISOString(),
      lines: postedLines,
    });
  }

  writeDB(db);
  return NextResponse.json({
    invoice: inv,
    batch: db.batch,
    stock: db.stock,
    posted: db.posted,
    summary: batchSummary(db.batch),
  });
}
