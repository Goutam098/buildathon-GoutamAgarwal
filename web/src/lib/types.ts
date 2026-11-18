export type Severity = "error" | "warn" | "info";

export type Flag = {
  code: string;
  severity: Severity;
  message: string;
  scope: "invoice" | "party" | "line";
  lineIndex?: number;
};

export type ExtractedLine = {
  description: string;
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  amount: number;
};

export type ExtractedInvoice = {
  invoiceNumber: string;
  invoiceDate: string; // dd-mm-yyyy as printed
  partyName: string;
  partyGstin?: string | null;
  partyAddress?: string | null;
  supplierName?: string | null;
  supplierGstin?: string | null;
  lines: ExtractedLine[];
  taxableValue?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  roundOff?: number | null;
  grandTotal?: number | null;
  unreadableFields?: string[];
};

export type Suggestion = { id: string; name: string; score: number };

export type ResolvedLine = ExtractedLine & {
  stockItemId: string | null;
  stockItemName: string | null;
  matchScore: number;
  suggestions: Suggestion[];
  availableQty: number | null;
  gstRate: number | null;
};

export type Computed = {
  lineSum: number;
  expectedTax: number;
  expectedTotal: number;
  statedTotal: number | null;
  totalDelta: number | null;
  supply: "intra" | "inter" | "unknown";
};

/** Decisions a human made on the review screen. Replayed on every recompute. */
export type Overrides = {
  partyLedgerId?: string | null;
  createPartyAsNew?: boolean;
  lineItems?: Record<string, string>; // line index -> stock item id
  edits?: Partial<ExtractedInvoice>; // corrected figures
};

export type ReviewInvoice = {
  id: string;
  fileName: string;
  overrides?: Overrides;
  isNewLedger?: boolean;
  imageUrl?: string;
  extraction: ExtractedInvoice;
  partyLedgerId: string | null;
  partyLedgerName: string | null;
  partyScore: number;
  partySuggestions: Suggestion[];
  lines: ResolvedLine[];
  flags: Flag[];
  computed: Computed;
  status: "ready" | "review";
  approved?: boolean;
  extractionMs?: number;
  source?: "live" | "cached" | "counter";
};
