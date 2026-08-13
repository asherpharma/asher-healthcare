import {
  getDocument,
  requireActiveStaff,
} from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import {
  actorCanAccessDraft,
  loadConsultationDraft,
  removeConsultationDraft,
  saveConsultationDraft,
} from "../../../server/consultations/draft.js";

function validPatientId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

async function patientForActor(env, actor, patientId) {
  if (!validPatientId(patientId)) throw new HttpError(400, "Choose a valid patient chart.");
  const patient = await getDocument(env, `patients/${patientId}`);
  if (!patient || patient.data.archived === true) throw new HttpError(409, "This patient chart is unavailable.");
  if (!actorCanAccessDraft(actor, patient.data)) throw new HttpError(403, "This patient is not assigned to your account.");
  return { actor, patient };
}

export function createConsultationDraftHandlers(dependencies = {}) {
  const services = {
    patientForActor,
    assertSameOrigin,
    errorResponse,
    json,
    loadConsultationDraft,
    readJson,
    removeConsultationDraft,
    requireActiveStaff,
    saveConsultationDraft,
    ...dependencies,
  };
  return {
    async post(context) {
      try {
        services.assertSameOrigin(context.request);
        const actor = await services.requireActiveStaff(context.request, context.env);
        const body = await services.readJson(context.request, 4_000);
        if (body?.action !== "load") throw new HttpError(400, "Choose a valid consultation draft action.");
        const patientId = String(body?.patientId || "").trim();
        const appointmentId = String(body?.appointmentId || "").trim();
        const { patient } = await services.patientForActor(context.env, actor, patientId);
        const draft = await services.loadConsultationDraft(
          context.env,
          { patientId, appointmentId },
          actor,
          patient,
        );
        return services.json({ draft });
      } catch (error) {
        return services.errorResponse(error);
      }
    },
    get() {
      return services.json({ error: "Consultation identifiers are not accepted in URLs." }, 405);
    },
  };
}

export function onRequestPost(context) {
  return createConsultationDraftHandlers().post(context);
}

export function onRequestGet() {
  return createConsultationDraftHandlers().get();
}

export async function onRequestPut(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await requireActiveStaff(context.request, context.env);
    const body = await readJson(context.request, 80_000);
    const patientId = String(body?.patientId || "").trim();
    const { patient } = await patientForActor(context.env, actor, patientId);
    const result = await saveConsultationDraft(context.env, body, actor, patient);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await requireActiveStaff(context.request, context.env);
    const body = await readJson(context.request);
    const patientId = String(body?.patientId || "").trim();
    const { patient } = await patientForActor(context.env, actor, patientId);
    const result = await removeConsultationDraft(
      context.env,
      { patientId, appointmentId: body?.appointmentId },
      actor,
      patient,
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
