import { COMPANY_LOGOS } from "../domain/constants";
import { QUOTE_SECTIONS, quoteTotals, unitPrice, type QuoteLine, type QuoteSection } from "../domain/quotes";
import type { Company, Customer } from "../domain/types";
import type { Quote } from "../data/quotes";

// The client-facing PDF is always in English (the clients are in the US) and
// never shows cost or margin.
const SECTION_TITLES: Record<QuoteSection, string> = {
  base: "Base cabinets",
  wall: "Wall cabinets",
  tall: "Tall and pantry cabinets",
  vanity: "Bathroom vanities",
  trim: "Trim, panels and fillers",
  accessories: "Accessories",
  other: "Installation and other"
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const longDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
// Muses writes inches as two apostrophes.
const inches = (s: string) => s.replace(/''/g, "\"").replace(/\*/g, " x ");

function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [15, 23, 42];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// jsPDF can't draw SVG, so the logo goes through a canvas as PNG.
async function logoPng(companyId: string): Promise<{ data: string; w: number; h: number } | null> {
  const src = COMPANY_LOGOS[companyId];
  if (!src) return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = 600 / Math.max(img.naturalWidth || 600, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((img.naturalWidth || 600) * scale);
    canvas.height = Math.round((img.naturalHeight || 600) * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
  } catch {
    return null;
  }
}

export function quoteFileName(quote: Quote, clientName: string): string {
  const slug = `${clientName || "client"} estimate v${quote.version}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${slug}.pdf`;
}

export async function downloadQuotePdf(args: { company: Company; quote: Quote; lines: QuoteLine[]; client: Pick<Customer, "name" | "phone" | "email" | "address" | "city" | "state" | "zip"> | null }) {
  const { company, quote, lines, client } = args;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const brand = hexToRgb(company.color);
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const totals = quoteTotals(lines, quote);
  const issued = quote.sent_at ? new Date(quote.sent_at) : new Date();
  const validUntil = new Date(issued.getTime() + quote.valid_days * 86400000);

  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 6, "F");

  let y = 40;
  const logo = await logoPng(company.id);
  if (logo) {
    const h = 44;
    const w = Math.min(160, (logo.w / logo.h) * h);
    doc.addImage(logo.data, "PNG", M, y, w, (logo.h / logo.w) * w, undefined, "FAST");
  } else {
    doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...brand);
    doc.text(company.name, M, y + 28);
  }

  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(15, 23, 42);
  doc.text("ESTIMATE", W - M, y + 18, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(100, 116, 139);
  doc.text([`Version ${quote.version}`, `Date: ${longDate(issued)}`, `Valid until: ${longDate(validUntil)}`], W - M, y + 34, { align: "right" });

  y = 120;
  doc.setDrawColor(226, 232, 240).line(M, y, W - M, y);
  y += 22;
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(100, 116, 139);
  doc.text("PREPARED FOR", M, y);
  doc.text("PROJECT", W / 2, y);
  doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(15, 23, 42);
  const place = client ? [client.city, [client.state, client.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const clientLines = client ? [client.name, client.address, place, client.phone, client.email].filter(Boolean) : ["-"];
  doc.text(clientLines, M, y + 16);
  const projectLines = doc.splitTextToSize(quote.title || "Project", W / 2 - M);
  if (quote.door_line) projectLines.push(`Door style: ${quote.door_line}`);
  doc.text(projectLines, W / 2, y + 16);
  y += 16 + Math.max(clientLines.length, projectLines.length) * 13 + 18;

  const body: any[] = [];
  for (const section of QUOTE_SECTIONS) {
    const rows = lines.filter(l => l.section === section);
    if (!rows.length) continue;
    body.push([{ content: SECTION_TITLES[section], colSpan: 5, styles: { fontStyle: "bold", fillColor: [241, 245, 249], textColor: [15, 23, 42] } }]);
    for (const l of rows) {
      const price = unitPrice(l, quote);
      const name = [l.description, l.sku].filter(Boolean).join("\n");
      body.push([name, inches(l.dimensions), String(l.qty), usd(price), usd(price * l.qty)]);
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 56 },
    head: [["Item", "Size", { content: "Qty", styles: { halign: "center" } }, { content: "Unit price", styles: { halign: "right" } }, { content: "Amount", styles: { halign: "right" } }]],
    body,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: { bottom: 0.5 } },
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 120 }, 2: { cellWidth: 34, halign: "center" }, 3: { cellWidth: 72, halign: "right" }, 4: { cellWidth: 78, halign: "right" } }
  });

  y = (doc as any).lastAutoTable.finalY + 18;
  const H = doc.internal.pageSize.getHeight();
  const rows: [string, string, boolean][] = [["Subtotal", usd(totals.subtotal), false]];
  if (totals.discount > 0) rows.push(["Discount", `- ${usd(totals.discount)}`, false]);
  rows.push(["Total", usd(totals.total), true]);
  if (quote.deposit_pct > 0) rows.push([`Deposit to schedule (${quote.deposit_pct}%)`, usd(totals.deposit), false]);
  if (y + rows.length * 20 + 20 > H - 56) { doc.addPage(); y = 56; }
  const labelX = W - M - 230;
  for (const [label, value, strong] of rows) {
    if (strong) {
      doc.setFillColor(...brand).roundedRect(labelX - 10, y - 13, W - M - labelX + 10, 22, 4, 4, "F");
      doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(255, 255, 255);
    } else {
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(51, 65, 85);
    }
    doc.text(label, labelX, y);
    doc.text(value, W - M - 6, y, { align: "right" });
    y += strong ? 26 : 18;
  }

  const terms = [
    quote.notes.trim(),
    `This estimate is valid until ${longDate(validUntil)}.`,
    quote.deposit_pct > 0 ? `A ${quote.deposit_pct}% deposit confirms the order; the balance is due on completion.` : "",
    "Installation dates are scheduled after the deposit is received."
  ].filter(Boolean);
  y += 14;
  const wrapped = doc.splitTextToSize(terms.join("\n\n"), W - 2 * M);
  if (y + 16 + wrapped.length * 12 > H - 56) { doc.addPage(); y = 56; }
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(100, 116, 139);
  doc.text("NOTES AND TERMS", M, y);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(51, 65, 85);
  doc.text(wrapped, M, y + 16);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(148, 163, 184);
    doc.text(company.name, M, H - 28);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 28, { align: "right" });
  }

  doc.save(quoteFileName(quote, client?.name || ""));
}
