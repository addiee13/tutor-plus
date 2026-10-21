"use client";

import { useEffect } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";
import "./motion.css";

/** Enhances existing server HTML; never hides content before hydration. */
export function LandingMotion() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("./motion-setup").then(({ gsap, ScrollTrigger }) => {
      const main = document.querySelector<HTMLElement>("main.landing");
      if (cancelled || !main) return;
      const media = gsap.matchMedia();
      media.add({ desktop: "(min-width: 768px)", mobile: "(max-width: 767px)" }, (match) => {
        const mobile = Boolean(match.conditions?.mobile);
        const context = gsap.context(() => {
          const entrance = gsap.timeline({ defaults: { duration: 0.5, ease: "power2.out" } });
          if (window.scrollY < 40) {
            entrance.from(
              ".hero-lede, .hero .hero-actions > a",
              {
                y: mobile ? 8 : 14,
                opacity: 0.65,
                stagger: 0.06,
                clearProps: "transform,opacity",
              },
              0.05,
            );
          }
          const groups = main.querySelectorAll<HTMLElement>(
            ".statement-inner, .split-panel, .peek .section-head, .peek-item, .now-next-grid > div, .closing-inner",
          );
          groups.forEach((group) => {
            // Do not conceal an anchor destination or content already in view.
            if (group.getBoundingClientRect().top < window.innerHeight) return;
            gsap.from(group.matches(".peek-item") ? group : group.children, {
              y: mobile ? 12 : 24,
              opacity: 0,
              duration: mobile ? 0.4 : 0.6,
              stagger: mobile ? 0.035 : 0.07,
              ease: "power2.out",
              clearProps: "transform,opacity",
              scrollTrigger: { trigger: group, start: "top 94%", once: true },
            });
          });
          // Tabbing to content completes its reveal immediately.
          const focus = (event: FocusEvent) => {
            if (!(event.target instanceof Element)) return;
            ScrollTrigger.getAll().forEach((trigger) => {
              if (trigger.vars.id !== "how-scroll-story" && trigger.trigger?.contains(event.target as Element))
                trigger.animation?.progress(1);
            });
          };
          main.addEventListener("focusin", focus);
          return () => main.removeEventListener("focusin", focus);
        }, main);
        return () => context.revert();
      });
      media.add("(min-width: 768px) and (min-height: 640px)", () => {
        const section = main.querySelector<HTMLElement>(".how");
        const steps = section?.querySelector<HTMLOListElement>(".how-steps");
        if (!section || !steps) return;
        const cards = Array.from(steps.querySelectorAll<HTMLElement>(":scope > li"));
        section.classList.add("is-scroll-story");
        const distance = () => (cards[0].getBoundingClientRect().width * 3 - steps.getBoundingClientRect().width) / 2;
        const context = gsap.context(() => {
          gsap.set(steps, { "--step-progress": 1 / 3 });
          const story = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              id: "how-scroll-story",
              trigger: section,
              start: "top top",
              end: "bottom bottom",
              scrub: true,
              invalidateOnRefresh: true,
            },
          });
          // Vertical scroll closes each sheet over the previous one, retaining numbered rails.
          story
            .to({}, { duration: 0.2 })
            .to(cards[1], { x: () => -distance(), duration: 1 })
            .to({}, { duration: 0.3 })
            .fromTo(cards[2], { x: () => -distance() }, { x: () => -2 * distance(), duration: 1 })
            .to({}, { duration: 0.3 })
            .fromTo(steps, { "--step-progress": 1 / 3 }, { "--step-progress": 1, duration: 2.8 }, 0);
          const focus = (event: FocusEvent) => {
            if (!(event.target instanceof Element)) return;
            const index = cards.findIndex((card) => card.contains(event.target as Element));
            const trigger = story.scrollTrigger;
            if (index < 0 || !trigger) return;
            // Native keyboard navigation can always bring a covered panel back into view.
            const progress = [0, 1.35 / 2.8, 1][index];
            window.scrollTo({ top: trigger.start + (trigger.end - trigger.start) * progress, behavior: "instant" });
            story.progress(progress);
          };
          section.addEventListener("focusin", focus);
          return () => section.removeEventListener("focusin", focus);
        }, section);
        return () => {
          context.revert();
          section.classList.remove("is-scroll-story");
        };
      });
      media.add("(min-width: 768px) and (hover: hover) and (pointer: fine)", () => {
        const context = gsap.context(() => {
          const buttons = document.querySelectorAll<HTMLElement>(
            ".site-header .button.primary, .landing .button.primary, .landing .button.light, .landing .button.dark",
          );
          const detach = Array.from(buttons, (button) => {
            const x = gsap.quickTo(button, "x", { duration: 0.35, ease: "power2.out" });
            const y = gsap.quickTo(button, "y", { duration: 0.35, ease: "power2.out" });
            const move = (event: PointerEvent) => {
              if (event.pointerType === "touch") return;
              const rect = button.getBoundingClientRect();
              x((event.clientX - rect.left - rect.width / 2) * 0.12);
              y((event.clientY - rect.top - rect.height / 2) * 0.15);
            };
            const reset = () => {
              x(0);
              y(0);
            };
            button.addEventListener("pointermove", move, { passive: true });
            button.addEventListener("pointerleave", reset);
            button.addEventListener("blur", reset);
            return () => {
              button.removeEventListener("pointermove", move);
              button.removeEventListener("pointerleave", reset);
              button.removeEventListener("blur", reset);
            };
          });
          return () => detach.forEach((remove) => remove());
        });
        return () => context.revert();
      });
      // Refresh once fonts settle; ignore late work after navigation/unmount.
      void document.fonts.ready.then(() => {
        if (!cancelled) ScrollTrigger.refresh();
      });
      cleanup = () => media.revert();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced]);
  return null;
}
