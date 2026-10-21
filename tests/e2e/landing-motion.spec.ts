import { test, expect } from "@playwright/test";

for (const width of [1440, 768, 375]) {
  test(`Landing motion: readable and contained at ${width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 768 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      // Chromium emits this driver diagnostic when the screenshot harness reads the canvas.
      if (message.text().includes("GPU stall due to ReadPixels")) return;
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    await page.goto(testInfo.project.use.baseURL || "http://localhost:3000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Great learning starts with the right support.",
    );
    await expect(page.locator(".hero-scene canvas")).toHaveCount(1);
    await page.waitForTimeout(900);
    await expect(page.locator(".hero-cut")).toHaveCount(3);
    const headlineHeight = await page.locator("h1").evaluate((heading) => heading.getBoundingClientRect().height);
    await page.screenshot({ path: testInfo.outputPath(`hero-${width}.png`) });
    const canvas = page.locator(".hero-scene canvas");
    const ratio = await canvas.evaluate((node: HTMLCanvasElement) => node.width / node.getBoundingClientRect().width);
    expect(ratio).toBeLessThanOrEqual(width < 768 ? 1.5 : 2);
    for (const section of await page.locator(".landing > section").all()) {
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1600);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.locator(".how-steps")).toHaveCSS("--step-progress", "1");
    await page.locator(".peek").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await page.screenshot({ path: testInfo.outputPath(`product-${width}.png`) });
    if (width >= 768) {
      const figure = page.locator(".peek-item").first();
      const bounds = await figure.boundingBox();
      if (!bounds) throw new Error("Missing product illustration");
      await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + 40);
      await page.waitForTimeout(350);
      await expect(figure.locator(".vignette")).not.toHaveCSS("transform", "none");
      await page.mouse.move(0, 0);
      await page.waitForTimeout(1000);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(canvas).toHaveCount(0);
    await expect(page.locator(".hero-cut")).toHaveCount(0);
    expect(await page.locator("h1").evaluate((heading) => heading.getBoundingClientRect().height)).toBeCloseTo(
      headlineHeight,
      0,
    );
    const hidden = await page.locator(".landing").evaluate((main) =>
      Array.from(main.querySelectorAll("h1, h2, p, li, figcaption, a"))
        .filter((element) => {
          const style = getComputedStyle(element);
          return Number(style.opacity) < 1 || style.visibility === "hidden";
        })
        .map((element) => element.textContent),
    );
    expect(hidden).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`static-${width}.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(canvas).toHaveCount(1);
    await page.getByRole("link", { name: "How it works", exact: true }).last().click();
    await expect(page).toHaveURL(/#how-it-works$/);
    await page.waitForTimeout(1500);
    await expect(page.locator("#how-heading")).toHaveCSS("opacity", "1");
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.locator(".hero-scene canvas")).toHaveCount(0);
    await page.goBack();
    await expect(page.locator(".hero-scene canvas")).toHaveCount(1);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Landing motion: reduced motion and no-JS start fully readable", async ({ browser }, testInfo) => {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      javaScriptEnabled,
      viewport: { width: 375, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(testInfo.project.use.baseURL || "http://localhost:3000");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".hero-scene canvas")).toHaveCount(0);
    await expect(page.locator(".how-steps")).toHaveCSS("--step-progress", "1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const hidden = await page
      .locator(".landing")
      .evaluate((main) =>
        Array.from(main.querySelectorAll("*")).filter((element) => Number(getComputedStyle(element).opacity) === 0),
      );
    expect(hidden).toEqual([]);
    await context.close();
  }
});

test("Landing motion: WebGL pauses offscreen and on visibility changes", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL || "http://localhost:3000");
  await expect(page.locator(".hero-scene canvas")).toHaveCount(1);
  const draws = await page.evaluate(async () => {
    const prototype = WebGL2RenderingContext.prototype;
    const original = prototype.drawElementsInstanced;
    let count = 0;
    prototype.drawElementsInstanced = function (...args) {
      count++;
      return original.apply(this, args);
    };
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const sample = async () => {
      const before = count;
      await wait(400);
      return count - before;
    };
    try {
      const visible = await sample();
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
      await wait(300);
      const offscreen = await sample();
      window.scrollTo({ top: 0, behavior: "instant" });
      await wait(300);
      const resumed = await sample();
      // Headless tabs remain visible; exercise the real visibility handler with a simulated event.
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      const hidden = await sample();
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await wait(300);
      const foreground = await sample();
      return { visible, offscreen, resumed, hidden, foreground };
    } finally {
      prototype.drawElementsInstanced = original;
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  expect(draws.visible).toBeGreaterThan(0);
  expect(draws.offscreen).toBe(0);
  expect(draws.resumed).toBeGreaterThan(0);
  expect(draws.hidden).toBe(0);
  expect(draws.foreground).toBeGreaterThan(0);
  await context.close();
});

test("Landing motion: scroll accordion advances, reverses, releases, and restores static layouts", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL || "http://localhost:3000");
  const story = page.locator(".how");
  await expect(story).toHaveClass(/is-scroll-story/);
  await page.evaluate(() => document.fonts.ready);
  const seek = async (progress: number) => {
    await story.evaluate((section, fraction) => {
      const top = section.getBoundingClientRect().top + scrollY;
      window.scrollTo({
        top: top + (section.getBoundingClientRect().height - innerHeight) * fraction,
        behavior: "instant",
      });
    }, progress);
    await page.waitForTimeout(180);
    return story.evaluate((section) => ({
      stageTop: section.querySelector(".container")!.getBoundingClientRect().top,
      cards: Array.from(section.querySelectorAll(".how-steps > li"), (card) => card.getBoundingClientRect().left),
      progress: Number(getComputedStyle(section.querySelector(".how-steps")!).getPropertyValue("--step-progress")),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
  };
  const first = await seek(0);
  expect(first.cards[1] - first.cards[0]).toBeGreaterThan(900);
  expect(first.progress).toBeCloseTo(1 / 3, 1);
  await page.screenshot({ path: testInfo.outputPath("accordion-1.png") });
  const second = await seek(0.48);
  expect(second.stageTop).toBeCloseTo(24, 0);
  expect(second.cards[1] - second.cards[0]).toBeCloseTo(96, 0);
  expect(second.cards[2] - second.cards[1]).toBeGreaterThan(900);
  await page.screenshot({ path: testInfo.outputPath("accordion-2.png") });
  const third = await seek(0.95);
  expect(third.cards[2] - third.cards[0]).toBeCloseTo(192, 0);
  expect(third.progress).toBeGreaterThan(0.95);
  expect(third.overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("accordion-3.png") });
  const reversed = await seek(0.48);
  expect(reversed.cards[2]).toBeGreaterThan(third.cards[2] + 800);
  // A keyboard focus destination in a covered sheet must be brought back into view.
  await seek(0.95);
  await story.getByRole("link", { name: "Create an account" }).focus();
  await page.waitForTimeout(150);
  const focused = await story.locator(".text-link").boundingBox();
  expect(focused?.x).toBeGreaterThan(0);
  expect(focused!.x + focused!.width).toBeLessThan(1000);
  await page.locator("#students").evaluate((panel) => panel.scrollIntoView({ block: "start", behavior: "instant" }));
  expect(
    await story.locator(".container").evaluate((stage) => stage.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(10);
  await page.setViewportSize({ width: 768, height: 1000 });
  const resized = await seek(0.95);
  expect(resized.cards[2] - resized.cards[0]).toBeCloseTo(128, 0);
  expect(resized.overflow).toBe(false);
  await page.setViewportSize({ width: 375, height: 844 });
  await expect(story).not.toHaveClass(/is-scroll-story/);
  await expect(story.locator(".container")).not.toHaveCSS("position", "sticky");
  const positions = await story
    .locator(".how-steps > li")
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));
  expect(positions[1]).toBeGreaterThan(positions[0]);
  expect(positions[2]).toBeGreaterThan(positions[1]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(story).toHaveClass(/is-scroll-story/);
  await seek(0.48);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(story).not.toHaveClass(/is-scroll-story/);
  await expect(story.locator(".container")).not.toHaveCSS("position", "sticky");
  for (const card of await story.locator(".how-steps > li").all()) await expect(card).toHaveCSS("transform", "none");
  await context.close();
});

test("Landing motion: sample stars fill and session advances to reflection", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL || "http://localhost:3000");
  const session = page.locator(".session-preview");
  await expect(session).toHaveAttribute("data-phase", "Planning");
  await page.waitForTimeout(1800);
  // Offscreen illustrations must not run through their story before they can be seen.
  await expect(session).toHaveAttribute("data-phase", "Planning");
  await page.locator(".peek-grid").scrollIntoViewIfNeeded();
  await expect(session).toHaveAttribute("data-phase", "Ended");
  await expect(session.locator(".vignette-block").first()).toContainText("Session recap");
  await page.screenshot({ path: testInfo.outputPath("session-ended.png") });
  await expect(session).toHaveAttribute("data-phase", "Reflection");
  await expect(session.locator(".vignette-block").first()).toContainText("Private reflection");
  const fills = page.locator(".review-star-fill");
  await expect(fills).toHaveCount(4);
  for (const fill of await fills.all()) await expect(fill).toHaveCSS("clip-path", "inset(0px 0% 0px 0px)");
  await expect(page.locator(".review-star")).toHaveCount(5);
  await page.waitForTimeout(1600);
  const before = await session.boundingBox();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(session).toHaveAttribute("data-phase", "Reflection");
  await expect(session.locator(".bar").first()).toHaveCSS("transform", "none");
  for (const fill of await fills.all()) await expect(fill).toHaveCSS("clip-path", "none");
  expect((await session.boundingBox())?.height).toBeCloseTo(before!.height, 0);
  await page.setViewportSize({ width: 375, height: 844 });
  await session.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("session-static-375.png") });
  await context.close();
});
