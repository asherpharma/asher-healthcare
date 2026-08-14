"use client";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Asher Healthcare | Please try again</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, background: "#f8fafc", color: "#233A59", fontFamily: "Arial, sans-serif" }}>
        <main style={{ display: "grid", minHeight: "100dvh", placeItems: "center", padding: 24 }}>
          <section
            role="alert"
            style={{
              width: "min(100%, 520px)",
              border: "1px solid #e2e8f0",
              borderRadius: 28,
              background: "white",
              padding: "32px 24px",
              textAlign: "center",
              boxShadow: "0 18px 50px rgba(35,58,89,0.08)",
            }}
          >
            <p style={{ margin: 0, color: "#A8864A", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Secure recovery
            </p>
            <h1 style={{ margin: "12px 0 0", fontSize: 28 }}>Asher Healthcare needs to reload.</h1>
            <p style={{ margin: "14px auto 0", maxWidth: 430, color: "#475569", fontSize: 15, lineHeight: 1.65 }}>
              No clinic action will be repeated automatically. Reload the page, then confirm the
              latest status before entering anything again.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                minHeight: 48,
                marginTop: 24,
                border: 0,
                borderRadius: 14,
                background: "#233A59",
                color: "white",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 700,
                padding: "0 24px",
              }}
            >
              Reload securely
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/")}
              style={{ display: "block", width: "100%", marginTop: 16, border: 0, background: "transparent", color: "#233A59", cursor: "pointer", fontSize: 14, fontWeight: 700 }}
            >
              Return to the website
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
