# Landing motion review — October 21, 2026

Branch: `feature/landing-motion`, based on `main` at `2ad4454`. The implementation is in an isolated worktree at `/Users/addie/repos/TutorPlus-motion`; existing report/diagram edits in the original worktree are preserved. Integrated into local main at the user’s request; production deployment is not part of this change.

## Implementation

The homepage remains a Server Component. Its only markup changes are the decorative `HeroScene`, a `HeroHeadline` wrapper, a null-rendering `LandingMotion` controller, three `TiltCard` figures that preserve figure/caption semantics, and copy-grouping containers inside the three step list items. Marketing copy, section order, anchors, destinations and palette are unchanged. Sample illustration labels now narrate the requested session lifecycle. The desktop “How it works” presentation now uses the scroll accordion described below; static layouts retain the existing three-column/vertical arrangement.

- `HeroScene.tsx` imports the WebGL implementation after two animation frames. `hero-scene.ts` uses 14 translucent paper planes in one instanced draw call. DPR is capped at 2 on desktop and 1.5 below 768px. Intersection and document visibility events stop/resume RAF. Resize observation, context recovery, listeners and GPU resources are cleaned up.
- `LandingMotion.tsx` adds once-only section reveals, a scroll-driven step accordion with progress, and desktop magnetic buttons. The previous GSAP headline mask/opacity animation has been removed; `HeroHeadline` now owns the headline entrance through the requested Fancy component. Native scrolling is retained; Lenis is unnecessary.
- `TiltCard.tsx` adds restrained pointer tilt with elastic return. CSS adds glare, lift, shadow and underline sweeps. Captions remain stationary. Pointer effects are disabled on touch and below 768px; mobile reveals use smaller offsets and shorter durations.
- `useReducedMotion.ts` defaults to static during SSR/hydration and responds to live preference changes. Reduced motion removes the canvas and reverts GSAP contexts/media to static final states. Keyboard focus completes reveals before users interact.
- `motion-setup.ts` registers ScrollTrigger once. GSAP and Three.js live in dynamically loaded modules. `gsap`, `three`, development types, and the requested Fancy component’s `motion` dependency are added, pinned consistently with the existing package manifest.

The desktop progress line overlays the existing rule. The accordion deliberately reserves 260svh for its scroll sequence. The canvas is absolute, aspect-ratio constrained, and sized by the existing masthead, so the decoration cannot move content.

## Executed validation

- `npm run build`: passed with TypeScript compilation.
- `npm run check`: passed typecheck, ESLint, repository-wide Prettier check and 113 unit tests (6 files). Vitest emits an existing configuration-loader notice; it is unrelated to browser runtime.
- `git diff --check`: passed.
- Production server: `npm start -- --hostname 127.0.0.1 --port 3105`.
- Browser checks: `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3105 npx playwright test tests/e2e/landing-motion.spec.ts --config=tests/playwright.config.ts --project=desktop --workers=1`.

All seven browser tests passed. They cover 1440px, 768px and 375px widths; full-page scrolling; horizontal overflow; canvas DPR; product tilt; reduced-motion changes in both directions; static reduced-motion startup; JavaScript-disabled startup; anchors; signup navigation; and canvas teardown/recreation when leaving/returning. Rendered hero/product screenshots at all widths and the complete reduced-motion phone page were visually inspected. Screenshots are regenerated in ignored `test-results/landing-motion-*/` folders.

WebGL draw-call instrumentation confirms rendering stops offscreen and restarts when the hero returns. A separate test exercises visibility-change cleanup and resumption. Headless Chromium keeps tabs visible, so that test simulates `document.hidden` and dispatches the visibility event; actual operating-system background-tab behavior has not been manually verified.

No application console errors/warnings were found in the browser checks. Chromium's screenshot readback can emit the driver diagnostic `GPU stall due to ReadPixels`; the test excludes only that specific harness diagnostic and does not suppress application warnings.

## Fancy Vertical Cut Reveal headline

Executed `npx shadcn add @fancy/vertical-cut-reveal --yes` using the official [Fancy registry](https://fancycomponents.dev/r/vertical-cut-reveal.json). Added minimal `components.json` registry configuration; no Tailwind setup or global theme reset was introduced. The fetched component is in `src/components/fancy/text/vertical-cut-reveal.tsx`, with source attribution retained.

Adapted the component’s utility classes to scoped native CSS, replaced its state-driven animation start with Motion animation controls and cleanup, corrected word/newline splitting in the CLI output, and corrected hook dependencies. `HeroHeadline.tsx` applies slow, weighty word-staggered cuts to the three existing phrases while retaining the serif, terracotta italic, exact copy and natural wrapping. Each word now uses a 1.35-second tween with deliberate acceleration and a long deceleration, 100ms word staggering, and 240ms phrase spacing; the final word settles after about 2 seconds. Mask padding protects italic overhangs. The initial offset is 65%, keeping part of each word visible during the reveal; complete text is server-rendered before hydration. Reduced motion and JavaScript-disabled rendering retain the original static heading. The old GSAP headline entrance is removed so the two systems never animate the same text.

The browser suite checks the heading’s accessible name, verifies animated/static heading heights match at 1440px, 768px and 375px, and verifies the Fancy spans are removed under reduced motion. Other landing motion remains independent.

## Animated product illustrations

`ProductScenes.tsx` replaces the two static illustrations with small client components. The review retains the same four-star sample rating: four stars fill from left to right with a restrained spring settle, while the fifth remains unfilled. The quote and sample-review notice remain unchanged.

The workspace advances through Planning (Goals / Agenda), Ended (Session recap / Next steps), and Reflection (Private reflection / What I learned). The current chip, connecting line and drawn-in content bars follow each phase. The sequence lasts 4.8 seconds and settles on Reflection; it does not loop indefinitely. Both illustrations start in view, pause offscreen or when the document is hidden, and revert all GSAP state on unmount. Reduced motion and JavaScript-disabled rendering show complete static final frames. The existing tilt/glare effect remains independent.

A browser test confirms that the session stays at Planning while offscreen, advances to Ended then Reflection in view, fills exactly four stars, restores static bars/stars under reduced motion, and fits at 375px. Desktop Ended and mobile static Reflection screenshots were visually inspected. No new dependencies were added.

## General Dental reference inspection

Actually visited [General Dental](https://www.generaldental.ca/) in a browser and scrolled down through “Why Choose Us”, reversed direction, continued into later sections, and inspected its narrow-screen layout. At a 1440px viewport, the numbered section occupies 2442px for an 814px-high viewport. Its reading stage uses native `position: sticky` with a 44px offset. Panel two moves left first, then panel three moves left; earlier numbered edges remain visible. Reverse scrolling reverses these transforms. At a narrow width the panels form a vertical list.

Tutor Plus adapts that mechanic to its three existing “How it works” steps. Native sticky holds the heading and card stage in place. GSAP maps vertical scroll directly to two sequential horizontal panel movements, with reading pauses and numbered rails. It releases naturally at the end. The implementation adds only a copy-grouping `div` inside each existing `li`, preserving the ordered list, headings, text and signup link.

This mode requires at least 768px width and 640px height. Phones, short windows, reduced motion and no JavaScript retain static layouts. Live resizing and preference changes revert transforms and remove the sticky class. Keyboard focus on a covered link moves the corresponding panel back into view without trapping focus. Browser tests verify first/second/third panel positions, reversing, releasing to the next section, keyboard focus, resizing to 768px then 375px, and reduced-motion restoration. Screenshots `accordion-1.png`, `accordion-2.png` and `accordion-3.png` are regenerated in `test-results/landing-motion-*/`.

## Performance sample and limits

The new desktop accordion was sampled at 1440×1000 with 4× CPU slowdown while scrolling through the complete sequence over five seconds: 301 frames, average 16.67ms (~60 fps), p95 16.70ms, zero frame intervals above 33.4ms, and no horizontal overflow. The raw sample is in ignored `test-results/accordion-performance.json`. The final 768px active-panel screenshot and 375px static-step screenshot were also visually inspected.

Before the accordion follow-up, a local Chromium run at 375×844, device scale factor 3 and 4× CPU slowdown recorded 292 scroll frames over approximately five seconds: average 17.18ms (~58 fps), p95 16.70ms, one interval above 33.4ms, and CLS 0. Visible and resumed WebGL samples each recorded 72 draw calls per 600ms; the offscreen sample recorded zero. Local observed LCP was 564ms. The accordion is disabled at that phone width. These are development-machine samples, not production/network or physical-device measurements.

Physical mid-tier mobile 60fps, production Core Web Vitals, and actual background-tab behavior remain unverified. There is no heavy post-processing, autoplay media, scroll interception, or animation-controlled navigation.

Implementation follows the cleanup and media-query lifecycle documented by [GSAP](https://gsap.com/docs/v3/GSAP/gsap.matchMedia%28%29/) and renderer sizing/disposal documented by [Three.js](https://threejs.org/docs/pages/WebGLRenderer).
