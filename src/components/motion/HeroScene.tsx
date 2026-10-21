"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";

export function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = host.current;
    if (!element || reduced) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    // Wait for a painted frame before even requesting the WebGL chunk.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void import("./hero-scene")
          .then(({ mountHeroScene }) => {
            if (!cancelled) dispose = mountHeroScene(element);
          })
          .catch(() => {
            // Decoration is optional; content is always server-rendered and visible.
          });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      dispose?.();
    };
  }, [reduced]);

  return <div ref={host} className="hero-scene" aria-hidden="true" />;
}
