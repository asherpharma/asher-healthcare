import { clinicSystemHealth } from "../../../server/operations/health.js";
import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
} from "../../../server/razorpay/http.js";

const defaultDependencies = {
  assertSameOrigin,
  clinicSystemHealth,
  errorResponse,
  json,
  requireAdminStaff,
};

export function createAdminHealthHandler(dependencies = defaultDependencies) {
  return async function get(context) {
    try {
      dependencies.assertSameOrigin(context.request);
      const administrator = await dependencies.requireAdminStaff(context.request, context.env);
      return dependencies.json(
        await dependencies.clinicSystemHealth(context.env, administrator),
      );
    } catch (error) {
      return dependencies.errorResponse(error);
    }
  };
}

const get = createAdminHealthHandler();

export async function onRequestGet(context) {
  return get(context);
}
