"use client";

import VerticalCutReveal from "@/components/fancy/text/vertical-cut-reveal";
import { useReducedMotion } from "@/lib/useReducedMotion";

/** SSR is complete static text; the partial cut never blanks an entire word for LCP. */
export function HeroHeadline() {
  const reduced = useReducedMotion();
  const reveal = (text: string, delay: number) =>
    reduced ? (
      text
    ) : (
      <VerticalCutReveal
        splitBy="words"
        initialOffset="65%"
        staggerDuration={0.1}
        staggerFrom="first"
        transition={{ type: "tween", duration: 1.35, ease: [0.45, 0, 0.16, 1], delay }}
        containerClassName="hero-cut"
      >
        {text}
      </VerticalCutReveal>
    );
  return (
    <h1 id="hero-heading">
      <span>{reveal("Great learning", 0)}</span> <span>{reveal("starts with", 0.24)}</span>{" "}
      <em>{reveal("the right support.", 0.48)}</em>
    </h1>
  );
}
