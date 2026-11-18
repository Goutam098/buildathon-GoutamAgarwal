/**
 * Tally Prime XML import payload.
 *
 * Tally imports an <ENVELOPE> of TALLYMESSAGE blocks. We emit:
 *   1. LEDGER masters for any party the shop approved as new, so the voucher
 *      has something to post against, and
 *   2. one VOUCHER per approved bill — Sales or Purchase — in Invoice Voucher
 *      View, with inventory allocations so stock moves in Tally too.
 *
 * The two directions are mirror images:
 *
 *            party            goods / expense       stock
 *   SALES    debited (Dr)     sales credited        goes out
 *   PURCHASE credited (Cr)    purchase debited      comes in
 *
 * In Tally's XML a debit is ISDEEMEDPOSITIVE Yes with a negative AMOUNT, and a
 * credit is No with a positive AMOUNT. Every sign below follows from that.
 *
 * Honest limit: this is written to Tally's documented import schema. Validate
 * it against the Tally Prime build on the shop's own machine before anyone
 * calls it one-click.
 */
import { SHOP, TAX_LEDGERS } from "./masters";
import { round2, tallyDate } from "./engine";
import type { ReviewInvoice } from "./types";

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const amt = (n: number) => round2(n).toFixed(2);

/** A signed ledger line. `debit` decides both the flag and the sign. */
function entry(name: string, value: number, debit: boolean): string {
  if (!value) return "";
  return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${debit ? "-" : ""}${amt(value)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>\n`;
}

function ledgerMaster(name: string, gstin: string | null, parent: string, state: string): string {
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${esc(name)}" ACTION="Create">
        <NAME>${esc(name)}</NAME>
        <PARENT>${esc(parent)}</PARENT>
        <ISBILLWISEON>Yes</ISBILLWISEON>
        <AFFECTSSTOCK>No</AFFECTSSTOCK>
${gstin ? `        <PARTYGSTIN>${esc(gstin)}</PARTYGSTIN>\n        <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n` : ""}${state ? `        <LEDSTATENAME>${esc(state)}</LEDSTATENAME>\n` : ""}      </LEDGER>
    </TALLYMESSAGE>`;
}

function voucher(inv: ReviewInvoice): string {
  const purchase = inv.direction === "purchase";
  const date = tallyDate(inv.extraction.invoiceDate);
  const party =
    inv.partyLedgerName ??
    (purchase ? inv.extraction.supplierName : inv.extraction.partyName) ??
    "";
  const gstin = purchase ? inv.extraction.supplierGstin : inv.extraction.partyGstin;
  const intra = inv.computed.supply !== "inter";

  const taxable = round2(inv.lines.reduce((s, l) => s + l.amount, 0));
  const cgst = round2(Number(inv.extraction.cgst ?? 0));
  const sgst = round2(Number(inv.extraction.sgst ?? 0));
  const igst = round2(Number(inv.extraction.igst ?? 0));
  const roundOff = round2(Number(inv.extraction.roundOff ?? 0));
  const total = round2(taxable + cgst + sgst + igst + roundOff);

  const goodsLedger = purchase
    ? intra
      ? TAX_LEDGERS.purchaseLocal
      : TAX_LEDGERS.purchaseInterstate
    : intra
      ? TAX_LEDGERS.salesLocal
      : TAX_LEDGERS.salesInterstate;

  // On a purchase the party is credited and everything else is debited.
  const partyIsDebit = !purchase;
  const goodsIsDebit = purchase;

  const inventory = inv.lines
    .map(
      (l) => `        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${esc(l.stockItemName ?? l.description)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>${goodsIsDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <ISLASTDEEMEDPOSITIVE>${goodsIsDebit ? "Yes" : "No"}</ISLASTDEEMEDPOSITIVE>
          <RATE>${amt(l.rate)}/${esc(l.unit ?? "PCS")}</RATE>
          <ACTUALQTY>${l.qty} ${esc(l.unit ?? "PCS")}</ACTUALQTY>
          <BILLEDQTY>${l.qty} ${esc(l.unit ?? "PCS")}</BILLEDQTY>
          <AMOUNT>${goodsIsDebit ? "-" : ""}${amt(l.amount)}</AMOUNT>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>${esc(goodsLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${goodsIsDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
            <AMOUNT>${goodsIsDebit ? "-" : ""}${amt(l.amount)}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>`,
    )
    .join("\n");

  const taxLines = intra
    ? entry(purchase ? TAX_LEDGERS.inputCgst : TAX_LEDGERS.cgst, cgst, goodsIsDebit) +
      entry(purchase ? TAX_LEDGERS.inputSgst : TAX_LEDGERS.sgst, sgst, goodsIsDebit)
    : entry(purchase ? TAX_LEDGERS.inputIgst : TAX_LEDGERS.igst, igst, goodsIsDebit);

  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${purchase ? "Purchase" : "Sales"}" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${date}</DATE>
        <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>${purchase ? "Purchase" : "Sales"}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(inv.extraction.invoiceNumber)}</VOUCHERNUMBER>
        <REFERENCE>${esc(inv.extraction.invoiceNumber)}</REFERENCE>
        <REFERENCEDATE>${date}</REFERENCEDATE>
        <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
        <PARTYNAME>${esc(party)}</PARTYNAME>
${gstin ? `        <PARTYGSTIN>${esc(gstin)}</PARTYGSTIN>\n` : ""}        <PLACEOFSUPPLY>${esc(intra ? SHOP.state : "Interstate")}</PLACEOFSUPPLY>
        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
        <ISINVOICE>Yes</ISINVOICE>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(party)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${partyIsDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${partyIsDebit ? "-" : ""}${amt(total)}</AMOUNT>
          <BILLALLOCATIONS.LIST>
            <NAME>${esc(inv.extraction.invoiceNumber)}</NAME>
            <BILLTYPE>New Ref</BILLTYPE>
            <AMOUNT>${partyIsDebit ? "-" : ""}${amt(total)}</AMOUNT>
          </BILLALLOCATIONS.LIST>
        </ALLLEDGERENTRIES.LIST>
${taxLines}${entry(TAX_LEDGERS.roundOff, roundOff, goodsIsDebit)}${inventory}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

export function buildTallyXml(invoices: ReviewInvoice[], newLedgers: ReviewInvoice[] = []): string {
  const masters = newLedgers.map((inv) => {
    const purchase = inv.direction === "purchase";
    const gstin = (purchase ? inv.extraction.supplierGstin : inv.extraction.partyGstin) ?? null;
    const code = (gstin ?? "").slice(0, 2) || SHOP.stateCode;
    return ledgerMaster(
      inv.partyLedgerName ?? "",
      gstin,
      purchase ? "Sundry Creditors" : "Sundry Debtors",
      code === SHOP.stateCode ? SHOP.state : "",
    );
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(SHOP.tallyCompany)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${[...masters, ...invoices.map(voucher)].join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
