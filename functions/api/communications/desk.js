import {
  communicationDeskForStaff,
  handleCommunicationAction,
} from "../../../server/communications/workflow.js";
import { requireActiveStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../server/razorpay/http.js";

const DEFAULT_DEPENDENCIES = Object.freeze({
  assertSameOrigin,
  communicationDeskForStaff,
  errorResponse,
  handleCommunicationAction,
  json,
  readJson,
  requireActiveStaff,
});

export function createCommunicationDeskHandlers(dependencies = DEFAULT_DEPENDENCIES) {
  return {
    async get(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const staff = await dependencies.requireActiveStaff(context.request, context.env);
        return dependencies.json(await dependencies.communicationDeskForStaff(
          context.env,
          staff,
        ));
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
    async post(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const staff = await dependencies.requireActiveStaff(context.request, context.env);
        const body = await dependencies.readJson(context.request);
        return dependencies.json(await dependencies.handleCommunicationAction(
          context.env,
          staff,
          body,
        ));
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
  };
}

const handlers = createCommunicationDeskHandlers();

export const onRequestGet = handlers.get;
export const onRequestPost = handlers.post;
