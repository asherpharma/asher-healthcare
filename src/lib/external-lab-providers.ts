export type ExternalLabProviderCapabilities = {
  portalLaunch: boolean;
  statusLookup: boolean;
  reportFetch: boolean;
  signedWebhooks: boolean;
};

export type ExternalLabProvider = {
  id: "ayuslab";
  displayName: string;
  portalLoginUrl: string;
  portalReportsUrl: string;
  workflowMode: "manual_portal";
  capabilities: ExternalLabProviderCapabilities;
};

/**
 * Only publicly verified provider details belong in the browser bundle.
 * Credentials, cookies, patient identifiers, and report links must never be
 * added here or appended to the portal URL.
 */
export const AYUSLAB_PROVIDER: ExternalLabProvider = {
  id: "ayuslab",
  displayName: "AyusLab",
  portalLoginUrl: "https://ayuslab.com/users/sign_in",
  portalReportsUrl: "https://ayuslab.com/report_viewer/reports",
  workflowMode: "manual_portal",
  capabilities: {
    portalLaunch: true,
    statusLookup: false,
    reportFetch: false,
    signedWebhooks: false,
  },
};
