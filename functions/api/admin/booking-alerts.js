import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
import { assertSameOrigin, HttpError, json, readJson } from "../../../server/razorpay/http.js";
import { createBookingAlertService } from "../../../server/notifications/booking-alerts.js";
import { createPushDeliveryService } from "../../../server/notifications/push-delivery.js";

const pushDelivery = createPushDeliveryService();
const service = createBookingAlertService({ deliverPush: (env, id) => pushDelivery.deliver(env, id) });

// Do not log exceptions that could contain a browser push endpoint or key.
function notificationErrorResponse(error) {
  return error instanceof HttpError
    ? json({ error: error.message }, error.status)
    : json({ error: "Appointment notification settings are temporarily unavailable." }, 500);
}

export function createBookingAlertHandlers(overrides = {}) {
  const dependencies = {
    assertSameOrigin,
    requireAdminStaff,
    readJson,
    json,
    errorResponse: notificationErrorResponse,
    service,
    ...overrides,
  };
  return {
    async get(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const administrator = await dependencies.requireAdminStaff(context.request, context.env);
        return dependencies.json(await dependencies.service.get(context.request, context.env, administrator));
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
    async post(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const administrator = await dependencies.requireAdminStaff(context.request, context.env);
        const body = await dependencies.readJson(context.request, 6000);
        return dependencies.json(await dependencies.service.post(context.request, context.env, administrator, body));
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
  };
}

const handlers = createBookingAlertHandlers();
export const onRequestGet = handlers.get;
export const onRequestPost = handlers.post;
