import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import {
  getServiceCatalogForAdministrator,
  setServiceCatalogForAdministrator,
} from "../../../server/reception/service-catalog-management.js";

const DEFAULT_DEPENDENCIES = Object.freeze({
  assertSameOrigin,
  errorResponse,
  getServiceCatalogForAdministrator,
  json,
  readJson,
  requireAdminStaff,
  setServiceCatalogForAdministrator,
});

export function createServiceCatalogHandlers(dependencies = DEFAULT_DEPENDENCIES) {
  return {
    async get(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const administrator = await dependencies.requireAdminStaff(context.request, context.env);
        return dependencies.json(await dependencies.getServiceCatalogForAdministrator(
          context.env,
          administrator,
        ));
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
    async post(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const administrator = await dependencies.requireAdminStaff(context.request, context.env);
        const body = await dependencies.readJson(context.request);
        return dependencies.json(await dependencies.setServiceCatalogForAdministrator(
          context.env,
          body,
          administrator,
        ));
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
  };
}

const handlers = createServiceCatalogHandlers();

export const onRequestGet = handlers.get;
export const onRequestPost = handlers.post;
