import {
  assertActivePatientDocument,
  assertBillingStaff,
  commitWrites,
  createDocumentWrite,
  getDocument,
  requireActiveStaff,
  verifyDocumentWrite,
} from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
  requireEnvironment,
} from "../../../server/razorpay/http.js";
import { toPaise, validDocumentId } from "../../../server/razorpay/payments.js";
import { createRazorpayQrCode } from "../../../server/razorpay/razorpay.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    requireEnvironment(context.env, ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    const staff = assertBillingStaff(
      await requireActiveStaff(context.request, context.env),
    );
    const body = await readJson(context.request);
    if (!validDocumentId(body.invoiceId)) {
      throw new HttpError(400, "Select a valid consultation invoice.");
    }

    const invoice = await getDocument(context.env, `invoices/${body.invoiceId}`);
    if (!invoice) throw new HttpError(404, "This consultation invoice could not be found.");
    const patientId = invoice.data.patientId;
    if (!validDocumentId(patientId)) {
      throw new HttpError(409, "This invoice is not linked to an active patient record. Correct the invoice before creating a payment QR.");
    }
    const patient = assertActivePatientDocument(
      await getDocument(context.env, `patients/${patientId}`),
      {
        missingMessage: "The patient record linked to this invoice no longer exists. Restore or correct it before creating a payment QR.",
        archivedMessage: "The patient record linked to this invoice is archived. Restore it before creating a payment QR.",
      },
    );
    const balancePaise = toPaise(invoice.data.balance);
    if (balancePaise <= 0) {
      throw new HttpError(409, "This consultation invoice is already paid.");
    }

    const closeBy = Math.floor(Date.now() / 1000) + 30 * 60;
    const qr = await createRazorpayQrCode(context.env, {
      type: "upi_qr",
      name: `Asher ${String(invoice.data.invoiceNumber || body.invoiceId)}`.slice(0, 80),
      usage: "single_use",
      fixed_amount: true,
      payment_amount: balancePaise,
      description: `Consultation fee for ${String(invoice.data.patientName || "patient")}`.slice(0, 255),
      close_by: closeBy,
      notes: {
        invoice_id: body.invoiceId,
        invoice_number: String(invoice.data.invoiceNumber || "").slice(0, 40),
        patient_id: String(invoice.data.patientId || "").slice(0, 40),
      },
    });

    const createdAt = new Date();
    await commitWrites(context.env, [
      verifyDocumentWrite(context.env, `invoices/${body.invoiceId}`, invoice.updateTime),
      verifyDocumentWrite(context.env, `patients/${patientId}`, patient.updateTime),
      createDocumentWrite(context.env, `paymentQrCodes/${qr.id}`, {
        qrId: qr.id,
        invoiceId: body.invoiceId,
        invoiceNumber: invoice.data.invoiceNumber,
        patientId,
        patientName: invoice.data.patientName,
        amount: balancePaise / 100,
        amountPaise: balancePaise,
        currency: "INR",
        imageUrl: qr.image_url,
        status: "active",
        closeBy,
        createdBy: staff.uid,
        createdAt,
      }),
    ]);

    return json({
      qrId: qr.id,
      imageUrl: qr.image_url,
      amount: balancePaise / 100,
      expiresAt: closeBy * 1000,
      invoiceNumber: invoice.data.invoiceNumber,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
