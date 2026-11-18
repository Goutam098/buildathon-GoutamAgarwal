import { NextResponse } from "next/server";
import { batchSummary } from "@/lib/review";
import { readDB, writeDB, type PostedLine } from "@/lib/store";
import { round2 } from "@/lib/engine";

export const runtime = "nodejs";

/**
 * Approving is the only thing that touches stock. Nothing before this point has
 * changed a single number in the shop's position.
 *
 * Sales take stock out. Approved purchases put it in. Same engine, same review
 * screen, opposite sign — which is the whole point of doing both halves in one
 * system instead of two.
 */
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids: string[] };
  const db = readDB();

  const approved: string[] = [];
  const refused: { id: string; reason: string }[] = [];

  for (const id of ids) {
    const inv = db.batch.find((b) => b.id === id);
    if (!inv) {
      refused.push({ id, reason: "Not in the current batch." });
      continue;
    }
    if (inv.status !== "ready") {
      refused.push({ id, reason: "Still has unresolved errors." });
      continue;
    }
    // Posting the same document twice would double both the money and the stock.
    if (inv.approved) {
      refused.push({ id, reason: "Already posted." });
      continue;
    }
    const key = (inv.extraction.invoiceNumber || "").toUpperCase();
    if (key && db.posted.some((p) => p.invoiceNumber.toUpperCase() === key && !p.id.startsWith("void-"))) {
      refused.push({ id, reason: `Voucher ${inv.extraction.invoiceNumber} is already posted.` });
      continue;
    }

    const sign = inv.direction === "purchase" ? 1 : -1;
    const lines: PostedLine[] = [];
    for (const l of inv.lines) {
      if (!l.stockItemId) continue;
      db.stock[l.stockItemId] = round2((db.stock[l.stockItemId] ?? 0) + sign * l.qty);
      lines.push({
        stockItemId: l.stockItemId,
        name: l.stockItemName ?? l.description,
        qty: l.qty,
        amount: l.amount,
      });
    }

    inv.approved = true;
    db.posted.push({
      id: inv.id,
      direction: inv.direction,
      invoiceNumber: inv.extraction.invoiceNumber,
      invoiceDate: inv.extraction.invoiceDate,
      party: inv.partyLedgerName ?? inv.extraction.partyName,
      total: inv.computed.statedTotal ?? inv.computed.expectedTotal,
      postedAt: new Date().toISOString(),
      lines,
    });
    approved.push(id);
  }

  writeDB(db);
  return NextResponse.json({
    approved,
    refused,
    stock: db.stock,
    posted: db.posted,
    batch: db.batch,
    summary: batchSummary(db.batch),
  });
}
