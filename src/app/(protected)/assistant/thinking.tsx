"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import styles from "./thinking.module.css";

/**
 * Text shimmer adapted from Motion Primitives by ibelick (MIT).
 * https://github.com/ibelick/motion-primitives/blob/main/components/core/text-shimmer.tsx
 * Copyright (c) 2024 ibelick. See licenses/motion-primitives.txt.
 */
function ThinkingText({ children }: { children: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      className={styles.shimmer}
      initial={{ backgroundPosition: "100% center" }}
      animate={reducedMotion ? undefined : { backgroundPosition: "0% center" }}
      transition={{ repeat: Infinity, duration: 3.2, ease: "linear" }}
    >
      {children}
    </motion.span>
  );
}

/** Mounted only while an AI Server Action is pending. */
export function AssistantThinking({
  heading = "Thinking it through",
  description = "Working on a clear explanation using the context you chose.",
  reassurance = "This can take about a minute. Your question is still here.",
}: {
  heading?: string;
  description?: string;
  reassurance?: string;
} = {}) {
  const [longWait, setLongWait] = useState(false);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setLongWait(true), 15_000);
    const frame = window.requestAnimationFrame(() => {
      if (!card.current) return;
      const bounds = card.current.getBoundingClientRect();
      if (bounds.bottom > window.innerHeight - 24 || bounds.top < 0) {
        card.current.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
      }
    });
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={card} className={styles.card} role="status" aria-live="polite" aria-atomic="true">
      <div className={styles.mark} aria-hidden="true">
        <span className={styles.orbit} />
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <path
            d="M13 4.5c.8 5.1 3.4 7.7 8.5 8.5-5.1.8-7.7 3.4-8.5 8.5-.8-5.1-3.4-7.7-8.5-8.5 5.1-.8 7.7-3.4 8.5-8.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className={styles.content}>
        <h3 className={styles.heading}>
          <span className="visually-hidden">{heading}</span>
          <ThinkingText>{heading}</ThinkingText>
        </h3>
        <p className={styles.description}>{description}</p>
        {longWait && <p className={styles.reassurance}>{reassurance}</p>}
      </div>
    </section>
  );
}
