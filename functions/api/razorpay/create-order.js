import {
  assertActivePatientDocument,
  assertBillingStaff,
  createDocumentWrite,
  commitWrites,
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
import { createRazorpayOrder } from "../../../server/razorpay/razorpay.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    requireEnvironment(context.env, ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    const staff = assertBillingStaff(
      await requireActiveStaff(context.request, context.env),
    );
    const body = await readJson(context.request);
    if (!validDocumentId(body.invoiceId)) {
      throw new HttpError(400, "Select a valid clinic invoice.");
    }

    const invoice = await getDocument(context.env, `invoices/${body.invoiceId}`);
    if (!invoice) throw new HttpError(404, "This invoice could not be found.");
    const patientId = invoice.data.patientId;
    if (!validDocumentId(patientId)) {
      throw new HttpError(409, "This invoice is not linked to an active patient record. Correct the invoice before starting a payment.");
    }
    const patient = assertActivePatientDocument(
      await getDocument(context.env, `patients/${patientId}`),
      {
        missingMessage: "The patient record linked to this invoice no longer exists. Restore or correct it before starting a payment.",
        archivedMessage: "The patient record linked to this invoice is archived. Restore it before starting a payment.",
      },
    );
    const requestedPaise = toPaise(body.amount);
    const balancePaise = toPaise(invoice.data.balance);
    if (requestedPaise <= 0 || requestedPaise > balancePaise) {
      throw new HttpError(400, "Enter an amount greater than zero and not above the current balance.");
    }

    const receipt = `ASH-${body.invoiceId.slice(0, 12)}-${crypto.randomUUID().slice(0, 8)}`;
    const order = await createRazorpayOrder(context.env, {
      amount: requestedPaise,
      currency: "INR",
      receipt,
      notes: {
        invoice_id: body.invoiceId,
        invoice_number: String(invoice.data.invoiceNumber || "").slice(0, 40),
      },
    });
    const createdAt = new Date();
    await commitWrites(context.env, [
      verifyDocumentWrite(context.env, `invoices/${body.invoiceId}`, invoice.updateTime),
      verifyDocumentWrite(context.env, `patients/${patientId}`, patient.updateTime),
      createDocumentWrite(context.env, `paymentOrders/${order.id}`, {
        orderId: order.id,
        invoiceId: body.invoiceId,
        patientId,
        invoiceNumber: invoice.data.invoiceNumber,
        amount: requestedPaise / 100,
        amountPaise: requestedPaise,
        currency: "INR",
        receipt,
        status: "created",
        createdBy: staff.uid,
        createdAt,
      }),
    ]);

    return json({
      keyId: context.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: requestedPaise,
      currency: "INR",
      invoiceNumber: invoice.data.invoiceNumber,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
