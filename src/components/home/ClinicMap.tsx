"use client";

import { MapPin, Navigation } from "lucide-react";
import { useState } from "react";

export default function ClinicMap() {
  const [showMap, setShowMap] = useState(false);
  return (
    <div className={`map-card ${showMap ? "map-is-visible" : "map-is-ready"}`}>
      {showMap ? (
        <iframe title="Asher Women and Child Healthcare location" src="https://www.google.com/maps?q=Asher%20Women%20and%20Child%20Healthcare%20RK%20Hegde%20Nagar%20Bengaluru&output=embed" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="patient-map-intro">
          <span className="patient-map-pin"><MapPin aria-hidden="true" /></span>
          <span className="section-kicker">Your neighbourhood clinic</span>
          <h3>Find us in<br /><em>RK Hegde Nagar.</em></h3>
          <p>Ground Floor, 546<br />Thanisandra Main Road, Bengaluru</p>
          <button type="button" onClick={() => setShowMap(true)}>Show interactive map</button>
          <small>Google Maps loads only when you choose to show it.</small>
        </div>
      )}
      <a className="map-button" href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer"><Navigation aria-hidden="true" /> Open directions</a>
    </div>
  );
}
