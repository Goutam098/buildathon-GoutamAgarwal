/**
 * Tiny file-backed store. Stock levels and posted invoices have to survive a
 * dev-server reload, otherwise a demo that deducts stock proves nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { STOCK_ITEMS } from "./masters";
import type { ReviewInvoice } from "./types";

export type PostedLine = { stockItemId: string; name: string; qty: number; amount: number };
export type PostedInvoice = {
  id: string;
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

const DIR = path.join(process.cwd(), "data", "runtime");
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
