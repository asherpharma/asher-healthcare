"use client";

import { useEffect, useRef, useState } from "react";
import { getHomepageConsent, installHomepageGtm, setHomepageConsent } from "@/lib/homepage-gtm.mjs";

type ConsentSnapshot = { eligible: boolean; choice: "accepted" | "declined" | null };

export default function HomepageGtm() {
  const [consent, setConsent] = useState<ConsentSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const choicesButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const refresh = () => setConsent(getHomepageConsent(window, navigator));
    window.addEventListener("asher:measurement-consent", refresh);
    // The parser bootstrap and this client component share the same consent
    // runtime. Reading a saved preference never implies a new acceptance.
    installHomepageGtm(window, document, navigator);
    refresh();
    return () => window.removeEventListener("asher:measurement-consent", refresh);
  }, []);

  if (!consent?.eligible) return null;

  const choose = (choice: "accepted" | "declined") => {
    setHomepageConsent(window, document, navigator, choice);
    setConsent(getHomepageConsent(window, navigator));
    setEditing(false);
    if (editing) choicesButton.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <div className="homepage-cookie-choices">
        <div className="site-shell homepage-cookie-choices-inner">
          <button ref={choicesButton} type="button" onClick={() => setEditing(true)} aria-expanded={editing || consent.choice === null} aria-controls={editing || consent.choice === null ? "homepage-measurement-choices" : undefined}>
            Cookie choices
          </button>
          <span role="status">Optional measurement {consent.choice === "accepted" ? "on" : "off"}</span>
          {consent.choice === "accepted" && (
            <button type="button" onClick={() => choose("declined")}>Withdraw measurement</button>
          )}
        </div>
      </div>
      {(editing || consent.choice === null) && (
        <section id="homepage-measurement-choices" className="homepage-consent-bar" aria-labelledby="homepage-consent-heading" aria-describedby="homepage-consent-description">
          <div className="homepage-consent-copy">
            <h2 id="homepage-consent-heading">Optional measurement cookies</h2>
            <p id="homepage-consent-description">
              Allow Google Ads cookies to see which ads lead to homepage Call-button taps, not completed calls. No personalised ads. Calling and booking work either way. <a href="/privacy">Privacy details</a>
            </p>
          </div>
          <div className="homepage-consent-actions">
            <button type="button" onClick={() => choose("accepted")}>Accept measurement</button>
            <button type="button" onClick={() => choose("declined")}>Decline</button>
          </div>
          {consent.choice !== null && (
            <button className="homepage-consent-close" type="button" onClick={() => { setEditing(false); choicesButton.current?.focus({ preventScroll: true }); }} aria-label="Close cookie choices without changing your preference">
              Close
            </button>
          )}
        </section>
      )}
    </>
  );
}
