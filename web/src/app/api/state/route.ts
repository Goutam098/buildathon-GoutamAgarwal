import { NextResponse } from "next/server";
import { batchSummary } from "@/lib/review";
import { readDB, resetDB } from "@/lib/store";
import { STOCK_ITEMS, LEDGERS, SHOP } from "@/lib/masters";

export const runtime = "nodejs";

export async function GET() {
  const db = readDB();
  return NextResponse.json({
    shop: SHOP,
    batch: db.batch,
    posted: db.posted,
    stock: db.stock,
    stockItems: STOCK_ITEMS,
    ledgers: LEDGERS,
    summary: batchSummary(db.batch),
  });
}

export async function POST() {
  const db = resetDB();
  return NextResponse.json({ ok: true, stock: db.stock, batch: [], posted: [] });
}
