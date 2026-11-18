# Overnight Books

**Track 1 — Build for the Physical World** · Buildathon, Masters' Union, 18 Nov 2026

Paper bills arrive with the goods. Every night, after the shutter comes down, somebody
retypes them into Tally. Overnight Books reads the photographs instead, matches every
line against the shop's **own** ledgers and stock items, re-does the bill's arithmetic,
and hands back a Tally import file — flagging anything it is not sure about rather than
guessing at it.

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

A local web application. The shop's API key stays server-side; nothing leaves the
owner's machine except the bill images sent to Claude for transcription.

```
bill photo ──► Claude (transcribe only) ──► match to this shop's masters
                                               │
                                        recompute the arithmetic
                                               │
                        ┌──────────────────────┴───────────────────┐
                   everything agrees                        something is off
                        │                                          │
                 ready to post                          flagged for a human
                        │                                          │
                        └──────────► approve ◄─────────────────────┘
                                        │
                      stock moves · Tally XML · Excel · stock CSV
```

**The model only reads.** It is instructed never to calculate, correct or round, and to
transcribe a wrong figure exactly as printed. Every judgement after that happens in
plain, inspectable TypeScript, because a number a model invented would become a silent
error in somebody's books.

### What it catches

Run the two sample bills and the second one fails five different ways, on purpose:

| Check | What it finds on sample bill 2 |
|---|---|
| Party not in masters | "Shagun Crockery Mart" has no ledger — map it or create it |
| Low-confidence item | "SS Box 2 Ltr" is probably "Steel Container 2 Litre" — confirm |
| Low-confidence item | "Tadka Pan Small" is probably "Tadka Pan 10 cm" — confirm |
| Arithmetic | Bill says ₹51,540; lines + 5% GST come to ₹51,450. Off by ₹90 |
| Stock | Selling 200 thalis against 120 in stock — stock would go negative |

Sample bill 1 is clean and posts straight through. That contrast *is* the demo.

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
cp .env.example .env.local   # then put your Anthropic API key in it
```

```bash
npm run dev
```

Open http://localhost:3000 and press **Run tonight's batch**.

Every successful read is cached by file hash in `web/data/cache/`, so a second run is
instant. **Offline mode** forces the cache, which is also the fallback if the API or the
wifi dies mid-demo.

## Real vs simulated

**Real:** the Claude transcription, the matching engine, every validation rule, the
confidence scoring, the stock deduction, and all three export files. The XML is generated
to Tally's documented import schema and you can open it.

**Simulated:** the shop. The ledgers, stock items, bills, GSTINs and the business itself
are invented sample data — no real client's books appear anywhere in this repo.

**Not done:** we have not pushed the XML into a running Tally Prime instance, so we are
not claiming one-click import. The schema is right; the install needs verifying. Purchase
bills use the same pipeline but we built and tested the sales path. Handwritten bills are
untested.

## Next

Validate the XML against a live Tally Prime, add the purchase path, learn each shop's
naming habits from the corrections it is given (today the aliases are hand-written; they
should be earned), and a read-only Tally connection so the owner can ask the books
questions instead of clicking through reports.

---

Built in a fork of the Buildathon starter during the 3–7 PM window.
Event brief: [AGENTS.md](AGENTS.md) · Rules: [RULES.md](RULES.md)
