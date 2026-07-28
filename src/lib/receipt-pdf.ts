import { jsPDF } from "jspdf";

export type ReceiptLineItem = { description: string; quantity: number; unitPrice: number; amount: number };
export type ReceiptInvoice = {
  invoiceNumber: string;
  patientName: string;
  patientPhone: string;
  items: ReceiptLineItem[];
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: string;
  paymentMethod: string;
  paymentReference: string;
  notes: string;
  createdAt?: { toDate: () => Date };
};

function money(value: number) {
  return "INR " + value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function labelMethod(value: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not recorded";
}

export function downloadReceiptPdf(invoice: ReceiptInvoice) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const navy: [number, number, number] = [35, 58, 89];
  const gold: [number, number, number] = [168, 134, 74];
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 16;

  pdf.setFillColor(...navy);
  pdf.rect(0, 0, pageWidth, 40, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("ASHER WOMEN & CHILD HEALTHCARE", margin, 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Ground Floor, 546, Thanisandra Main Road, RK Hegde Nagar, Bengaluru 560077", margin, 24);
  pdf.text("Phone: +91 90192 63709  |  asherhealthcare.in", margin, 30);
  pdf.setFillColor(...gold);
  pdf.rect(0, 38, pageWidth, 2, "F");

  pdf.setTextColor(...navy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("PAYMENT RECEIPT", margin, 54);
  pdf.setFontSize(10);
  pdf.text(invoice.invoiceNumber, pageWidth - margin, 54, { align: "right" });

  const date = invoice.createdAt?.toDate?.() ?? new Date();
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(70, 80, 95);
  pdf.text("Date: " + date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), margin, 62);
  pdf.text("Patient: " + invoice.patientName, margin, 70);
  pdf.text("Phone: " + invoice.patientPhone, pageWidth - margin, 70, { align: "right" });

  let y = 82;
  pdf.setFillColor(241, 245, 249);
  pdf.rect(margin, y - 6, pageWidth - margin * 2, 9, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...navy);
  pdf.text("Description", margin + 2, y);
  pdf.text("Qty", 125, y, { align: "right" });
  pdf.text("Rate", 158, y, { align: "right" });
  pdf.text("Amount", pageWidth - margin - 2, y, { align: "right" });
  y += 9;

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(60, 70, 85);
  for (const item of invoice.items) {
    const description = pdf.splitTextToSize(item.description || "Clinic service", 85);
    const rowHeight = Math.max(8, description.length * 5.5);
    if (y + rowHeight > 250) {
      pdf.addPage();
      y = 20;
    }
    pdf.text(description, margin + 2, y);
    pdf.text(String(item.quantity), 125, y, { align: "right" });
    pdf.text(money(item.unitPrice), 158, y, { align: "right" });
    pdf.text(money(item.amount), pageWidth - margin - 2, y, { align: "right" });
    y += rowHeight;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y - 3, pageWidth - margin, y - 3);
  }

  y += 5;
  const totalsX = 132;
  const valueX = pageWidth - margin - 2;
  pdf.setFont("helvetica", "normal");
  pdf.text("Subtotal", totalsX, y);
  pdf.text(money(invoice.subtotal), valueX, y, { align: "right" });
  y += 7;
  pdf.text("Discount", totalsX, y);
  pdf.text(money(invoice.discount), valueX, y, { align: "right" });
  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...navy);
  pdf.text("Total", totalsX, y);
  pdf.text(money(invoice.total), valueX, y, { align: "right" });
  y += 8;
  pdf.setTextColor(22, 101, 52);
  pdf.text("Amount received", totalsX, y);
  pdf.text(money(invoice.amountPaid), valueX, y, { align: "right" });
  y += 8;
  pdf.setTextColor(invoice.balance > 0 ? 185 : 35, invoice.balance > 0 ? 28 : 58, invoice.balance > 0 ? 28 : 89);
  pdf.text("Balance due", totalsX, y);
  pdf.text(money(invoice.balance), valueX, y, { align: "right" });

  y += 14;
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, y - 6, pageWidth - margin * 2, 24, 3, 3, "F");
  pdf.setTextColor(60, 70, 85);
  pdf.setFont("helvetica", "normal");
  pdf.text("Payment status: " + labelMethod(invoice.paymentStatus), margin + 4, y);
  pdf.text("Method: " + labelMethod(invoice.paymentMethod), margin + 4, y + 7);
  if (invoice.paymentReference) pdf.text("Reference: " + invoice.paymentReference, margin + 4, y + 14);

  y += 28;
  if (invoice.notes) {
    pdf.setTextColor(80, 90, 105);
    pdf.text(pdf.splitTextToSize("Notes: " + invoice.notes, pageWidth - margin * 2), margin, y);
  }

  pdf.setFontSize(9);
  pdf.setTextColor(100, 110, 125);
  pdf.text("Computer-generated receipt. Thank you for choosing Asher Healthcare.", pageWidth / 2, 287, { align: "center" });
  pdf.save(invoice.invoiceNumber + "-receipt.pdf");
}
