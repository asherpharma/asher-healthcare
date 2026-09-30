import { CalendarDays, MapPin, Phone } from "lucide-react";

export default function MobileCareBar() {
  return (
    <nav className="public-mobile-actions" aria-label="Quick clinic actions">
      <a href="tel:+919019263709"><Phone aria-hidden="true" /><span>Call</span></a>
      <a href="https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5" target="_blank" rel="noreferrer">
        <MapPin aria-hidden="true" /><span>Directions</span>
      </a>
      <a className="public-mobile-book" href="#appointment">
        <CalendarDays aria-hidden="true" /><span>Book a slot</span>
      </a>
    </nav>
  );
}
