import { HttpError } from "../razorpay/http.js";

const PROVIDERS = Object.freeze({
  ayuslab: Object.freeze({
    id: "ayuslab",
    displayName: "AyusLab",
    portalLoginUrl: "https://ayuslab.com/users/sign_in",
    portalReportsUrl: "https://ayuslab.com/report_viewer/reports",
    workflowMode: "manual_portal",
    capabilities: Object.freeze({
      portalLaunch: true,
      statusLookup: false,
      reportFetch: false,
      signedWebhooks: false,
    }),
  }),
});

/**
 * Server-owned provider metadata. This module intentionally contains no
 * username, password, cookie, API key, or patient-specific URL.
 */
export function externalLabProvider(providerId) {
  const provider = PROVIDERS[String(providerId || "").trim().toLowerCase()];
  if (!provider) throw new HttpError(400, "Choose a supported external laboratory.");
  return provider;
}

export function publicExternalLabProvider(providerId) {
  const provider = externalLabProvider(providerId);
  return {
    id: provider.id,
    displayName: provider.displayName,
    portalLoginUrl: provider.portalLoginUrl,
    portalReportsUrl: provider.portalReportsUrl,
    workflowMode: provider.workflowMode,
    capabilities: { ...provider.capabilities },
  };
}
