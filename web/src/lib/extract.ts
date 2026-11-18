/**
 * Reading the paper.
 *
 * The model's only job is to transcribe what is printed on the bill. It is
 * told not to compute, correct or infer anything, because every number it
 * invents would silently become a wrong entry in someone's books. The
 * arithmetic and the matching happen afterwards, in engine.ts, where they
 * can be inspected.
 *
 * Every successful read is cached by file hash. That makes a re-run instant,
 * and it means the demo still works if the wifi or the API dies.
 */
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedInvoice } from "./types";

// The two sample bills' cached reads ship committed in the repo and are read
// from there on every platform. New cache *writes* on Vercel go to /tmp
// instead, since the project's own folder is read-only at runtime there.
const CACHE_READ_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_WRITE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "overnight-books-cache")
  : CACHE_READ_DIR;
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

const SYSTEM = `You transcribe Indian GST tax invoices for an accounting pipeline.

Transcribe ONLY what is printed. Rules:
- Never calculate, correct, round or infer a value. If the bill's own arithmetic
  is wrong, transcribe the wrong figure exactly as printed. A later step checks it.
- Copy item descriptions verbatim, including abbreviations ("SS Box 2 Ltr").
  Do not expand or tidy them.
- Numbers must be plain numbers: 1,234.00 becomes 1234.00. No currency symbols.
- The "party" is the customer the bill is billed TO, not the shop issuing it.
- If a field is missing or you cannot read it with confidence, use null and add a
  short description of it to unreadableFields. Never guess at a digit.`;

const TOOL = {
  name: "record_invoice",
  description: "Record the fields exactly as printed on the invoice.",
  input_schema: {
    type: "object" as const,
    properties: {
      invoiceNumber: { type: ["string", "null"], description: "Invoice number as printed" },
      invoiceDate: { type: ["string", "null"], description: "Invoice date as printed, e.g. 18-11-2026" },
      partyName: { type: ["string", "null"], description: "Name of the customer billed to" },
      partyGstin: { type: ["string", "null"] },
      partyAddress: { type: ["string", "null"] },
      supplierName: { type: ["string", "null"], description: "Shop issuing the bill" },
      supplierGstin: { type: ["string", "null"] },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            hsn: { type: ["string", "null"] },
            qty: { type: "number" },
            unit: { type: ["string", "null"] },
            rate: { type: "number" },
            amount: { type: "number", description: "Line amount exactly as printed" },
          },
          required: ["description", "qty", "rate", "amount"],
        },
      },
      taxableValue: { type: ["number", "null"] },
      cgst: { type: ["number", "null"] },
      sgst: { type: ["number", "null"] },
      igst: { type: ["number", "null"] },
      roundOff: { type: ["number", "null"] },
      grandTotal: { type: ["number", "null"], description: "Grand total exactly as printed" },
      unreadableFields: { type: "array", items: { type: "string" } },
    },
    required: ["lines"],
  },
};

export function hashBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export function readCache(hash: string): ExtractedInvoice | null {
  for (const dir of [CACHE_WRITE_DIR, CACHE_READ_DIR]) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${hash}.json`), "utf8")) as ExtractedInvoice;
    } catch {
      /* try the next place */
    }
  }
  return null;
}

function writeCache(hash: string, data: ExtractedInvoice) {
  try {
    fs.mkdirSync(CACHE_WRITE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_WRITE_DIR, `${hash}.json`), JSON.stringify(data, null, 2), "utf8");
  } catch {
    /* cache is a convenience, never fatal */
  }
}

export type ExtractOutcome = {
  extraction: ExtractedInvoice;
  source: "live" | "cached";
  ms: number;
};

export async function extractInvoice(
  buf: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
  opts: { preferCache?: boolean } = {},
): Promise<ExtractOutcome> {
  const hash = hashBuffer(buf);
  const started = Date.now();

  if (opts.preferCache) {
    const hit = readCache(hash);
    if (hit) return { extraction: hit, source: "cached", ms: Date.now() - started };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!key && openaiKey) {
    try {
      const extraction = await viaOpenAI(buf, mediaType, openaiKey);
      writeCache(hash, extraction);
      return { extraction, source: "live", ms: Date.now() - started };
    } catch (err) {
      const hit = readCache(hash);
      if (hit) return { extraction: hit, source: "cached", ms: Date.now() - started };
      throw err;
    }
  }

  if (!key) {
    const hit = readCache(hash);
    if (hit) return { extraction: hit, source: "cached", ms: Date.now() - started };
    throw new Error(
      "No ANTHROPIC_API_KEY or OPENAI_API_KEY set, and this bill has no cached read. Put a key in web/.env.local.",
    );
  }

  const client = new Anthropic({ apiKey: key });

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_invoice" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
            },
            { type: "text", text: "Transcribe this invoice exactly as printed." },
          ],
        },
      ],
    });

    const block = res.content.find((c) => c.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model returned no structured output.");

    const raw = block.input as Partial<ExtractedInvoice>;
    const extraction: ExtractedInvoice = {
      invoiceNumber: raw.invoiceNumber ?? "",
      invoiceDate: raw.invoiceDate ?? "",
      partyName: raw.partyName ?? "",
      partyGstin: raw.partyGstin ?? null,
      partyAddress: raw.partyAddress ?? null,
      supplierName: raw.supplierName ?? null,
      supplierGstin: raw.supplierGstin ?? null,
      lines: raw.lines ?? [],
      taxableValue: raw.taxableValue ?? null,
      cgst: raw.cgst ?? null,
      sgst: raw.sgst ?? null,
      igst: raw.igst ?? null,
      roundOff: raw.roundOff ?? null,
      grandTotal: raw.grandTotal ?? null,
      unreadableFields: raw.unreadableFields ?? [],
    };

    writeCache(hash, extraction);
    return { extraction, source: "live", ms: Date.now() - started };
  } catch (err) {
    const hit = readCache(hash);
    if (hit) return { extraction: hit, source: "cached", ms: Date.now() - started };
    throw err;
  }
}

/** Shape whatever the model returned into the type the engine expects. */
function coerce(raw: Partial<ExtractedInvoice>): ExtractedInvoice {
  return {
    invoiceNumber: raw.invoiceNumber ?? "",
    invoiceDate: raw.invoiceDate ?? "",
    partyName: raw.partyName ?? "",
    partyGstin: raw.partyGstin ?? null,
    partyAddress: raw.partyAddress ?? null,
    supplierName: raw.supplierName ?? null,
    supplierGstin: raw.supplierGstin ?? null,
    lines: raw.lines ?? [],
    taxableValue: raw.taxableValue ?? null,
    cgst: raw.cgst ?? null,
    sgst: raw.sgst ?? null,
    igst: raw.igst ?? null,
    roundOff: raw.roundOff ?? null,
    grandTotal: raw.grandTotal ?? null,
    unreadableFields: raw.unreadableFields ?? [],
  };
}

/**
 * Same prompt, same schema, different vendor. The reading step is deliberately
 * the only replaceable part of the system — everything that decides what goes
 * into the books is ours.
 */
async function viaOpenAI(
  buf: Buffer,
  mediaType: string,
  apiKey: string,
): Promise<ExtractedInvoice> {
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this invoice exactly as printed." },
            {
              type: "image_url",
              image_url: { url: `data:${mediaType};base64,${buf.toString("base64")}` },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "record_invoice", strict: false, schema: TOOL.input_schema },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no content.");
  return coerce(JSON.parse(text) as Partial<ExtractedInvoice>);
}
