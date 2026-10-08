"use client";

import Image from "next/image";
import { Camera, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const photos = [
  {
    src: "/images/gallery-newborn-care-v1.webp",
    alt: "A doctor in navy scrubs holding a wrapped newborn in a hospital room",
    title: "Little beginnings",
    caption: "A moment from our doctor's care journey, shared with the family's permission.",
  },
  {
    src: "/images/gallery-family-care-private-v1.webp",
    alt: "A doctor holding a newborn beside an adult whose face is obscured for privacy",
    title: "Care, with a personal touch",
    caption: "Shared with permission. The adult patient's face and wristband details have been obscured for privacy.",
  },
  {
    src: "/images/dr-shafi-ahamad.jpg",
    alt: "Dr. Lt Col Shafi Ahamad wearing a white coat and stethoscope",
    title: "Dr. Lt Col Shafi Ahamad",
    caption: "Consultant Pediatrician · Pediatric Allergy & Asthma Specialist",
  },
  {
    src: "/images/dr-shaik-reshma.jpg",
    alt: "Dr. Shaik Reshma wearing a white coat",
    title: "Dr. Shaik Reshma",
    caption: "Consultant Obstetrician & Gynaecologist · Laparoscopic Surgeon",
  },
];

const SLIDE_INTERVAL_MS = 6_000;

function subscribeToEnvironment(onChange: () => void) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    motion.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function getEnvironmentSnapshot() {
  return (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0)
    | (document.hidden ? 2 : 0);
}

export default function Gallery() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const currentIndex = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // The server starts paused; browser preferences are checked before rotation begins.
  const environment = useSyncExternalStore(subscribeToEnvironment, getEnvironmentSnapshot, () => 3);
  const reducedMotion = Boolean(environment & 1);

  const goToSlide = useCallback((requestedIndex: number, manual = false) => {
    const nextIndex = (requestedIndex + photos.length) % photos.length;
    const track = trackRef.current;
    if (!track) return;
    currentIndex.current = nextIndex;
    setActiveIndex(nextIndex);
    track.scrollTo({ left: track.clientWidth * nextIndex, behavior: reducedMotion ? "instant" : "smooth" });
    if (manual) {
      setUserPaused(true);
      setAnnouncement(`Photo ${nextIndex + 1} of ${photos.length}: ${photos[nextIndex].title}`);
    }
  }, [reducedMotion]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.2), { threshold: 0.2 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (userPaused || hovered || focused || !inView || environment !== 0) return;
    const timer = window.setInterval(() => goToSlide(currentIndex.current + 1), SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [environment, focused, goToSlide, hovered, inView, userPaused]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(() => {
      track.scrollTo({ left: track.clientWidth * currentIndex.current, behavior: "instant" });
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  function syncPosition() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.max(0, Math.min(photos.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
    currentIndex.current = index;
    setActiveIndex(index);
  }

  return (
    <section id="moments-of-care" className="section patient-gallery-section" ref={sectionRef} aria-labelledby="patient-gallery-heading">
      <div className="site-shell patient-gallery-layout">
        <div className="patient-gallery-copy">
          <span className="section-kicker"><Camera size={16} aria-hidden="true" /> Moments of care</span>
          <h2 id="patient-gallery-heading">A closer look at<br /><em>the people who care.</em></h2>
          <p>A few real moments and familiar faces from our doctors&apos; care journey.</p>
          <p className="patient-gallery-context">Care-setting photos may be taken at other facilities. They do not show Asher&apos;s clinic premises.</p>
        </div>
        <div
          className="patient-gallery-carousel"
          role="region"
          aria-roledescription="carousel"
          aria-label="Moments of care photo gallery"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
        >
          <div className="patient-gallery-controls">
            <span className="patient-gallery-count" aria-hidden="true">{String(activeIndex + 1).padStart(2, "0")} / {String(photos.length).padStart(2, "0")}</span>
            <button
              type="button"
              className="patient-gallery-play"
              aria-controls="patient-gallery-track"
              aria-label={reducedMotion ? "Slideshow paused for reduced motion" : userPaused ? "Play slideshow" : "Pause slideshow"}
              disabled={reducedMotion}
              onClick={() => setUserPaused((paused) => !paused)}
            >
              {userPaused || reducedMotion ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
              {reducedMotion ? "Motion paused" : userPaused ? "Play" : "Pause"}
            </button>
            <button type="button" className="patient-gallery-arrow" aria-label="Previous photo" aria-controls="patient-gallery-track" onClick={() => goToSlide(currentIndex.current - 1, true)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <button type="button" className="patient-gallery-arrow" aria-label="Next photo" aria-controls="patient-gallery-track" onClick={() => goToSlide(currentIndex.current + 1, true)}><ChevronRight size={20} aria-hidden="true" /></button>
          </div>
          <div
            id="patient-gallery-track"
            className="patient-gallery-track"
            ref={trackRef}
            tabIndex={0}
            aria-label="Photos. Swipe left or right, or use the previous and next buttons."
            onScroll={syncPosition}
            onPointerDown={() => setUserPaused(true)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              goToSlide(currentIndex.current + (event.key === "ArrowRight" ? 1 : -1), true);
            }}
          >
            {photos.map((photo, index) => (
              <figure key={photo.src} className="patient-gallery-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${photos.length}: ${photo.title}`}>
                <div className="patient-gallery-image">
                  <Image src={photo.src} alt={photo.alt} fill sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 800px) calc(100vw - 64px), 560px" loading="lazy" decoding="async" />
                </div>
                <figcaption><h3>{photo.title}</h3><p>{photo.caption}</p></figcaption>
              </figure>
            ))}
          </div>
          <div className="patient-gallery-bottom">
            <div className="patient-gallery-dots" aria-label="Choose a photo">
              {photos.map((photo, index) => (
                <button key={photo.src} type="button" aria-label={`Show photo ${index + 1}: ${photo.title}`} aria-current={activeIndex === index ? "true" : undefined} aria-controls="patient-gallery-track" onClick={() => goToSlide(index, true)}><span /></button>
              ))}
            </div>
            <span className="patient-gallery-hint">Swipe or use the arrows</span>
          </div>
          <span className="patient-gallery-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
        </div>
      </div>
    </section>
  );
}
