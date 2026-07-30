const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

export function errorResponse(error) {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status);
  }

  console.error("Unhandled payment API error", error);
  return json({ error: "The secure payment service is temporarily unavailable." }, 500);
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "This payment request came from an untrusted origin.");
  }
}

export async function readJson(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Send this request as JSON.");
  }

  const body = await request.text();
  if (!body || body.length > 20_000) {
    throw new HttpError(400, "The payment request is empty or too large.");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "The payment request is not valid JSON.");
  }
}

export function requireEnvironment(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "Payment setup is incomplete. A clinic administrator must finish the secure server configuration.",
    );
  }
}
