/**
 * Replaying human decisions.
 *
 * A correction never patches the result in place. We re-run the whole
 * resolution from the original extraction and then apply the human's
 * decisions on top, so every other check runs again against the new facts.
 * Fixing a vendor must not be able to hide a broken total.
 */
import { LEDGERS, STOCK_ITEMS } from "./masters";
import { resolveInvoice, round2 } from "./engine";
import type { ExtractedInvoice, Flag, Overrides, ReviewInvoice } from "./types";

export function buildInvoice(
  extraction: ExtractedInvoice,
  opts: {
    id: string;
    fileName: string;
    imageUrl?: string;
    stock: Record<string, number>;
    seenInvoiceNumbers: string[];
    overrides?: Overrides;
    extractionMs?: number;
    source?: "live" | "cached";
  },
): ReviewInvoice {
  const o = opts.overrides ?? {};
  const merged: ExtractedInvoice = { ...extraction, ...(o.edits ?? {}) };

  const inv = resolveInvoice(merged, {
    id: opts.id,
    fileName: opts.fileName,
    imageUrl: opts.imageUrl,
    stock: opts.stock,
    seenInvoiceNumbers: opts.seenInvoiceNumbers,
  });

  let flags: Flag[] = inv.flags;

  /* ---- party decision ----------------------------------------- */
  if (o.partyLedgerId) {
    const led = LEDGERS.find((l) => l.id === o.partyLedgerId);
    if (led) {
      inv.partyLedgerId = led.id;
      inv.partyLedgerName = led.name;
      inv.partyScore = 1;
      inv.isNewLedger = false;
      flags = flags.filter((f) => f.code !== "PARTY_NOT_IN_MASTERS");
    }
  } else if (o.createPartyAsNew) {
    inv.partyLedgerId = null;
    inv.partyLedgerName = merged.partyName;
    inv.partyScore = 1;
    inv.isNewLedger = true;
    flags = flags.filter((f) => f.code !== "PARTY_NOT_IN_MASTERS");
    flags.push({
      code: "LEDGER_WILL_BE_CREATED",
      severity: "info",
      scope: "party",
      message: `"${merged.partyName}" will be created as a new Sundry Debtor in the import file.`,
    });
  }

  /* ---- line decisions ------------------------------------------ */
  for (const [idxStr, stockItemId] of Object.entries(o.lineItems ?? {})) {
    const i = Number(idxStr);
    const line = inv.lines[i];
    const item = STOCK_ITEMS.find((s) => s.id === stockItemId);
    if (!line || !item) continue;

    line.stockItemId = item.id;
    line.stockItemName = item.name;
    line.matchScore = 1;
    line.gstRate = item.gstRate;
    line.availableQty = opts.stock[item.id] ?? 0;

    flags = flags.filter(
      (f) =>
        !(
          f.lineIndex === i &&
          (f.code === "ITEM_LOW_CONFIDENCE" ||
            f.code === "ITEM_NOT_IN_MASTERS" ||
            f.code === "INSUFFICIENT_STOCK")
        ),
    );

    // the stock question has to be asked again against the item just chosen
    if (line.qty > line.availableQty) {
      flags.push({
        code: "INSUFFICIENT_STOCK",
        severity: "warn",
        scope: "line",
        lineIndex: i,
        message: `Selling ${line.qty} ${item.unit} of "${item.name}" but only ${line.availableQty} in stock. Stock would go negative.`,
      });
    }
  }

  inv.flags = flags;
  inv.overrides = o;
  inv.extractionMs = opts.extractionMs;
  inv.source = opts.source;
  inv.status = flags.some((f) => f.severity === "error") ? "review" : "ready";
  return inv;
}

/** Totals used by the UI header and the impact panel. */
export function batchSummary(batch: ReviewInvoice[]) {
  const ready = batch.filter((b) => b.status === "ready").length;
  const review = batch.filter((b) => b.status === "review").length;
  const value = round2(
    batch.reduce((s, b) => s + (b.computed.statedTotal ?? b.computed.expectedTotal), 0),
  );
  const lines = batch.reduce((s, b) => s + b.lines.length, 0);
  const fields = batch.reduce((s, b) => s + 9 + b.lines.length * 6, 0);
  return { total: batch.length, ready, review, value, lines, fields };
}
