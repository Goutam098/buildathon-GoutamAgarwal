import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { extractInvoice } from "@/lib/extract";
import { buildInvoice, batchSummary } from "@/lib/review";
import { readDB, writeDB, seenInvoiceNumbers } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

const SAMPLES = ["sales-invoice-1.png", "sales-invoice-2.png"];

type Incoming = { name: string; buf: Buffer; media: "image/png" | "image/jpeg" | "image/webp"; url?: string };

function mediaOf(name: string, type?: string): Incoming["media"] {
  const t = (type || "").toLowerCase();
  if (t.includes("jpeg") || t.includes("jpg")) return "image/jpeg";
  if (t.includes("webp")) return "image/webp";
  if (t.includes("png")) return "image/png";
  const ext = path.extname(name).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

export async function POST(req: Request) {
  const db = readDB();
  const form = await req.formData();
  const useSamples = form.get("samples") === "1";
  const preferCache = form.get("offline") === "1";

  const incoming: Incoming[] = [];

  if (useSamples) {
    const dir = path.join(process.cwd(), "public", "samples");
    for (const name of SAMPLES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        incoming.push({ name, buf: fs.readFileSync(p), media: "image/png", url: `/samples/${name}` });
      }
    }
  } else {
    for (const value of form.getAll("files")) {
      if (typeof value === "string") continue;
      const file = value as File;
      const buf = Buffer.from(await file.arrayBuffer());
      incoming.push({ name: file.name, buf, media: mediaOf(file.name, file.type) });
    }
  }

  if (!incoming.length) {
    return NextResponse.json({ error: "No bills were uploaded." }, { status: 400 });
  }

  const seen = seenInvoiceNumbers(db);
  const results = await Promise.all(
    incoming.map(async (item, i) => {
      try {
        const { extraction, source, ms } = await extractInvoice(item.buf, item.media, { preferCache });
        return buildInvoice(extraction, {
          id: `inv-${Date.now()}-${i}`,
          fileName: item.name,
          imageUrl: item.url,
          stock: db.stock,
          seenInvoiceNumbers: seen,
          extractionMs: ms,
          source,
        });
      } catch (err) {
        return {
          error: true as const,
          fileName: item.name,
          message: err instanceof Error ? err.message : "Could not read this bill.",
        };
      }
    }),
  );

  const batch = results.filter((r) => !("error" in r)) as ReturnType<typeof buildInvoice>[];
  const failures = results.filter((r) => "error" in r) as { fileName: string; message: string }[];

  // A bill appearing twice inside the same batch is a duplicate too.
  const within = new Map<string, number>();
  for (const inv of batch) {
    const key = (inv.extraction.invoiceNumber || "").toUpperCase();
    if (!key) continue;
    const n = (within.get(key) ?? 0) + 1;
    within.set(key, n);
    if (n > 1) {
      inv.flags.push({
        code: "DUPLICATE_IN_BATCH",
        severity: "error",
        scope: "invoice",
        message: `Invoice ${inv.extraction.invoiceNumber} appears more than once in this batch.`,
      });
      inv.status = "review";
    }
  }

  db.batch = batch;
  writeDB(db);

  return NextResponse.json({
    batch,
    failures,
    summary: batchSummary(batch),
    stock: db.stock,
    posted: db.posted,
  });
}
