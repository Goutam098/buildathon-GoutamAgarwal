import { NextResponse } from "next/server";
import { buildInvoice, batchSummary } from "@/lib/review";
import { readDB, writeDB, seenInvoiceNumbers } from "@/lib/store";
import type { Overrides } from "@/lib/types";

export const runtime = "nodejs";

/** A human fixed something. Re-resolve the invoice from scratch with their decision applied. */
export async function POST(req: Request) {
  const { invoiceId, overrides } = (await req.json()) as {
    invoiceId: string;
    overrides: Overrides;
  };

  const db = readDB();
  const idx = db.batch.findIndex((b) => b.id === invoiceId);
  if (idx === -1) return NextResponse.json({ error: "Invoice not in batch." }, { status: 404 });

  const current = db.batch[idx];
  const merged: Overrides = {
    ...(current.overrides ?? {}),
    ...overrides,
    lineItems: { ...(current.overrides?.lineItems ?? {}), ...(overrides.lineItems ?? {}) },
    edits: { ...(current.overrides?.edits ?? {}), ...(overrides.edits ?? {}) },
  };
  if (overrides.partyLedgerId) merged.createPartyAsNew = false;
  if (overrides.createPartyAsNew) merged.partyLedgerId = null;

  db.batch[idx] = buildInvoice(current.extraction, {
    id: current.id,
    fileName: current.fileName,
    imageUrl: current.imageUrl,
    stock: db.stock,
    seenInvoiceNumbers: seenInvoiceNumbers(db),
    direction: current.direction,
    overrides: merged,
    extractionMs: current.extractionMs,
    source: current.source,
  });

  writeDB(db);
  return NextResponse.json({ invoice: db.batch[idx], summary: batchSummary(db.batch) });
}
