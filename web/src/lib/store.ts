/**
 * Tiny file-backed store. Stock levels and posted invoices have to survive a
 * dev-server reload, otherwise a demo that deducts stock proves nothing.
 *
 * On Vercel the project's own folder is read-only at runtime — only /tmp is
 * writable, and it is wiped between cold starts of a serverless function. So
 * on Vercel this is memory for the lifetime of one warm function instance,
 * good enough to click through a live demo, not a real database. Locally it
 * writes next to the project and genuinely persists across restarts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STOCK_ITEMS } from "./masters";
import type { ReviewInvoice } from "./types";

export type PostedLine = { stockItemId: string; name: string; qty: number; amount: number };
export type PostedInvoice = {
  id: string;
  direction: "sales" | "purchase";
  invoiceNumber: string;
  invoiceDate: string;
  party: string;
  total: number;
  postedAt: string;
  lines: PostedLine[];
};

export type DB = {
  stock: Record<string, number>;
  posted: PostedInvoice[];
  batch: ReviewInvoice[];
  /** Next counter-sale voucher number in the shop's own series. */
  seq: number;
};

const DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "overnight-books")
  : path.join(process.cwd(), "data", "runtime");
const FILE = path.join(DIR, "db.json");

function seed(): DB {
  const stock: Record<string, number> = {};
  for (const s of STOCK_ITEMS) stock[s.id] = s.openingQty;
  return { stock, posted: [], batch: [], seq: 414 };
}

export function readDB(): DB {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const db = JSON.parse(raw) as DB;
    if (!db.stock || !db.posted || !db.batch) throw new Error("shape");
    if (typeof db.seq !== "number") db.seq = 414;
    return db;
  } catch {
    const db = seed();
    writeDB(db);
    return db;
  }
}

export function writeDB(db: DB): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), "utf8");
}

export function resetDB(): DB {
  const db = seed();
  writeDB(db);
  return db;
}

export const seenInvoiceNumbers = (db: DB): string[] =>
  db.posted.map((p) => p.invoiceNumber.toUpperCase());
