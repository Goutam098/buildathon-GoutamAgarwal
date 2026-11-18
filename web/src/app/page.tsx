"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Flag, ReviewInvoice } from "@/lib/types";
import type { Ledger, StockItem } from "@/lib/masters";

type Summary = { total: number; ready: number; review: number; value: number; lines: number; fields: number };
type Posted = { id: string; invoiceNumber: string; party: string; total: number; postedAt: string };

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ */

function StatusPill({ status }: { status: "ready" | "review" }) {
  const ready = status === "ready";
  return (
    <span
      className="rule-label rounded-full px-2.5 py-1"
      style={{
        background: ready ? "var(--ready-bg)" : "var(--review-bg)",
        color: ready ? "var(--ready)" : "var(--review)",
      }}
    >
      {ready ? "Ready to post" : "Needs a human"}
    </span>
  );
}

function Score({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.88 ? "var(--ready)" : value >= 0.5 ? "var(--review)" : "var(--error)";
  return (
    <span className="num text-[11px] font-semibold" style={{ color: tone }}>
      {pct}%
    </span>
  );
}

function FlagList({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <ul className="space-y-1.5">
      {flags.map((f, i) => {
        const tone =
          f.severity === "error"
            ? { bg: "var(--error-bg)", fg: "var(--error)" }
            : f.severity === "warn"
              ? { bg: "var(--review-bg)", fg: "var(--review)" }
              : { bg: "var(--ready-bg)", fg: "var(--ready)" };
        return (
          <li
            key={i}
            className="flex gap-2.5 rounded-md px-3 py-2 text-[13px] leading-snug"
            style={{ background: tone.bg, color: tone.fg }}
          >
            <span className="num mt-px text-[10px] font-bold opacity-70">{f.code}</span>
            <span className="flex-1 text-ink/85">{f.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

export default function Page() {
  const [batch, setBatch] = useState<ReviewInvoice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [posted, setPosted] = useState<Posted[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<"counter" | "bills">("counter");
  const [customer, setCustomer] = useState("");
  const [cart, setCart] = useState<{ stockItemId: string; qty: number }[]>([]);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState(1);
  const [lastSale, setLastSale] = useState<ReviewInvoice | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/state");
    const d = await r.json();
    setBatch(d.batch);
    setSummary(d.summary);
    setStock(d.stock);
    setStockItems(d.stockItems);
    setLedgers(d.ledgers);
    setPosted(d.posted);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(form: FormData, label: string) {
    setBusy(label);
    setError(null);
    if (offline) form.set("offline", "1");
    try {
      const r = await fetch("/api/process", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not read the bills.");
      setBatch(d.batch);
      setSummary(d.summary);
      setStock(d.stock);
      if (d.failures?.length) {
        setError(d.failures.map((f: { fileName: string; message: string }) => `${f.fileName}: ${f.message}`).join(" · "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const runSamples = () => {
    const f = new FormData();
    f.set("samples", "1");
    return run(f, "samples");
  };

  const runFiles = (files: FileList) => {
    const f = new FormData();
    for (const file of Array.from(files)) f.append("files", file);
    return run(f, "upload");
  };

  async function override(invoiceId: string, overrides: Record<string, unknown>) {
    const r = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, overrides }),
    });
    const d = await r.json();
    if (!r.ok) return setError(d.error);
    setBatch((b) => b.map((x) => (x.id === invoiceId ? d.invoice : x)));
    setSummary(d.summary);
  }

  async function approve(ids: string[]) {
    setBusy("approve");
    const r = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const d = await r.json();
    setBatch(d.batch);
    setStock(d.stock);
    setPosted(d.posted);
    setSummary(d.summary);
    setBusy(null);
  }

  async function completeSale() {
    setBusy("sale");
    setError(null);
    const r = await fetch("/api/counter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledgerId: customer, lines: cart }),
    });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return setError(d.error);
    setBatch(d.batch);
    setStock(d.stock);
    setPosted(d.posted);
    setSummary(d.summary);
    setLastSale(d.invoice);
    setCart([]);
  }

  async function reset() {
    await fetch("/api/state", { method: "POST" });
    setError(null);
    setCart([]);
    setLastSale(null);
    await load();
  }

  const cartLines = cart
    .map((c) => {
      const s = stockItems.find((x) => x.id === c.stockItemId);
      return s ? { s, qty: c.qty, amount: s.rate * c.qty } : null;
    })
    .filter(Boolean) as { s: StockItem; qty: number; amount: number }[];
  const cartTaxable = cartLines.reduce((a, l) => a + l.amount, 0);
  const cartGstRate = cartLines[0]?.s.gstRate ?? 5;
  const cartTax = Math.round((cartTaxable * cartGstRate) / 100 * 100) / 100;

  const readyUnposted = batch.filter((b) => b.status === "ready" && !b.approved);
  const movedItems = stockItems.filter((s) => (stock[s.id] ?? s.openingQty) !== s.openingQty);

  return (
    <main className="mx-auto max-w-[1280px] px-5 pb-24 sm:px-8">
      {/* ---------------- header ---------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line-strong py-7">
        <div>
          <div className="rule-label">Shree Balaji Steel House · GSTIN 08ABCDE1234F1Z5 · Jaipur</div>
          <h1 className="mt-1.5 text-[30px] leading-none font-semibold tracking-tight">Overnight Books</h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted">
            Photograph the day&apos;s bills. They are read, matched against the shop&apos;s own Tally
            ledgers and stock items, and checked against their own arithmetic. Only what the system
            is unsure about reaches a human.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={offline}
              onChange={(e) => setOffline(e.target.checked)}
              className="accent-ink"
            />
            Offline mode
          </label>
          <button
            onClick={reset}
            className="rounded-md border border-line-strong px-3 py-2 text-[13px] text-muted hover:bg-surface"
          >
            Reset day
          </button>
        </div>
      </header>

      {/* ---------------- tabs ---------------- */}
      <nav className="mt-6 flex gap-1 border-b border-line">
        {(
          [
            ["counter", "At the counter", "the sale is born digital"],
            ["bills", "Bills from suppliers", "paper you did not create"],
          ] as const
        ).map(([key, label, hint]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className="-mb-px border-b-2 px-4 py-3 text-left"
            style={{
              borderColor: view === key ? "var(--ink)" : "transparent",
              color: view === key ? "var(--ink)" : "var(--faint)",
            }}
          >
            <span className="block text-[14px] font-medium">{label}</span>
            <span className="block text-[11.5px]">{hint}</span>
          </button>
        ))}
      </nav>

      {/* ---------------- intake ---------------- */}
      {view === "bills" && (
      <section className="mt-7 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) void runFiles(e.dataTransfer.files);
          }}
          className="flex flex-col items-start justify-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-7"
        >
          <div className="rule-label">Tonight&apos;s folder</div>
          <p className="mt-2 text-[15px] text-muted">
            Drop bill photos here, or run the two sample bills from the counter.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              onClick={runSamples}
              disabled={!!busy}
              className="rounded-md bg-ink px-4 py-2.5 text-[13.5px] font-medium text-paper disabled:opacity-45"
            >
              {busy === "samples" ? "Reading the bills…" : "Run tonight's batch"}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="rounded-md border border-line-strong px-4 py-2.5 text-[13.5px] disabled:opacity-45"
            >
              {busy === "upload" ? "Reading…" : "Upload bills"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => e.target.files?.length && void runFiles(e.target.files)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface px-5 py-4">
          <div className="rule-label">This batch</div>
          {summary && summary.total > 0 ? (
            <dl className="mt-3 space-y-2 text-[13.5px]">
              {[
                ["Bills read", String(summary.total)],
                ["Fields extracted", String(summary.fields)],
                ["Ready to post", String(summary.ready)],
                ["Needs a human", String(summary.review)],
                ["Value", inr(summary.value)],
              ].map(([k, v], i) => (
                <div key={k} className="flex justify-between" style={i === 3 ? { color: "var(--review)" } : {}}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="num font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-[13.5px] text-faint">Nothing read yet.</p>
          )}
        </div>
      </section>
      )}

      {error && (
        <p className="mt-4 rounded-md px-4 py-3 text-[13.5px]" style={{ background: "var(--error-bg)", color: "var(--error)" }}>
          {error}
        </p>
      )}

      {/* ---------------- body ---------------- */}
      <section className="mt-7 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {view === "counter" && (
            <section className="rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <div className="rule-label">Counter sale</div>
                  <p className="mt-1 text-[13px] text-muted">
                    Ring it up here and there is no bill to photograph later. The entry, the stock
                    movement and the Tally voucher all happen as the customer pays.
                  </p>
                </div>
                <select
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  className="rounded border border-line-strong bg-paper px-3 py-2 text-[13px]"
                >
                  <option value="">Choose customer…</option>
                  {ledgers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.stateCode !== "08" ? " (out of state)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
                <select
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  className="min-w-[230px] flex-1 rounded border border-line-strong bg-paper px-3 py-2 text-[13px]"
                >
                  <option value="">Add an item…</option>
                  {stockItems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · ₹{s.rate} · {stock[s.id] ?? s.openingQty} left
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                  className="num w-20 rounded border border-line-strong bg-paper px-3 py-2 text-[13px]"
                />
                <button
                  onClick={() => {
                    if (!pick) return;
                    setCart((c) => [...c, { stockItemId: pick, qty }]);
                    setPick("");
                    setQty(1);
                  }}
                  className="rounded-md border border-ink px-4 py-2 text-[13px] font-medium"
                >
                  Add
                </button>
              </div>

              {cartLines.length > 0 ? (
                <>
                  <table className="ledger w-full text-[13.5px]">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cartLines.map((l, i) => (
                        <tr key={i}>
                          <td>{l.s.name}</td>
                          <td className="num text-right">{l.qty}</td>
                          <td className="num text-right">{l.s.rate.toFixed(2)}</td>
                          <td className="num text-right font-medium">{l.amount.toFixed(2)}</td>
                          <td className="text-right">
                            <button
                              onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                              className="text-[12px] text-faint hover:text-error"
                            >
                              remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line px-5 py-4">
                    <dl className="space-y-1 text-[13px]">
                      <div className="flex gap-6">
                        <dt className="w-28 text-muted">Taxable</dt>
                        <dd className="num">{cartTaxable.toFixed(2)}</dd>
                      </div>
                      <div className="flex gap-6">
                        <dt className="w-28 text-muted">GST @ {cartGstRate}%</dt>
                        <dd className="num">{cartTax.toFixed(2)}</dd>
                      </div>
                      <div className="flex gap-6 border-t border-line pt-1 text-[15px] font-semibold">
                        <dt className="w-28">Total</dt>
                        <dd className="num">{inr(cartTaxable + cartTax)}</dd>
                      </div>
                    </dl>
                    <button
                      onClick={completeSale}
                      disabled={!customer || !!busy}
                      className="rounded-md bg-ink px-5 py-3 text-[14px] font-medium text-paper disabled:opacity-35"
                    >
                      {busy === "sale" ? "Posting…" : "Complete sale"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="px-5 py-6 text-[13.5px] text-faint">
                  Nothing on the counter yet.
                </p>
              )}

              {lastSale && (
                <div
                  className="fade-in flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-5 py-3 text-[13px]"
                  style={{ background: "var(--ready-bg)", color: "var(--ready)", borderColor: "var(--line)" }}
                >
                  <span className="num font-semibold">{lastSale.extraction.invoiceNumber}</span>
                  <span>posted to {lastSale.partyLedgerName}</span>
                  <span>·</span>
                  <span>stock moved</span>
                  <span>·</span>
                  <span>0 fields transcribed, 0 to review</span>
                </div>
              )}
            </section>
          )}

          {batch.map((inv) => (
            <article key={inv.id} className="fade-in overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h2 className="num text-[15px] font-semibold">
                      {inv.extraction.invoiceNumber || "No invoice number"}
                    </h2>
                    <StatusPill status={inv.status} />
                    {inv.approved && (
                      <span className="rule-label" style={{ color: "var(--ready)" }}>
                        ✓ Posted
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12.5px] text-faint">
                    {inv.fileName} · {inv.extraction.invoiceDate} ·{" "}
                    {inv.source === "counter"
                      ? "born digital, nothing transcribed"
                      : inv.source === "cached"
                        ? "from cache"
                        : `read in ${((inv.extractionMs ?? 0) / 1000).toFixed(1)}s`}
                  </p>
                </div>
                {inv.imageUrl && (
                  <a href={inv.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={inv.imageUrl}
                      alt="Bill"
                      className="h-[58px] w-[44px] rounded border border-line object-cover object-top"
                    />
                  </a>
                )}
              </div>

              {/* party */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
                <div className="rule-label w-14">Party</div>
                <div className="text-[14px]">
                  {inv.extraction.partyName}
                  <span className="text-faint"> → </span>
                  <span className={inv.partyLedgerName ? "font-medium" : "text-error"}>
                    {inv.partyLedgerName ?? "no ledger"}
                  </span>{" "}
                  <Score value={inv.partyScore} />
                  {inv.isNewLedger && <span className="rule-label ml-2" style={{ color: "var(--ready)" }}>will be created</span>}
                </div>
                {!inv.approved && inv.flags.some((f) => f.code === "PARTY_NOT_IN_MASTERS") && (
                  <div className="ml-auto flex items-center gap-2">
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && override(inv.id, { partyLedgerId: e.target.value })}
                      className="rounded border border-line-strong bg-paper px-2 py-1.5 text-[12.5px]"
                    >
                      <option value="">Map to existing ledger…</option>
                      {ledgers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => override(inv.id, { createPartyAsNew: true })}
                      className="rounded border border-line-strong px-2.5 py-1.5 text-[12.5px] hover:bg-paper"
                    >
                      Create new
                    </button>
                  </div>
                )}
              </div>

              {/* lines */}
              <table className="ledger w-full text-[13.5px]">
                <thead>
                  <tr>
                    <th>On the bill</th>
                    <th>Tally stock item</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <div>{l.description}</div>
                        <div className="num mt-0.5 text-[11px] text-faint">HSN {l.hsn ?? "—"}</div>
                      </td>
                      <td>
                        {l.stockItemName ? (
                          <span className="inline-flex items-center gap-2">
                            {l.stockItemName} <Score value={l.matchScore} />
                          </span>
                        ) : inv.approved ? (
                          <span className="text-error">unmatched</span>
                        ) : (
                          <select
                            defaultValue=""
                            onChange={(e) =>
                              e.target.value && override(inv.id, { lineItems: { [i]: e.target.value } })
                            }
                            className="w-full max-w-[230px] rounded border px-2 py-1.5 text-[12.5px]"
                            style={{ borderColor: "var(--review)", background: "var(--review-bg)" }}
                          >
                            <option value="">
                              {l.suggestions[0]
                                ? `Confirm: ${l.suggestions[0].name} (${Math.round(l.suggestions[0].score * 100)}%)`
                                : "Pick a stock item…"}
                            </option>
                            {stockItems.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {l.availableQty !== null && (
                          <div className="num mt-0.5 text-[11px] text-faint">{l.availableQty} in stock</div>
                        )}
                      </td>
                      <td className="num text-right">{l.qty}</td>
                      <td className="num text-right">{l.rate.toFixed(2)}</td>
                      <td className="num text-right font-medium">{l.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* totals + flags */}
              <div className="grid gap-4 border-t border-line px-5 py-4 md:grid-cols-[1fr_230px]">
                <div>{inv.flags.length ? <FlagList flags={inv.flags} /> : <p className="text-[13px] text-muted">Every check passed. Arithmetic, tax heads, masters and duplicates.</p>}</div>
                <dl className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-muted">Lines add to</dt>
                    <dd className="num">{inv.computed.lineSum.toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Checked total</dt>
                    <dd className="num">{inv.computed.expectedTotal.toFixed(2)}</dd>
                  </div>
                  <div
                    className="flex justify-between border-t border-line pt-1.5 font-semibold"
                    style={inv.computed.totalDelta && Math.abs(inv.computed.totalDelta) > 1 ? { color: "var(--error)" } : {}}
                  >
                    <dt>Bill says</dt>
                    <dd className="num">{(inv.computed.statedTotal ?? 0).toFixed(2)}</dd>
                  </div>
                  {!inv.approved && (
                    <button
                      onClick={() => approve([inv.id])}
                      disabled={inv.status !== "ready" || !!busy}
                      className="mt-2 w-full rounded-md bg-ink py-2.5 text-[13px] font-medium text-paper disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      Approve &amp; move stock
                    </button>
                  )}
                </dl>
              </div>
            </article>
          ))}

          {batch.length > 1 && readyUnposted.length > 1 && (
            <button
              onClick={() => approve(readyUnposted.map((b) => b.id))}
              disabled={!!busy}
              className="w-full rounded-md border border-ink py-3 text-[13.5px] font-medium"
            >
              Approve all {readyUnposted.length} clean bills
            </button>
          )}
        </div>

        {/* ---------------- right rail ---------------- */}
        <aside className="space-y-4 lg:sticky lg:top-5">
          <div className="rounded-lg border border-line bg-surface px-5 py-4">
            <div className="rule-label">Stock position</div>
            {movedItems.length ? (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {movedItems.map((s) => {
                    const closing = stock[s.id] ?? s.openingQty;
                    return (
                      <tr key={s.id}>
                        <td className="py-1 pr-2">{s.name}</td>
                        <td className="num py-1 text-right text-faint">{s.openingQty}</td>
                        <td className="num py-1 text-right" style={{ color: closing < 0 ? "var(--error)" : "var(--ready)" }}>
                          → {closing}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-[13px] text-faint">Nothing posted yet, so nothing has moved.</p>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface px-5 py-4">
            <div className="rule-label">Posted vouchers</div>
            {posted.length ? (
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {posted.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="num truncate">{p.invoiceNumber}</span>
                    <span className="num shrink-0 text-muted">{inr(p.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-faint">None yet.</p>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface px-5 py-4">
            <div className="rule-label">Take it to Tally</div>
            <div className="mt-2.5 space-y-2">
              <a
                href="/api/export?kind=tally"
                className="block rounded-md bg-ink px-3 py-2.5 text-center text-[13px] font-medium text-paper"
              >
                Tally XML import file
              </a>
              <a
                href="/api/export?kind=excel"
                className="block rounded-md border border-line-strong px-3 py-2.5 text-center text-[13px]"
              >
                Excel review sheet
              </a>
              <a
                href="/api/export?kind=stock"
                className="block rounded-md border border-line-strong px-3 py-2.5 text-center text-[13px]"
              >
                Stock position CSV
              </a>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              The XML is written to Tally&apos;s documented import schema. Validate it against the
              Tally Prime build on the shop&apos;s own machine before anyone calls it one-click.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
