"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";

/** Preserves the existing figure and caption semantics. No new tab stops. */
export function TiltCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element || reduced) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("./motion-setup").then(({ gsap }) => {
      if (cancelled) return;
      const media = gsap.matchMedia();
      media.add("(min-width: 768px) and (hover: hover) and (pointer: fine)", () => {
        const surface = element.querySelector<HTMLElement>(".vignette");
        if (!surface) return;
        const x = gsap.quickTo(surface, "rotationX", { duration: 0.65, ease: "elastic.out(1, 0.65)" });
        const y = gsap.quickTo(surface, "rotationY", { duration: 0.65, ease: "elastic.out(1, 0.65)" });
        const move = (event: PointerEvent) => {
          if (event.pointerType === "touch") return;
          const bounds = element.getBoundingClientRect();
          const px = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
          const py = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
          x((0.5 - py) * 5);
          y((px - 0.5) * 6);
          surface.style.setProperty("--glare-x", `${px * 100}%`);
          surface.style.setProperty("--glare-y", `${py * 100}%`);
        };
        const reset = () => {
          x(0);
          y(0);
        };
        element.addEventListener("pointermove", move, { passive: true });
        element.addEventListener("pointerleave", reset);
        return () => {
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerleave", reset);
          x.tween.kill();
          y.tween.kill();
          gsap.set(surface, { clearProps: "transform" });
          surface.style.removeProperty("--glare-x");
          surface.style.removeProperty("--glare-y");
        };
      });
      cleanup = () => media.revert();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced]);
  return (
    <figure ref={ref} className="peek-item motion-tilt">
      {children}
    </figure>
  );
}
