export const MAX_REPORT_FILE_BYTES = 10 * 1024 * 1024;
export const REPORT_FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export type AcceptedReport = {
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  extension: "pdf" | "jpg" | "png" | "webp";
};

function bytesStartWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export async function inspectReportFile(file: File): Promise<AcceptedReport | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { contentType: "application/pdf", extension: "pdf" };
  }
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytesStartWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

export function normalizedReportName(originalName: string, extension: AcceptedReport["extension"]) {
  const stem = originalName
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "medical-report";
  return `${stem}.${extension}`;
}

export function createReportStoragePath(
  patientId: string,
  originalName: string,
  extension: AcceptedReport["extension"],
) {
  const fileName = normalizedReportName(originalName, extension);
  const uniquePart = crypto.randomUUID().slice(0, 8);
  return {
    fileName,
    storagePath: `reports/${patientId}/${Date.now()}-${uniquePart}-${fileName}`,
  };
}

export function reportStorageErrorMessage(error: unknown, action: "upload" | "open") {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";

  if (code.includes("unauthorized")) {
    return action === "upload"
      ? "Your staff role does not allow this report upload. Check the patient assignment or ask an administrator."
      : "Your staff role does not allow access to this report.";
  }
  if (code.includes("bucket-not-found") || code.includes("no-default-bucket")) {
    return "Secure report storage is temporarily unavailable. Please contact the clinic administrator.";
  }
  if (code.includes("quota-exceeded")) {
    return "The clinic storage limit has been reached. Please contact the clinic administrator.";
  }
  if (code.includes("retry-limit-exceeded") || code.includes("network")) {
    return "The connection was interrupted. Check the network and try again.";
  }
  if (code.includes("canceled")) {
    return action === "upload" ? "The report upload was cancelled." : "Opening the report was cancelled.";
  }
  return action === "upload"
    ? "Unable to upload this report. Please check access and try again."
    : "Unable to open this report. Please check access and try again.";
}

export function openPendingReportWindow() {
  const preview = window.open("", "_blank");
  if (!preview) return null;
  preview.opener = null;
  preview.document.title = "Opening secure report";
  preview.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#233a59;font-family:system-ui,sans-serif";
  const status = preview.document.createElement("p");
  status.textContent = "Opening secure report…";
  status.style.cssText = "font-weight:700;padding:24px;text-align:center";
  preview.document.body.appendChild(status);
  return preview;
}
