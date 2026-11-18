# Overnight Books

**Track 1 — Build for the Physical World** · Buildathon, Masters' Union, 18 Nov 2026

> **A retailer should never have to enter the same transaction twice.**
> A purchase arrives as a supplier's document. A sale originates at the counter. Both
> should become accurate stock and accounting records on their own.

Every night, after the shutter comes down, somebody retypes the day's bills into Tally.

**Half of that paper should never have existed.** If the shop rings up its own sales on a
screen, the sale is born digital — there is nothing to transcribe and nothing to get
wrong. **The other half arrives from outside**, on the supplier's paper, in the supplier's
format, and no amount of owning your own billing will ever fix it. That half gets
photographed, read, matched against the shop's **own** ledgers and stock items, and
checked against its own arithmetic, with anything uncertain flagged rather than guessed
at.

Overnight Books does both, and posts the same Tally voucher either way.

---

## The problem, as it actually happens

A utensils wholesaler in Jaipur sells all day. Thalis, bottles, kadhais, tiffins. Each
sale leaves a paper bill; each delivery arrives with a purchase bill. None of it is in
the books yet.

At closing time the owner, or a staff member paid to do exactly this, opens Tally and
types: party name, invoice number, date, each item, quantity, rate, HSN, GST, total.
Then they do the part that is not typing at all — deciding that **"SS Box 2 Ltr"** on
the bill is the item they called **"Steel Container 2 Litre"** when they set Tally up
three years ago.

That second part is why generic OCR has never solved this. Reading the paper is easy.
Knowing which of *this shop's* 400 stock items a smudged line refers to is the job.

**Why it persists**

- Tally is where GST filing happens. Nobody is switching away from it.
- Every bill is different: printed, handwritten, thermal, a WhatsApp forward.
- Staff who type fast are cheap, so owners absorb the cost rather than fix it.
- A wrong entry is worse than no entry — so people do it carefully, which means slowly.

### Two kinds of paper

It is tempting to treat this as one OCR problem. It is not, and the split is the whole
design:

| | Sales bills | Purchase bills |
|---|---|---|
| Who creates them | The shop | The supplier |
| Can you own the moment of creation? | **Yes** | **Never** |
| Right answer | Rng it up digitally. No transcription step exists. | Read the paper, match it, check it, flag what is doubtful. |
| Error rate | Zero, structurally | Whatever your matching is worth |

So we do not photograph our own sales. We stop producing the paper. We only point a
camera at the paper we did not get a vote on.

## How big this is

| | |
|---|---|
| Active GST registrations in India (30 Jun 2025) | **1.53 crore** ([GSTN, *GST @ 8 Years*](https://www.jurishour.in/gst/8-years-gst-india-annual-collections-taxpayers/)) |
| Businesses on Tally (company's own figure) | **~27 lakh** ([Tejas Goenka, MD, Tally Solutions](https://www.outlookbusiness.com/news/tally-solutions-expects-to-cross-1000-cr-revenue-in-fy27-with-25-30-pc-growth)) |
| MSMEs using Tally | **about 1 in 4** ([Mint](https://www.magzter.com/stories/newspaper/Mint-Mumbai/MEET-THE-BOOKKEEPER-TO-INDIAS-MSMES)) |
| Tally operator / junior accountant pay | **₹15,000–25,000 a month** entry level ([AmbitionBox](https://ambitionbox.com/profile/tally-operator-salary), [Physics Wallah](https://www.pw.live/finance-courses/exams/tally-accountant-job-description)) |

Every one of those 1.53 crore registrations has to turn paper into entries before it can
file. A shop large enough to need two or three people on data entry is spending
**₹40,000–75,000 a month** on typing. A shop too small for that spends the owner's
evening instead — the uncle at the packaging counter who stays back two hours after
dinner, every night, for the rest of his working life.

> **Honesty note.** The salary figures come from aggregators with small samples and the
> headcount is our own arithmetic, not a measured market study. The *number of
> businesses* is a hard figure; the *cost per business* is an estimate and we present it
> as one. We have not measured a real shop's typing time with a stopwatch.

## What we built

A local web application with two ways in and one way out. The API key stays server-side;
nothing leaves the owner's machine except the supplier bill images sent for transcription.

```
  A. COUNTER SALE                        B. SUPPLIER BILL
  search catalogue                       photo or PDF dropped in
  cart, qty, price                              │
  confirm payment                        model transcribes it
        │                                       │
   nothing to read                       match to this shop's masters
        │                                       │
        └───────────────┬───────────────────────┘
                        │
            recompute the arithmetic, check the tax heads,
            check for duplicates, score every match
                        │
         ┌──────────────┴──────────────┐
    everything agrees            something is off
         │                             │
    posts itself              flagged for a human
         │                             │
         └────────► approve ◄──────────┘
                        │
        stock OUT (sale) / stock IN (purchase)
        Tally XML · Excel review sheet · stock CSV
```

**Where the model is used, it only reads.** It is instructed never to calculate, correct
or round, and to transcribe a wrong figure exactly as printed. Every judgement after that
happens in plain, inspectable TypeScript, because a number a model invented would become
a silent error in somebody's books. On the sales side the model is not used at all.

### What it catches

Sample bill 1 (Jindal Steel Udyog) is clean and posts straight through. Sample bill 2 —
a tilted, slightly blurred phone photo — is held back, and this is a real run, not a
scripted one:

| Check | What it found |
|---|---|
| Supplier not in masters | "Narayan Steel Agency" has no creditor ledger — map it or create it |
| GSTIN | The blurred GSTIN comes back **wrong, but plausible**. One real run returned `08ANARJ7531V1Z5` against `08NARAY7531V1ZN` printed — fifteen characters, correct shape, different business. A format check passes that, so we validate the **GST check digit** (a mod-36 checksum over the first 14 characters), which breaks on any single wrong character 35 times out of 36. **This catches the model's own mistake**, and it is the whole argument for not letting it decide anything |
| Low-confidence item | "SS Box 2 Ltr" is probably "Steel Container 2 Litre" (67%) — confirm |
| Low-confidence item | "Tadka Pan Small" is probably "Tadka Pan 10 cm" (78%) — confirm |
| Arithmetic | Bill says ₹48,609; lines + 5% GST come to ₹48,069. Off by ₹540 — a transposed digit, exactly the error a tired human makes and then copies into Tally |

That contrast *is* the demo. One bill needed nobody. The other needed about twenty
seconds of a human's attention, on four specific things, instead of a full re-typing.

Other checks in the engine: duplicate invoice numbers (across the day and within one
batch), CGST/SGST vs IGST against the place of supply, CGST ≠ SGST on an intra-state
bill, GSTIN format, line-level qty × rate ≠ amount, and unreadable fields the model
refused to guess at.

## The hardest part

Not the OCR. It is the layer between the model's output and the shop's books:

1. **Size is meaning.** "Steel Thali 11 inch" and "Steel Thali 13 inch" are 94% identical
   as strings and are different products at different prices. Plain string similarity
   confuses them happily. `similarity()` extracts numeric tokens from both names and
   collapses the score to 40% when they disagree, so a near-identical name with the wrong
   size is rejected rather than quietly posted.
2. **Nothing is trusted twice.** When a human fixes a vendor, we do not patch the result.
   We re-run the entire resolution from the original extraction and replay their decision
   on top, so fixing one thing can never hide another. Choosing a different stock item
   re-asks the stock question against the item just chosen.
3. **Confidence has to be calibrated, not decorative.** Above 88% we post it. Between 50%
   and 88% a human confirms, with the top three candidates ranked. Below 50% we refuse to
   suggest. GSTIN, being a government-issued key, overrides name matching entirely.
4. **Tally XML is fussy.** Sales vouchers in Invoice Voucher View, inventory allocations
   nested inside accounting allocations, debits as negative amounts under
   `ISDEEMEDPOSITIVE`, and `LEDGER` masters emitted ahead of the vouchers for parties the
   owner approved as new.

## Running it

```bash
cd web && npm install
```

```bash
cp .env.example .env.local
```

Put **one** key in `.env.local` — either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The
reading step is the only vendor-specific part of the system; everything that decides what
goes into the books is ours. This build was demonstrated on OpenAI (`gpt-4o`).

```bash
npm run dev
```

Open http://localhost:3000 and press **Run tonight's batch**.

Every successful read is cached by file hash in `web/data/cache/`, so a second run is
instant. **Offline mode** forces the cache, which is also the fallback if the API or the
wifi dies mid-demo.

## Real vs simulated — precisely

**Actually working, end to end, in the app:**

- Counter billing: catalogue search, cart, editable quantity and price, GST, confirm.
- Stock **decreasing** on a confirmed sale, in the same database the purchases use.
- Supplier bill upload → real API call → structured transcription (~4s a bill).
- Matching of suppliers, customers and stock items with calibrated confidence scores.
- Validation: line arithmetic, taxable total, GST amount, CGST/SGST vs IGST against place
  of supply, GSTIN format, duplicate invoice numbers across the day and within a batch.
- Human review: map to an existing ledger, create a new one, confirm a suggested stock
  item, correct a figure. Every fix re-runs the whole resolution.
- Stock **increasing** when a purchase is approved.
- Reversal: cancel a posting, units go back exactly once, voucher stays in history as void.
- Downloads that open: Tally XML, a three-sheet Excel review workbook, a stock CSV.
- 56 engine checks: `cd web && npx tsx scripts/check-engine.ts` (the script prints its
  own count, so this number cannot drift out of date).

**Export-only — generated correctly, not pushed into live software:**

- The Tally XML is written to Tally's documented import schema and you can read every
  voucher in it. We have **not** imported it into a running Tally Prime instance, so we do
  not claim one-click import. That is the next thing to verify, not something we are
  asserting.

**Simulated:**

- The shop itself. Ledgers, stock items, suppliers, customers, GSTINs and both sample
  bills are invented. No real business or client data appears anywhere in this repo.
- Payment is a confirmation step, not a real payment gateway.

**Not built:** customer accounts, a payment gateway, a second inventory product's import
format, purchase order matching, handwritten bills (untested), and the read-only Tally
query connection.

## Next

Validate the XML against a live Tally Prime, add the purchase path, learn each shop's
naming habits from the corrections it is given (today the aliases are hand-written; they
should be earned), and a read-only Tally connection so the owner can ask the books
questions instead of clicking through reports.

## Testing both workflows yourself

```bash
cd web && npx tsx scripts/check-engine.ts
```

56 checks, no browser, server or API key needed — all the logic lives in `src/lib/`.
They cover matching, size conflicts, arithmetic, tax heads, GSTIN check digits,
correction replay, both posting directions and the generated XML.

To exercise the app by hand, with the dev server running:

1. **Reset day** (top right). Steel Thali 11 inch should read 120.
2. **A sale:** pick a customer, search `thali`, click the result, **Complete sale**.
   Watch the stock panel drop to 119 and a voucher appear.
3. **A purchase:** switch to *Bills from suppliers* → **Run tonight's batch**. One bill
   posts clean; the other is held with four or five flags.
4. **Correct it:** create the supplier, confirm the two suggested stock items, fix the
   GSTIN if flagged, correct the total to `48069`. Then **Approve & add to stock** and
   watch the thali count jump.
5. **Duplicates:** press **Run tonight's batch** again. The same invoice numbers are
   refused rather than posted twice.
6. **Reversal:** press **Reverse this posting** on any posted card. The units go back
   exactly once and the voucher stays in history as void.
7. **Downloads:** all three buttons in the right rail produce real files.

No API key? Tick **Offline mode** before step 3 — the two sample bills have committed
cached reads in `web/data/cache/`, so the whole flow works without a network.

## Reading the code

| Document | For |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How it is built, folder by folder, written for a non-developer |
| [PITCH.md](PITCH.md) | How to explain it in 15 seconds, in a minute, and in depth — plus judge Q&A |
| [DEMO.md](DEMO.md) | The two-minute recording script |

Start with `web/src/lib/engine.ts`. It is the file that decides what is true, and it has
no web code in it at all.

---

Built in a fork of the Buildathon starter during the 3–7 PM window.
Event brief: [AGENTS.md](AGENTS.md) · Rules: [RULES.md](RULES.md)
