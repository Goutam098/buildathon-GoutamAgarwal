/**
 * Seeded "shop masters" — the lists that already exist inside the shop's Tally
 * company. Everything here is invented sample data for a fictional utensils
 * business. No real business, GSTIN, customer or invoice appears anywhere.
 */

export const SHOP = {
  name: "Shree Balaji Steel House",
  gstin: "08ABCDE1234F1Z5",
  stateCode: "08",
  state: "Rajasthan",
  address: "Shop 14-A, Kishanpole Bazar, Jaipur, Rajasthan 302003",
  tallyCompany: "Shree Balaji Steel House",
} as const;

export type StockItem = {
  id: string;
  name: string; // exactly as named in Tally
  aliases: string[];
  hsn: string;
  unit: string;
  gstRate: number;
  rate: number;
  openingQty: number;
  godown: string;
};

export type Ledger = {
  id: string;
  name: string; // exactly as named in Tally
  aliases: string[];
  gstin: string | null;
  group: "Sundry Debtors" | "Sundry Creditors";
  stateCode: string;
};

export const STOCK_ITEMS: StockItem[] = [
  { id: "SI-001", name: "Steel Thali 11 inch", aliases: ["thali 11", "khana thali 11"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 185, openingQty: 120, godown: "Main Godown" },
  { id: "SI-002", name: "SS Water Bottle 1 Litre", aliases: ["water bottle 1 ltr", "ss bottle 1l"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 240, openingQty: 300, godown: "Main Godown" },
  { id: "SI-003", name: "Kadhai 24 cm Heavy Base", aliases: ["kadhai 24", "heavy kadhai 24cm"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 430, openingQty: 60, godown: "Main Godown" },
  { id: "SI-004", name: "Steel Container 2 Litre", aliases: ["dabba 2 ltr", "steel dabba 2l"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 310, openingQty: 150, godown: "Main Godown" },
  { id: "SI-005", name: "Tadka Pan 10 cm", aliases: ["chaunk pan", "tadka pan"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 150, openingQty: 95, godown: "Counter Stock" },
  { id: "SI-006", name: "Steel Glass 300 ml", aliases: ["glass 300ml", "pani glass"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 48, openingQty: 640, godown: "Counter Stock" },
  { id: "SI-007", name: "Pressure Cooker 3 Litre", aliases: ["cooker 3l", "pressure cooker 3 ltr"], hsn: "7615", unit: "PCS", gstRate: 18, rate: 1180, openingQty: 42, godown: "Main Godown" },
  { id: "SI-008", name: "Casserole 2.5 Litre", aliases: ["hot pot 2.5l", "casserole 2.5 ltr"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 690, openingQty: 55, godown: "Main Godown" },
  { id: "SI-009", name: "Mixing Bowl Set of 3", aliases: ["bowl set 3", "mixing bowl set"], hsn: "7323", unit: "SET", gstRate: 18, rate: 520, openingQty: 38, godown: "Main Godown" },
  { id: "SI-010", name: "Steel Tiffin 3 Tier", aliases: ["tiffin 3 tier", "lunch box 3 tier"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 395, openingQty: 72, godown: "Counter Stock" },
  { id: "SI-011", name: "Steel Thali 13 inch", aliases: ["thali 13"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 245, openingQty: 80, godown: "Main Godown" },
  { id: "SI-012", name: "Frying Pan 20 cm", aliases: ["tawa pan 20", "frying pan 20cm"], hsn: "7323", unit: "PCS", gstRate: 18, rate: 365, openingQty: 48, godown: "Main Godown" },
];

export const LEDGERS: Ledger[] = [
  { id: "LD-001", name: "Maheshwari Bhandar", aliases: ["maheshwari bhandaar"], gstin: "08MNOPQ9876R1Z4", group: "Sundry Debtors", stateCode: "08" },
  { id: "LD-002", name: "Krishna Steel Traders", aliases: ["krishna steel"], gstin: "08KLMNO4321P1Z9", group: "Sundry Debtors", stateCode: "08" },
  { id: "LD-003", name: "Gopal Ghar Grihasti", aliases: ["gopal grihasti"], gstin: "08GHIJK2468L1Z3", group: "Sundry Debtors", stateCode: "08" },
  { id: "LD-004", name: "Rajasthan Crockery Depot", aliases: ["rajasthan crockery"], gstin: "08DEFGH1357M1Z7", group: "Sundry Debtors", stateCode: "08" },
  { id: "LD-005", name: "Bhandari Kitchen World", aliases: ["bhandari kitchen"], gstin: "08BCDEF8642N1Z1", group: "Sundry Debtors", stateCode: "08" },
  { id: "LD-006", name: "Agarwal Utensils Mart", aliases: ["agarwal utensils"], gstin: "09ABCDE9753Q1Z8", group: "Sundry Debtors", stateCode: "09" },
];

/** Accounting ledgers the sales voucher posts against. */
export const TAX_LEDGERS = {
  salesLocal: "Sales - Local 18%",
  salesInterstate: "Sales - Interstate 18%",
  cgst: "Output CGST 9%",
  sgst: "Output SGST 9%",
  igst: "Output IGST 18%",
  roundOff: "Round Off",
} as const;

/** Confidence thresholds. Above AUTO we post it; between the two a human looks. */
export const AUTO_ACCEPT = 0.88;
export const REVIEW_FLOOR = 0.5;
