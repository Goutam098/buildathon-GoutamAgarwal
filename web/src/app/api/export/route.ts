import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { buildTallyXml } from "@/lib/tally";
import { readDB } from "@/lib/store";
import { STOCK_ITEMS } from "@/lib/masters";

export const runtime = "nodejs";

const stamp = () => new Date().toISOString().slice(0, 10);

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") ?? "tally";
  const db = readDB();

  /* ---- Tally import file ---------------------------------------- */
  if (kind === "tally") {
    const postedIds = new Set(db.posted.map((p) => p.id));
    const approved = db.batch.filter((b) => postedIds.has(b.id));
    if (!approved.length) {
      return NextResponse.json({ error: "Nothing approved yet." }, { status: 400 });
    }
    const newLedgers = approved.filter((b) => b.isNewLedger);
    const xml = buildTallyXml(approved, newLedgers);
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stamp()}-sales-tally-import.xml"`,
      },
    });
  }

  /* ---- Stock CSV ------------------------------------------------- */
  if (kind === "stock") {
    const rows = [
      ["Item Code", "Item Name", "HSN", "Unit", "Godown", "Opening Qty", "Sold Today", "Closing Qty"],
      ...STOCK_ITEMS.map((s) => {
        const closing = db.stock[s.id] ?? s.openingQty;
        return [
          s.id,
          s.name,
          s.hsn,
          s.unit,
          s.godown,
          String(s.openingQty),
          String(Math.round((s.openingQty - closing) * 100) / 100),
          String(closing),
        ];
      }),
    ];
    const csv = rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stamp()}-stock-position.csv"`,
      },
    });
  }

  /* ---- Excel review sheet ---------------------------------------- */
  if (kind === "excel") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Overnight Books";
    const head = { bold: true, color: { argb: "FFFFFFFF" } } as const;
    const fill = (argb: string) =>
      ({ type: "pattern", pattern: "solid", fgColor: { argb } }) as ExcelJS.Fill;

    const ws = wb.addWorksheet("Bills");
    ws.columns = [
      { header: "Status", key: "status", width: 10 },
      { header: "File", key: "file", width: 24 },
      { header: "Invoice No", key: "no", width: 18 },
      { header: "Date", key: "date", width: 12 },
      { header: "Party (on bill)", key: "party", width: 24 },
      { header: "Tally Ledger", key: "ledger", width: 24 },
      { header: "Match %", key: "pscore", width: 9 },
      { header: "Taxable", key: "taxable", width: 12 },
      { header: "Tax", key: "tax", width: 11 },
      { header: "Total", key: "total", width: 13 },
      { header: "Checked Total", key: "expected", width: 14 },
      { header: "Needs attention", key: "flags", width: 70 },
    ];
    ws.getRow(1).font = head;
    ws.getRow(1).fill = fill("FF1B2440");

    for (const b of db.batch) {
      const tax =
        Number(b.extraction.cgst ?? 0) + Number(b.extraction.sgst ?? 0) + Number(b.extraction.igst ?? 0);
      const row = ws.addRow({
        status: b.status === "ready" ? "READY" : "REVIEW",
        file: b.fileName,
        no: b.extraction.invoiceNumber,
        date: b.extraction.invoiceDate,
        party: b.extraction.partyName,
        ledger: b.partyLedgerName ?? "—",
        pscore: Math.round(b.partyScore * 100) + "%",
        taxable: b.computed.lineSum,
        tax: Math.round(tax * 100) / 100,
        total: b.computed.statedTotal ?? 0,
        expected: b.computed.expectedTotal,
        flags: b.flags.map((f) => f.message).join("  |  "),
      });
      if (b.status === "review") {
        row.getCell("status").fill = fill("FFEC7A5E");
        row.getCell("status").font = { bold: true, color: { argb: "FFFFFFFF" } };
      } else {
        row.getCell("status").fill = fill("FF4FD2BB");
        row.getCell("status").font = { bold: true, color: { argb: "FF12182C" } };
      }
    }

    const ls = wb.addWorksheet("Line items");
    ls.columns = [
      { header: "Invoice No", key: "no", width: 18 },
      { header: "Description on bill", key: "desc", width: 30 },
      { header: "Matched stock item", key: "item", width: 28 },
      { header: "Match %", key: "score", width: 9 },
      { header: "Qty", key: "qty", width: 8 },
      { header: "In stock", key: "avail", width: 10 },
      { header: "Rate", key: "rate", width: 10 },
      { header: "Amount", key: "amount", width: 13 },
      { header: "Qty x Rate", key: "check", width: 13 },
    ];
    ls.getRow(1).font = head;
    ls.getRow(1).fill = fill("FF1B2440");

    for (const b of db.batch) {
      for (const l of b.lines) {
        const row = ls.addRow({
          no: b.extraction.invoiceNumber,
          desc: l.description,
          item: l.stockItemName ?? `? ${l.suggestions[0]?.name ?? "no match"}`,
          score: Math.round(l.matchScore * 100) + "%",
          qty: l.qty,
          avail: l.availableQty ?? "—",
          rate: l.rate,
          amount: l.amount,
          check: Math.round(l.qty * l.rate * 100) / 100,
        });
        if (!l.stockItemName) row.getCell("item").fill = fill("FFF4B445");
      }
    }

    const st = wb.addWorksheet("Stock after posting");
    st.columns = [
      { header: "Item", key: "name", width: 30 },
      { header: "Opening", key: "open", width: 10 },
      { header: "Sold", key: "sold", width: 10 },
      { header: "Closing", key: "close", width: 10 },
    ];
    st.getRow(1).font = head;
    st.getRow(1).fill = fill("FF1B2440");
    for (const s of STOCK_ITEMS) {
      const closing = db.stock[s.id] ?? s.openingQty;
      st.addRow({
        name: s.name,
        open: s.openingQty,
        sold: Math.round((s.openingQty - closing) * 100) / 100,
        close: closing,
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${stamp()}-review-sheet.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: `Unknown export "${kind}".` }, { status: 400 });
}
