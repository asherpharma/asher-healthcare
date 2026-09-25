import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError, json } from "../razorpay/http.js";

export const HOMEPAGE_EVENTS = Object.freeze([
  "homepage_view",
  "call_click",
  "directions_click",
]);
export const HOMEPAGE_DAILY_LIMIT = 10_000;
export const HOMEPAGE_MAX_ATTEMPTS = 4;
export const HOMEPAGE_REPORT_CONCURRENCY = 5;
export const HOMEPAGE_BODY_LIMIT = 256;
export const HOMEPAGE_ORIGINS = Object.freeze([
  "https://asherhealthcare.in",
  "https://www.asherhealthcare.in",
]);
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
const STORE_DEPENDENCIES = Object.freeze({ getDocument, commitWrites });

function emptyCounts() {
  return { homepage_view: 0, call_click: 0, directions_click: 0 };
}

export function homepageDate(now = new Date()) {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new HttpError(503, "Measurement unavailable.");
  return new Date(timestamp + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// No untrusted request values are returned or logged in measurement errors.
export function homepageErrorResponse(error) {
  const status = error instanceof HttpError && [400, 401, 403, 405, 413, 415, 429, 503].includes(error.status)
    ? error.status
    : 503;
  return json({ error: status >= 500 ? "Measurement temporarily unavailable." : "Measurement request not accepted." }, status);
}

export function assertHomepageOrigin(request, { allowedOrigins = HOMEPAGE_ORIGINS, adminRead = false } = {}) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (
    !allowedOrigins.includes(requestOrigin)
    || (origin !== requestOrigin && !(adminRead && !origin && fetchSite === "same-origin"))
    || (fetchSite && fetchSite !== "same-origin")
  ) {
    throw new HttpError(403, "Measurement requires a same-origin request.");
  }
}

export function declinesHomepageMeasurement(request) {
  return request.headers.get("Sec-GPC") === "1" || request.headers.get("DNT") === "1";
}

export async function readHomepageEvent(request) {
  if (new URL(request.url).search) throw new HttpError(400, "Measurement does not accept query parameters.");
  if (request.headers.has("Cookie") || request.headers.has("Authorization")) {
    throw new HttpError(400, "Measurement does not accept credentials.");
  }
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw new HttpError(415, "Measurement accepts JSON only.");
  }
  const contentEncoding = request.headers.get("Content-Encoding");
  if (contentEncoding && contentEncoding !== "identity") throw new HttpError(415, "Measurement accepts uncompressed JSON only.");
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > HOMEPAGE_BODY_LIMIT)) {
    throw new HttpError(413, "Measurement payload too large.");
  }
  if (!request.body) throw new HttpError(400, "Measurement payload required.");

  // Request.text() buffers an unbounded body. Stop the stream before accepting
  // more than 256 bytes, even when Content-Length is missing or misleading.
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > HOMEPAGE_BODY_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new HttpError(413, "Measurement payload too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Measurement body could not be read.");
  } finally {
    reader.releaseLock();
  }

  let body;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, "Measurement payload invalid.");
  }
  if (
    !body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, "event")
    || !HOMEPAGE_EVENTS.includes(body.event)
  ) {
    throw new HttpError(400, "Measurement event invalid.");
  }
  return body.event;
}

function storedCounts(document) {
  if (!document) return emptyCounts();
  const data = document.data;
  if (
    !data || Object.keys(data).length !== HOMEPAGE_EVENTS.length
    || HOMEPAGE_EVENTS.some((event) => !Number.isSafeInteger(data[event]) || data[event] < 0)
    || HOMEPAGE_EVENTS.reduce((sum, event) => sum + data[event], 0) > HOMEPAGE_DAILY_LIMIT
  ) {
    throw new HttpError(503, "Measurement record invalid.");
  }
  return Object.fromEntries(HOMEPAGE_EVENTS.map((event) => [event, data[event]]));
}

export async function incrementHomepageCount(env, event, now = new Date(), dependencies = STORE_DEPENDENCIES) {
  if (!HOMEPAGE_EVENTS.includes(event)) throw new HttpError(400, "Measurement event invalid.");
  const path = `homepageMetrics/${homepageDate(now)}`;
  for (let attempt = 0; attempt < HOMEPAGE_MAX_ATTEMPTS; attempt += 1) {
    const document = await dependencies.getDocument(env, path);
    const counts = storedCounts(document);
    if (HOMEPAGE_EVENTS.reduce((sum, key) => sum + counts[key], 0) >= HOMEPAGE_DAILY_LIMIT) {
      return { recorded: false };
    }
    if (document && (typeof document.updateTime !== "string" || !document.updateTime)) {
      throw new HttpError(503, "Measurement revision unavailable.");
    }
    counts[event] += 1;
    const write = document
      ? updateDocumentWrite(env, path, counts, HOMEPAGE_EVENTS, document.updateTime)
      : createDocumentWrite(env, path, counts);
    try {
      await dependencies.commitWrites(env, [write]);
      return { recorded: true };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
    }
  }
  throw new HttpError(503, "Measurement busy.");
}

export function homepageReportDays(request) {
  const parameters = new URL(request.url).searchParams;
  const values = [...parameters.entries()];
  if (!values.length) return 7;
  if (values.length !== 1 || values[0][0] !== "days" || !["7", "30"].includes(values[0][1])) {
    throw new HttpError(400, "Choose a seven-day or thirty-day report.");
  }
  return Number(values[0][1]);
}

export async function getHomepageCounts(env, days = 7, now = new Date(), dependencies = STORE_DEPENDENCIES) {
  if (![7, 30].includes(days)) throw new HttpError(400, "Invalid report range.");
  const today = Date.parse(`${homepageDate(now)}T00:00:00Z`);
  const rows = [];
  const totals = emptyCounts();
  const dates = Array.from({ length: days }, (_, index) => (
    new Date(today - (days - index - 1) * DAY_MS).toISOString().slice(0, 10)
  ));
  // At most 30 point reads, five at a time. Promise.all retains date order
  // regardless of completion order; no patient/visitor queries are made.
  for (let offset = 0; offset < dates.length; offset += HOMEPAGE_REPORT_CONCURRENCY) {
    const batch = await Promise.all(dates.slice(offset, offset + HOMEPAGE_REPORT_CONCURRENCY).map(async (date) => ({
      date,
      ...storedCounts(await dependencies.getDocument(env, `homepageMetrics/${date}`)),
    })));
    for (const row of batch) {
      rows.push(row);
      for (const event of HOMEPAGE_EVENTS) totals[event] += row[event];
    }
  }
  return {
    days,
    timezone: "Asia/Kolkata",
    rows,
    totals,
    note: "Counts are page loads and button taps, not unique visitors, completed calls, visits, appointments or Google Ads conversions.",
  };
}
