# How to explain Overnight Books

## 15 seconds

> Shopkeepers enter every transaction twice — once when it happens, again at night into
> Tally. We built the till, so sales never need re-entering, and we read supplier bills
> with AI so those don't either. Both land in the books as checked entries.

## One minute, for a judge

> A retailer should never have to enter the same transaction twice. But that's exactly
> what happens: a customer buys something, it goes in a bill book, and at 10pm the owner
> retypes it into Tally. A truck arrives with a supplier invoice, and that gets retyped too.
>
> We looked at the two halves separately, because they're not the same problem.
>
> Sales, the shop creates itself. So don't photograph them — own the moment they happen.
> Our counter screen rings up the sale, and the stock movement and the accounting voucher
> happen as the customer pays. There's no transcription step, so there's no transcription
> error. Structurally zero.
>
> Purchase bills you can never own. They arrive on the supplier's paper, in the
> supplier's format. So those we read with AI — but the model's only job is to transcribe.
> It's forbidden from calculating or correcting anything. Everything that decides what
> goes into the books is ordinary code: matching the supplier against this shop's own
> ledgers, matching messy product names against its own catalogue, and re-doing the
> bill's arithmetic.
>
> When something doesn't add up, we flag it instead of guessing. On our sample bill the
> printed total is ₹540 off — a transposed digit — and we caught the model misreading a
> blurred GSTIN by checking its mathematical check digit.
>
> Same catalogue, same engine, opposite sign: sales take stock out, approved purchases
> put it in. One import file for Tally at the end.

## The long version

**The problem.** India has about 1.53 crore active GST registrations. Every one of them
has to turn paper into entries before it can file. Tally is where that happens — the
company says roughly 27 lakh businesses use it, and Mint reports about one MSME in four.
Nobody is switching away from it, because that's where GST filing lives.

So the work is data entry, and it scales linearly with how well the business is doing.
A shop big enough to need two or three people on it spends ₹40,000–75,000 a month on
typing (our arithmetic, from entry-level Tally-operator pay of ₹15,000–25,000 a month).
A shop too small for that spends the owner's evening instead.

**Why it hasn't been solved.** Three reasons, and each kills a different kind of attempt:

1. *Generic OCR doesn't know your shop.* It can read "SS Box 2 Ltr" off the paper. It has
   no idea that's the item you named "Steel Container 2 Litre" in Tally three years ago.
   The reading was never the hard part.
2. *Replacing Tally is a non-starter.* Products that try to be the new accounting system
   ask a business to move its GST filing. It doesn't happen.
3. *Billing apps solve one half and ignore the other.* Plenty of POS tools handle sales.
   None of them help with the supplier invoice that arrived on a truck this morning.

**What we built.** Both halves, on one catalogue and one inventory. The counter so sales
never become paper, and an AI reader for the paper we don't control. The interesting part
is the layer in between — the part that decides what is true.

**Who pays.** The shop owner, because it gives back the evening and removes a recurring
salary line. Secondarily their CA, who stops chasing them for clean data at filing time.

**What's genuinely hard.** Matching messy names onto a specific shop's masters with
calibrated confidence; catching a model's plausible-looking mistakes; and making sure a
human correction re-runs every check rather than papering over the next problem.

---

# Likely judge questions

**"Doesn't Tally already do this? Why doesn't existing accounting software solve it?"**
Tally is an excellent ledger. It is not a data-entry engine — it assumes someone types
the entry in. Tally Prime has import facilities, but they expect data already in Tally's
shape, with vendors and stock items already matched to the masters. Producing that shape
from a photograph of someone else's invoice is the work, and that's the gap we filled.

**"Why do you need AI at all?"**
For sales, we don't — and we say so. Our counter path uses no model whatsoever, because
the shop creates that bill and there's nothing to read. AI is needed only for documents
that arrive from outside in a format nobody controls. Using it anywhere else would add
risk for no benefit.

**"If OCR has existed for twenty years, why isn't this already solved?"**
Because OCR gives you text, and text isn't an accounting entry. "SS Box 2 Ltr, 80, 236,
18880" is a correct read and still useless — it doesn't name a stock item that exists in
this shop's Tally, and nobody has checked that 80 × 236 is actually 18,880. OCR solves
transcription. The problem is reconciliation.

**"How do you stop wrong entries going into the books?"**
Four ways. The model is instructed never to compute, so it can't invent a total. Every
figure is recomputed independently — line arithmetic, taxable value, tax amount, grand
total, and the CGST/SGST-versus-IGST decision from the place of supply. Every match
carries a confidence score, and anything below 88% stops for a human. And a correction
re-runs the entire resolution rather than patching the result, so fixing one thing can't
conceal another. Nothing touches stock until someone presses approve.

**"What happens when the AI gets it wrong?"**
It did, during our build, and that's the best answer we have. On the blurred sample bill
the model returned a GSTIN that was fifteen characters, perfectly formatted, and the
wrong business. A format check passes that. So we implemented the actual GST check digit
— a mod-36 checksum over the first fourteen characters — which fails on any single wrong
character 35 times out of 36. It now blocks the voucher and asks a human to read the
GSTIN off the bill. The general principle: we assume the model will be wrong sometimes
and design the checks so that being wrong is visible rather than silent.

**"Who actually pays for this?"**
The shop owner. For a business already paying one person ₹15,000–25,000 a month largely
to type, the arithmetic is obvious. We'd expect a per-shop subscription well under one
month of that salary. Distributors with many purchase invoices a day feel it hardest.
A CA with fifty clients is a natural channel, since cleaner books reduce their own work.

**"How does this scale across Indian retailers?"**
The catalogue is per-shop by design, which is a feature: the matching improves as it
learns a particular shop's naming habits. Today the aliases are hand-written; they should
be *earned* from the corrections a shopkeeper makes. Every confirmation is a labelled
training example from the only person who knows the right answer. A shop gets better the
more it is used, and the vertical generalises — the logic is identical for pharmacy,
hardware or FMCG, only the catalogue changes.

**"What's between this and a real commercial product?"**
Honestly: (1) verify the XML against live Tally Prime installations across versions —
we generate the file but have not imported it, and we won't claim otherwise; (2) a real
database instead of a JSON file; (3) handwritten and thermal-printed bills, which we
haven't tested; (4) learned aliases rather than hand-written ones; (5) purchase-order
matching, so a bill can be checked against what was actually ordered; and (6) a pilot in
one real shop to measure the time saved, because our time figures are estimates and we
label them as such.

**"What did you actually build today versus simulate?"**
Working: counter billing, stock in both directions, live invoice reading, matching,
validation, human review, reversal, and three download formats. Export-only: the Tally
XML is generated correctly but has not been imported into a live Tally. Simulated: the
shop itself — every business, GSTIN and bill is invented, and payment is a confirmation
step rather than a gateway.
