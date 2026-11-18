# Two-minute demo script

## Before you hit record

```bash
cd web && npm run dev
```

1. Open http://localhost:3000 and click **Reset day**. Stock must read 120 thalis.
2. Run the batch once beforehand so every bill is cached, then **Reset day** again. The
   cache survives the reset, so if the wifi dies mid-take the same run still works —
   tick **Offline mode** and it replays from cache instead of calling the API.
3. Browser at ~110% zoom, window wide enough for the right rail to sit beside the cards.
4. Have the Downloads folder visible if you plan to open the XML on camera.

---

## 0:00 — 0:18 · The problem

> Every evening, after the shutter comes down, a shopkeeper sits with a pile of paper and
> types it into Tally. Party name, invoice number, every item, every rate, the GST.
>
> Here is the thing nobody says out loud: **half of that paper, the shop printed itself.**
> A retailer should never have to enter the same transaction twice.

*On screen: the app's home view, counter tab.*

## 0:18 — 0:50 · A sale, born digital

*Choose **Maheshwari Bhandar**. Type "thali" — click the result. Type "kadhai" — click.
Set the thali quantity to 6. Click **Complete sale**.*

> This is the counter. The sale is created here, so there is nothing to photograph later
> and nothing to retype. Watch the right side.

*Point at the stock panel: Steel Thali 11 inch 120 → 114.*

> Stock moved the instant the customer paid. The Tally voucher is already queued.
> Zero fields transcribed, zero to review — because nothing was ever read.

## 0:50 — 1:30 · The paper you don't control

*Switch to **Bills from suppliers**. Click **Run tonight's batch**.*

> Purchase bills are different. They arrive on the supplier's paper, in the supplier's
> format. You can never own the moment they are created — so these we read.

*Both bills appear in about four seconds.*

> The first one is clean and ready to post. The second one is a tilted phone photo, and
> the system refuses to guess on five separate things.

*Scroll the flagged bill. Call out, in this order:*

- **Narayan Steel Agency** has no supplier ledger.
- The **GSTIN came back wrong**. Read out whatever the screen actually shows, then say:
  *"Fifteen characters, perfectly formatted, and not this supplier. A format check passes
  that. So we check the GST check digit — the last character is a checksum over the other
  fourteen, and it breaks on any single misread character. It caught the model's own
  mistake."* **(This is the line judges remember.)**

  The exact wrong string differs run to run — sometimes it breaks the format, sometimes
  only the checksum. Both are caught; don't promise a specific string on camera.
- **"SS Box 2 Ltr"** is probably "Steel Container 2 Litre", 67% confident — confirm it.
- **"Tadka Pan Small"** is probably "Tadka Pan 10 cm", 78% — confirm it.
- The bill says **₹48,609**; the lines plus 5% GST come to **₹48,069**. A transposed
  digit. That is the exact error a tired human copies straight into the books.

*Click **Create new** for the supplier. Pick the two suggested stock items. In the GSTIN
box type `08NARAY7531V1ZN` (what the bill actually prints — click the thumbnail to show
it). Correct the total to `48069`.*

> Twenty seconds of attention on five specific things, instead of re-typing the bill.
> And notice: fixing the supplier didn't release it. Every check re-runs on every
> correction, so repairing one thing can never hide the next.

*Click **Approve & add to stock**.*

*Point at the stock panel again: the thali count jumps up.*

> Sales take stock out. Approved purchases put it back in. Same catalogue, same engine,
> opposite sign.

## 1:30 — 1:50 · Out to Tally

*Click **Tally XML import file**, open it.*

> One import file, both directions: a Sales voucher for the counter sale and Purchase
> vouchers for the supplier bills, with input GST on one side and output GST on the
> other, and the new supplier ledger created ahead of the voucher that needs it.

*Click **Excel review sheet** and **Stock position CSV** if there is time.*

## 1:50 — 2:00 · Close

> A purchase arrives as a supplier's document. A sale starts at the counter. Both should
> become accurate stock and accounting records on their own.
>
> The transcription is real, the matching is real, the stock is real, the export file is
> real. What we have not done is push it into a live Tally install — that is the next
> step, and we are not claiming it.

---

## If something breaks on camera

| Problem | Fix |
|---|---|
| API is slow or down | Tick **Offline mode** before running the batch — both bills replay from cache in about 0.25s |
| Stock looks wrong | **Reset day** |
| Posted something twice | **Reverse this posting** on the card; units go back once |
| Every page 500s | Something ran `npm run build` while `npm run dev` was live and deleted `.next`. Stop the server, `rm -rf web/.next`, `npm run dev` again. **Never run a production build while the dev server is up.** |

## Don't say

- "It imports into Tally in one click." It generates the import file. We have not run it
  into a live Tally.
- "It saves two hours a night." We never measured a real shop. Say the cost is
  ₹15,000–25,000 a month per data-entry person and that the time figure is an estimate.
