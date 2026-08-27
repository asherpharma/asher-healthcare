"use client";

import { useEffect } from "react";

const REVEAL_SELECTOR = [
  ".specialty-strip > *",
  ".section-heading",
  ".service-card",
  ".public-care-tabs",
  ".public-care-panel",
  ".public-care-support",
  ".why-visual",
  ".why-copy > .section-kicker",
  ".why-copy > h2",
  ".why-copy > .section-intro",
  ".reason-item",
  ".doctor-card",
  ".public-journey-intro > *",
  ".public-journey-steps li",
  ".gallery-grid > *",
  ".appointment-copy > *",
  ".booking-card",
  ".faq-layout > *",
  ".contact-grid > *",
].join(",");

const TILT_SELECTOR = "[data-premium-tilt]";

type TiltElement = HTMLElement & {
  dataset: HTMLElement["dataset"] & { premiumTilt?: string };
};

export default function PremiumMotion() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return;

    const root = document.documentElement;
    const revealTargets = Array.from(
      document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR),
    );

    revealTargets.forEach((element, index) => {
      element.classList.add("motion-reveal");
      element.style.setProperty("--reveal-delay", `${(index % 4) * 70}ms`);
    });
    root.classList.add("motion-enhanced");

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    revealTargets.forEach((element) => revealObserver.observe(element));

    const canTilt = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const tiltTargets = canTilt
      ? Array.from(document.querySelectorAll<TiltElement>(TILT_SELECTOR))
      : [];
    const cleanups: Array<() => void> = [];

    tiltTargets.forEach((element) => {
      let frame = 0;

      const reset = () => {
        if (frame) window.cancelAnimationFrame(frame);
        element.style.setProperty("--tilt-rx", "0deg");
        element.style.setProperty("--tilt-ry", "0deg");
        element.style.setProperty("--parallax-x", "0px");
        element.style.setProperty("--parallax-y", "0px");
        element.style.setProperty("--glow-x", "50%");
        element.style.setProperty("--glow-y", "50%");
        element.removeAttribute("data-tilt-active");
      };

      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        const bounds = element.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
        const strength = Number(element.dataset.premiumTilt || 4);

        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          element.style.setProperty("--tilt-rx", `${(0.5 - y) * strength}deg`);
          element.style.setProperty("--tilt-ry", `${(x - 0.5) * strength}deg`);
          element.style.setProperty("--parallax-x", `${(0.5 - x) * 10}px`);
          element.style.setProperty("--parallax-y", `${(0.5 - y) * 8}px`);
          element.style.setProperty("--glow-x", `${x * 100}%`);
          element.style.setProperty("--glow-y", `${y * 100}%`);
          element.setAttribute("data-tilt-active", "true");
        });
      };

      element.addEventListener("pointermove", onPointerMove, { passive: true });
      element.addEventListener("pointerleave", reset);
      element.addEventListener("pointercancel", reset);
      cleanups.push(() => {
        if (frame) window.cancelAnimationFrame(frame);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerleave", reset);
        element.removeEventListener("pointercancel", reset);
        reset();
      });
    });

    return () => {
      revealObserver.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      revealTargets.forEach((element) => {
        element.classList.remove("motion-reveal", "is-visible");
        element.style.removeProperty("--reveal-delay");
      });
      root.classList.remove("motion-enhanced");
    };
  }, []);

  return null;
}
