import { getDocument, requireAdminStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import { validDocumentId } from "../../../server/razorpay/payments.js";
import {
  reconcileRefund,
  refundOperationResult,
} from "../../../server/razorpay/refunds.js";
import {
  fetchRazorpayPaymentRefunds,
  fetchRazorpayRefund,
} from "../../../server/razorpay/razorpay.js";

function validGatewayId(value, prefix) {
  return typeof value === "string"
    && value.startsWith(prefix)
    && /^[A-Za-z0-9_]+$/u.test(value)
    && value.length <= 100;
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const admin = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    if (!validDocumentId(body.requestId)) {
      throw new HttpError(400, "Select a valid refund operation to reconcile.");
    }

    const operation = await getDocument(context.env, `refundOperations/${body.requestId}`);
    if (!operation) throw new HttpError(404, "The refund operation could not be found.");
    if (operation.data.status === "processed") {
      return json({ refund: refundOperationResult(operation.data) });
    }

    let gatewayRefund = null;
    if (validGatewayId(operation.data.refundId, "rfnd_")) {
      gatewayRefund = await fetchRazorpayRefund(context.env, operation.data.refundId);
    } else if (validGatewayId(operation.data.gatewayPaymentId, "pay_")) {
      const refunds = await fetchRazorpayPaymentRefunds(
        context.env,
        operation.data.gatewayPaymentId,
      );
      gatewayRefund = (refunds.items || []).find(
        (item) => item?.notes?.request_id === body.requestId,
      ) || null;
    }

    if (!gatewayRefund) {
      return json({ refund: refundOperationResult(operation.data) });
    }

    const refund = await reconcileRefund(context.env, {
      requestId: body.requestId,
      refund: gatewayRefund,
      actorUid: admin.uid,
    });
    return json({ refund });
  } catch (error) {
    return errorResponse(error);
  }
}
