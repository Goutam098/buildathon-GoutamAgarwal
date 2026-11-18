/**
 * Tally Prime XML import payload.
 *
 * Tally imports an <ENVELOPE> of TALLYMESSAGE blocks. We emit:
 *   1. LEDGER masters for any party the shop approved as new, so the voucher
 *      has something to post against, and
 *   2. one Sales VOUCHER per approved bill, in Invoice Voucher View, with
 *      inventory allocations so stock moves in Tally too.
 *
 * Sign convention: a debit carries ISDEEMEDPOSITIVE Yes and a negative
 * AMOUNT; a credit carries No and a positive AMOUNT.
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

function ledgerMaster(name: string, gstin: string | null, stateCode: string): string {
  const state = stateCode === SHOP.stateCode ? SHOP.state : "";
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${esc(name)}" ACTION="Create">
        <NAME>${esc(name)}</NAME>
        <PARENT>Sundry Debtors</PARENT>
        <ISBILLWISEON>Yes</ISBILLWISEON>
        <AFFECTSSTOCK>No</AFFECTSSTOCK>
${gstin ? `        <PARTYGSTIN>${esc(gstin)}</PARTYGSTIN>\n        <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n` : ""}${state ? `        <LEDSTATENAME>${esc(state)}</LEDSTATENAME>\n` : ""}      </LEDGER>
    </TALLYMESSAGE>`;
}

function voucher(inv: ReviewInvoice): string {
  const date = tallyDate(inv.extraction.invoiceDate);
  const party = inv.partyLedgerName ?? inv.extraction.partyName;
  const intra = inv.computed.supply !== "inter";

  const taxable = round2(inv.lines.reduce((s, l) => s + l.amount, 0));
  const cgst = round2(Number(inv.extraction.cgst ?? 0));
  const sgst = round2(Number(inv.extraction.sgst ?? 0));
  const igst = round2(Number(inv.extraction.igst ?? 0));
  const roundOff = round2(Number(inv.extraction.roundOff ?? 0));
  const total = round2(taxable + cgst + sgst + igst + roundOff);
  const salesLedger = intra ? TAX_LEDGERS.salesLocal : TAX_LEDGERS.salesInterstate;

  const inventory = inv.lines
    .map(
      (l) => `        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${esc(l.stockItemName ?? l.description)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
          <RATE>${amt(l.rate)}/${esc(l.unit ?? "PCS")}</RATE>
          <ACTUALQTY>${l.qty} ${esc(l.unit ?? "PCS")}</ACTUALQTY>
          <BILLEDQTY>${l.qty} ${esc(l.unit ?? "PCS")}</BILLEDQTY>
          <AMOUNT>${amt(l.amount)}</AMOUNT>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${amt(l.amount)}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>`,
    )
    .join("\n");

  const taxEntry = (name: string, value: number) =>
    value === 0
      ? ""
      : `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${amt(value)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>\n`;

  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${date}</DATE>
        <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(inv.extraction.invoiceNumber)}</VOUCHERNUMBER>
        <REFERENCE>${esc(inv.extraction.invoiceNumber)}</REFERENCE>
        <REFERENCEDATE>${date}</REFERENCEDATE>
        <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
        <PARTYNAME>${esc(party)}</PARTYNAME>
${inv.extraction.partyGstin ? `        <PARTYGSTIN>${esc(inv.extraction.partyGstin)}</PARTYGSTIN>\n` : ""}        <PLACEOFSUPPLY>${esc(intra ? SHOP.state : "Interstate")}</PLACEOFSUPPLY>
        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
        <ISINVOICE>Yes</ISINVOICE>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(party)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${amt(total)}</AMOUNT>
          <BILLALLOCATIONS.LIST>
            <NAME>${esc(inv.extraction.invoiceNumber)}</NAME>
            <BILLTYPE>New Ref</BILLTYPE>
            <AMOUNT>-${amt(total)}</AMOUNT>
          </BILLALLOCATIONS.LIST>
        </ALLLEDGERENTRIES.LIST>
${intra ? taxEntry(TAX_LEDGERS.cgst, cgst) + taxEntry(TAX_LEDGERS.sgst, sgst) : taxEntry(TAX_LEDGERS.igst, igst)}${taxEntry(TAX_LEDGERS.roundOff, roundOff)}${inventory}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

export function buildTallyXml(invoices: ReviewInvoice[], newLedgers: ReviewInvoice[] = []): string {
  const masters = newLedgers.map((inv) =>
    ledgerMaster(
      inv.partyLedgerName ?? inv.extraction.partyName,
      inv.extraction.partyGstin ?? null,
      (inv.extraction.partyGstin ?? "").slice(0, 2) || SHOP.stateCode,
    ),
  );
  const vouchers = invoices.map(voucher);

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
${[...masters, ...vouchers].join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
