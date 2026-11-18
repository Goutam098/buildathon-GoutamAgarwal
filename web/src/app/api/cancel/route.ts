import { NextResponse } from "next/server";
import { batchSummary } from "@/lib/review";
import { readDB, writeDB } from "@/lib/store";
import { round2 } from "@/lib/engine";

export const runtime = "nodejs";

/**
 * Reversal.
 *
 * A counter sale gets cancelled — the customer changes their mind, the card
 * fails, the wrong item was rung up. The stock has already moved by then, so
 * undoing it has to put the units back exactly, once, and never twice.
 *
 * We do not delete the record. The posting stays in history marked void, which
 * is how accounting works and how you stay able to explain a stock count later.
 */
export async function POST(req: Request) {
  const { id } = (await req.json()) as { id: string };
  const db = readDB();

  const inv = db.batch.find((b) => b.id === id);
  const postedIdx = db.posted.findIndex((p) => p.id === id);

  if (postedIdx === -1) {
    return NextResponse.json({ error: "Nothing posted under that id to reverse." }, { status: 400 });
  }
  if (inv?.cancelled) {
    return NextResponse.json({ error: "Already reversed." }, { status: 400 });
  }

  const posted = db.posted[postedIdx];
  // Opposite of whatever the original posting did.
  const sign = posted.direction === "purchase" ? -1 : 1;
  for (const l of posted.lines) {
    db.stock[l.stockItemId] = round2((db.stock[l.stockItemId] ?? 0) + sign * l.qty);
  }

  db.posted.splice(postedIdx, 1);
  db.posted.push({
    ...posted,
    id: `void-${posted.id}`,
    invoiceNumber: `${posted.invoiceNumber} (reversed)`,
    total: -posted.total,
    postedAt: new Date().toISOString(),
  });

  if (inv) {
    inv.cancelled = true;
    inv.approved = false;
  }

  writeDB(db);
  return NextResponse.json({
    ok: true,
    batch: db.batch,
    stock: db.stock,
    posted: db.posted,
    summary: batchSummary(db.batch),
  });
}
