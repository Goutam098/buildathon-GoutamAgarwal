# How Overnight Books is built

Written for someone who is not a professional developer. No prior knowledge assumed.

---

## 1. The technologies, and why each one is here

| Thing | What it is | Why we used it |
|---|---|---|
| **TypeScript** | JavaScript with type checking. The computer catches mistakes before you run the program. | In an accounting tool, "this number might be text" is the kind of bug that corrupts books. |
| **Next.js 15** | A framework that runs the web page *and* the server behind it in one project. | One codebase, one command to start. The API key can sit safely on the server side. |
| **React** | The library that draws the interface and re-draws it when data changes. | Stock counts update on screen the moment they change. |
| **Tailwind CSS v4** | Styling written as short class names. | Fast to build a consistent look without a separate design system. |
| **OpenAI API** (`gpt-4o`) | The model that reads a photographed invoice. | It is the only part that can look at a photo and return text. |
| **ExcelJS** | A library that writes real `.xlsx` files. | The review sheet has to open in Excel, not be a CSV pretending. |
| **A JSON file** | Our "database" — a plain text file on disk. | For a four-hour build, a real database would be setup cost with no demo benefit. |

---

## 2. Folder by folder

```
buildathon-GoutamAgarwal/
├── README.md            the judge-facing explanation
├── ARCHITECTURE.md      this file
├── DEMO.md              the two-minute recording script
├── PITCH.md             how to explain it out loud, and judge Q&A
├── team.json            buildathon registration
├── tools/bills/         the two fake supplier invoices, as HTML
└── web/                 the actual application
    ├── .env.example     template for the API key (the real key is never committed)
    ├── data/cache/      saved reads of each bill, so a demo works offline
    ├── data/runtime/    the live database (ignored by git — it changes as you use it)
    ├── public/samples/  the two bills rendered as PNG images
    ├── scripts/         the test file
    └── src/
        ├── app/         the web page and the server endpoints
        └── lib/         all the thinking
```

### `tools/bills/` — where the sample bills come from

Two HTML files that look like Indian GST tax invoices. We rendered them to images with
headless Chrome. The second one is deliberately tilted, slightly blurred and lit
unevenly, like a photo taken over a shop counter. Both are invented — invented firms,
invented GSTINs, invented invoice numbers.

### `web/src/lib/` — the brain (read these first)

This folder contains no web code at all. It is pure logic, which is why it can be tested
without a browser.

| File | Lines | What it does, in plain language |
|---|---|---|
| **`masters.ts`** | 86 | The shop's own lists: 12 products, 6 customers, 3 suppliers, and the accounting ledgers. This is the "memory" every bill is matched against. Also holds the two confidence thresholds. |
| **`engine.ts`** | 492 | **The most important file.** Cleans up messy product names, scores how well they match the shop's catalogue, re-does the bill's arithmetic, validates the GST, and decides what a human must look at. |
| **`extract.ts`** | 262 | Talks to the AI. Sends the photo, gets back structured fields. Saves every successful read to disk so the same photo is never paid for twice. |
| **`review.ts`** | 121 | When a human corrects something, this re-runs the whole check from scratch with their correction applied. |
| **`tally.ts`** | 171 | Writes the XML file that Tally imports. Handles the fact that a sale and a purchase are accounting mirror images. |
| **`store.ts`** | 65 | Reads and writes the JSON database. |
| **`types.ts`** | 86 | The shapes of our data, so the computer can check we are consistent. |

### `web/src/app/api/` — the server endpoints

Each file is one thing the browser can ask the server to do.

| Endpoint | What happens when it is called |
|---|---|
| `process` | "Here are some bill photos." → reads them, matches, validates, puts them in today's batch. |
| `counter` | "A customer just bought these things." → builds the bill itself, posts it, moves stock. |
| `review` | "I corrected this." → re-runs every check with the correction applied. |
| `approve` | "Post it." → **the only place stock ever changes** for an uploaded bill. |
| `cancel` | "Undo that." → puts the units back exactly once; the voucher stays in history as void. |
| `export` | "Give me the file." → builds the Tally XML, the Excel workbook or the stock CSV. |
| `state` | "What's the situation?" → current stock, batch, postings. Also resets the day. |

### `web/src/app/page.tsx` — the interface

One file, 868 lines, containing both tabs. The left side shows either the counter or the
uploaded bills; the right rail always shows live stock, posted vouchers and the download
buttons. It holds no business logic — every decision comes from the server.

---

## 3. Where the database lives

In **`web/data/runtime/db.json`**, a plain text file on your own machine. It holds four
things: current stock per product, the list of postings, today's batch of documents, and
the next voucher number.

It is deliberately *not* committed to git, because it changes every time you use the app.
**Reset day** rewrites it from the opening quantities in `masters.ts`.

A real deployment would swap this one file for Postgres. Nothing else would change,
because only `store.ts` touches it.

---

## 4. How the AI fits in — and how little it is trusted

This is the most important idea in the project.

The model is given **one job: transcribe**. Its instructions say, in effect: copy what is
printed, never calculate, never correct, never round, and if a bill's own arithmetic is
wrong, write down the wrong number exactly as printed. If you cannot read something, say
so rather than guessing.

Everything after that — what the item is, who the supplier is, whether the totals add up,
whether the tax is right, whether this is a duplicate — happens in ordinary code you can
read line by line in `engine.ts`.

**Why we built it this way:** a number a model invents does not look wrong. It looks like
a number. It would land in the books and be discovered months later during a GST
mismatch. So the model reads the paper, and plain arithmetic decides what is true.

---

## 5. The journey of an uploaded supplier invoice

1. You drop a photo on the page. The browser sends it to **`/api/process`**.
2. `extract.ts` hashes the image. If this exact image was read before, it uses the saved
   answer and costs nothing. Otherwise it sends the image to OpenAI with a strict schema
   describing every field we want.
3. The reply comes back as structured data — invoice number, supplier, line items,
   quantities, rates, tax, total — and is saved to `data/cache/`.
4. `engine.ts` takes over:
   - **Who is this?** For a purchase, the counterparty is whoever *issued* the bill, not
     who it is billed to. The name is matched against suppliers only. A GSTIN, being a
     government-issued key, overrides name matching — but only after it passes its own
     check digit.
   - **What are these items?** Each description is normalised ("2 Ltr" and "2 Litre"
     become the same thing) and scored against the catalogue.
   - **Do the numbers work?** Quantity × rate against each line. Lines against the stated
     taxable value. Tax against the rate. Total against everything.
   - **Is the tax right?** Both parties in Rajasthan means CGST + SGST. Different states
     means IGST. Getting this backwards is a real filing error.
   - **Have we seen this before?** Duplicate invoice numbers, across the day and within
     the same upload.
5. Anything uncertain becomes a **flag**. Any flag marked *error* blocks posting.
6. The page shows the bill, its matches with confidence percentages, and the flags.
7. You correct what needs correcting. Each correction calls **`/api/review`**, which
   throws away the previous result and re-runs step 4 from the original extraction with
   your decision applied — so fixing the supplier cannot accidentally hide a wrong total.
8. You press approve. **`/api/approve`** adds the quantities to stock and records the
   posting. This is the first moment anything changed.

## 6. The journey of a counter sale

Much shorter, and that is the point.

1. You search the catalogue, tap items into a cart, adjust quantity or price, pick the
   customer and confirm.
2. **`/api/counter`** builds the invoice itself from the catalogue. The product IDs are
   already correct because you picked them from a list — there is no transcription step,
   so there is nothing to get wrong.
3. It runs through **the same engine** as a photographed bill. Every check still runs.
   They all pass instantly.
4. Because it is clean, it posts itself: stock goes down, the voucher is recorded.

## 7. How accounting vouchers are generated

`tally.ts` writes an XML file in the format Tally imports. The two directions are mirror
images:

| | Who is debited | Who is credited | Stock |
|---|---|---|---|
| **Sale** | the customer | sales + output GST | goes out |
| **Purchase** | purchases + input GST | the supplier | comes in |

In Tally's XML a debit is written as `ISDEEMEDPOSITIVE = Yes` with a *negative* amount,
which is counter-intuitive but is how the format works. One function handles both
directions by flipping a single flag.

If you approved a supplier that did not exist, the file also contains an instruction to
*create that ledger*, placed before the voucher that needs it — otherwise Tally would
reject the voucher for referring to something that is not there.

## 8. How the download files are made

- **Tally XML** — assembled as text by `tally.ts`, streamed straight to the browser.
- **Excel review sheet** — ExcelJS builds three sheets in memory (one row per bill, one
  row per line item, and the stock position) and sends the file.
- **Stock CSV** — opening quantity, sold, closing, per product.

Nothing is written to disk; the file is generated when you click and handed to the browser.

---

## 9. The three hardest parts

**1. Size is meaning, and string matching does not know that.**
"Steel Thali 11 inch" and "Steel Thali 13 inch" are 94% identical as text and are
different products at different prices. Any ordinary fuzzy match confuses them happily.
`similarity()` pulls the numbers out of both names and, if both have numbers and none
agree, multiplies the score by 0.4 — so a near-identical name with the wrong size is
rejected instead of quietly posted. This is domain knowledge expressed as code.

**2. A misread GSTIN looks exactly like a GSTIN.**
We found this during the audit, not by guessing: the blurred bill prints
`08NARAY7531V1ZN`, and a real run returned `08ANARJ7531V1Z5`. Fifteen characters, correct
shape, completely different business. A format check waves it through. So we implemented
the actual GST check digit — the 15th character is a mod-36 checksum over the first 14 —
which breaks on any single wrong character 35 times out of 36. It is the only way to tell
from the bill alone that a well-formed GSTIN was misread.

**3. A correction must not be able to hide a problem.**
The naive approach is to patch the result when a human fixes something. We deliberately
do not. `review.ts` throws the result away and re-derives everything from the original
extraction with the human's decisions replayed on top. Choosing a different product
re-asks the stock question for that product. Fixing the supplier leaves the wrong total
still blocking. There is a test for exactly this.

---

## 10. Testing

```bash
cd web && npx tsx scripts/check-engine.ts
```

56 checks covering matching, size conflicts, arithmetic, tax heads, GSTIN check digits,
correction replay, both posting directions and the generated XML. They run without a
browser, a server or an API key, because all the logic lives in `lib/`.

The fixtures are hand-written transcriptions of the two sample bills — they test the
engine, not the model. The model's own accuracy is exercised by actually running the app.
