"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";

const PHASES = [
  { name: "Planning", blocks: ["Goals", "Agenda"] },
  { name: "Ended", blocks: ["Session recap", "Next steps"] },
  { name: "Reflection", blocks: ["Private reflection", "What I learned"] },
] as const;

/** Short, finite illustrations: play in view, pause when hidden, leave a complete final frame. */
function usePreviewMotion(ref: RefObject<HTMLDivElement | null>, reduced: boolean, onPhase?: (phase: number) => void) {
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("./motion-setup").then(({ gsap }) => {
      if (cancelled) return;
      let visible = false;
      const context = gsap.context(() => {
        const timeline = gsap.timeline({ paused: true });
        if (onPhase) {
          const blocks = root.querySelectorAll(".vignette-block");
          const bars = root.querySelectorAll(".bar");
          const connectors = root.querySelectorAll(".preview-connector-fill");
          for (let phase = 0; phase < 3; phase++) {
            const start = phase * 1.6;
            timeline
              .call(() => onPhase(phase), [], start)
              .fromTo(
                blocks,
                { y: 7, opacity: 0.55 },
                { y: 0, opacity: 1, duration: 0.35, stagger: 0.06, ease: "power2.out" },
                start,
              )
              .fromTo(
                bars,
                { scaleX: 0.08 },
                { scaleX: 1, duration: 0.65, stagger: 0.09, ease: "power2.out" },
                start + 0.12,
              );
            if (phase > 0)
              timeline.to(connectors[phase - 1], { scaleX: 1, duration: 0.4, ease: "power2.inOut" }, start);
          }
          gsap.set(connectors, { scaleX: 0 });
          timeline.to({}, { duration: 0.8 }, 4);
        } else {
          const fills = root.querySelectorAll(".review-star-fill");
          const stars = root.querySelectorAll(".review-star:not(:last-child)");
          timeline
            .fromTo(
              fills,
              { clipPath: "inset(0 100% 0 0)" },
              {
                clipPath: "inset(0 0% 0 0)",
                duration: 0.45,
                stagger: 0.22,
                ease: "power2.inOut",
              },
            )
            .fromTo(
              stars,
              { scale: 0.9, rotation: -6 },
              {
                scale: 1,
                rotation: 0,
                duration: 0.45,
                stagger: 0.22,
                ease: "back.out(1.8)",
              },
              0,
            );
        }
        const sync = () => {
          if (visible && !document.hidden) timeline.play();
          else timeline.pause();
        };
        const observer = new IntersectionObserver(
          ([entry]) => {
            visible = entry.isIntersecting;
            sync();
          },
          { threshold: 0.5 },
        );
        observer.observe(root);
        document.addEventListener("visibilitychange", sync);
        return () => {
          observer.disconnect();
          document.removeEventListener("visibilitychange", sync);
        };
      }, root);
      cleanup = () => context.revert();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [ref, reduced, onPhase]);
}

export function SessionWorkspaceScene() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0);
  usePreviewMotion(ref, reduced, setPhase);
  const current = reduced ? 2 : phase;
  return (
    <div ref={ref} className="vignette session-preview" aria-hidden="true" data-phase={PHASES[current].name}>
      <div className="vignette-stepper">
        {PHASES.map(({ name }, index) => (
          <PhaseChip key={name} name={name} index={index} current={current} />
        ))}
      </div>
      {PHASES[current].blocks.map((label, index) => (
        <div className="vignette-block" key={index}>
          <small>{label}</small>
          <span className="bar" />
          <span className={`bar ${index ? "shorter" : "short"}`} />
        </div>
      ))}
    </div>
  );
}

function PhaseChip({ name, index, current }: { name: string; index: number; current: number }) {
  return (
    <>
      {index > 0 && (
        <i className="preview-connector">
          <i className="preview-connector-fill" />
        </i>
      )}
      <span className={index === current ? "is-current" : index < current ? "is-done" : undefined}>{name}</span>
    </>
  );
}

export function ReviewScene() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  usePreviewMotion(ref, reduced);
  return (
    <div ref={ref} className="vignette review-preview" aria-hidden="true">
      <div className="vignette-stars review-stars">
        {Array.from({ length: 5 }, (_, index) => (
          <span className="review-star" key={index}>
            ★{index < 4 && <span className="review-star-fill">★</span>}
          </span>
        ))}
      </div>
      <p className="vignette-quote">“Clear steps and a recap I actually reread.”</p>
      <span className="vignette-note">Sample review · completed session</span>
    </div>
  );
}
