import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      tutorEmail: string;
      adminEmail: string;
      confirmedBookingId: string;
      completedBookingId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
async function login(page: Page, role: "student" | "tutor" | "admin") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(f![`${role}Email`]);
  await page.getByLabel("Password", { exact: true }).fill(f!.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
test.describe("Independent Q0.1 rendered quality", () => {
  test.skip(!f, "Requires explicit local real-service fixtures.");
  test.setTimeout(240000);
  test("module pages retain names, keyboard focus, mobile targets and reduced-motion content", async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const observations = [];
    const routes: Array<["student" | "tutor" | "admin", string]> = [
      ["student", "/dashboard"],
      ["student", "/saved-tutors"],
      ["student", "/profile"],
      ["student", "/bookings"],
      ["student", `/sessions/${f!.confirmedBookingId}`],
      ["student", `/sessions/${f!.completedBookingId}`],
      ["student", "/reviews"],
      ["student", "/assessments"],
      ["student", "/assignments"],
      ["student", "/study-plans"],
      ["student", "/progress"],
      ["student", "/notifications"],
      ["student", "/resources"],
      ["student", "/assistant"],
      ["student", "/support"],
      ["student", "/matching"],
      ["student", "/tutors"],
      ["tutor", "/tutor-studio"],
      ["admin", "/admin/accounts"],
      ["admin", "/admin/safety"],
      ["admin", "/admin/templates"],
      ["admin", "/admin/matching"],
      ["admin", "/admin/assessment-templates"],
      ["admin", "/admin/badges"],
      ["admin", "/admin/operations"],
    ];
    let current = "";
    for (const [role, path] of routes) {
      if (role !== current) {
        await login(page, role);
        current = role;
      }
      await page.goto(path);
      const heading = page.getByRole("heading", { level: 1 }).filter({ hasNotText: /Opening your space|Loading/ });
      await expect(heading).toBeVisible();
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
      const audit = await page.evaluate(() => {
        const visible = (element: Element) => {
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (
              ancestor instanceof HTMLDetailsElement &&
              !ancestor.open &&
              !ancestor.querySelector(":scope > summary")?.contains(element)
            )
              return false;
          }
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            'input:not([type="hidden"]),select,textarea,button,a[href],summary',
          ),
        ].filter(visible);
        const unnamed = controls
          .filter((element) => {
            const labelled = (element.getAttribute("aria-labelledby") || "")
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent || "")
              .join(" ");
            const labels =
              "labels" in element
                ? [...((element as HTMLInputElement).labels || [])].map((label) => label.textContent).join(" ")
                : "";
            const text =
              element.getAttribute("aria-label") ||
              labelled ||
              labels ||
              element.innerText ||
              element.textContent ||
              element.getAttribute("title") ||
              element.querySelector("img")?.getAttribute("alt") ||
              "";
            return !text.trim();
          })
          .map(
            (element) =>
              `${element.tagName}:${element.getAttribute("name") || element.getAttribute("href") || "unnamed"}`,
          );
        const smallTargets = controls
          .filter((element) => {
            if (
              element.tagName.toUpperCase() === "A" &&
              !element.classList.contains("button") &&
              !element.classList.contains("social-button")
            )
              return false; // Inline text links have a separate WCAG target exception.
            if ((element as HTMLInputElement).disabled) return false;
            let box = element.getBoundingClientRect();
            if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type))
              box = element.labels?.[0]?.getBoundingClientRect() || box;
            return box.width < 24 || box.height < 24;
          })
          .map(
            (element) =>
              `${element.tagName}:${element.getAttribute("name") || (element.innerText || element.textContent || "").slice(0, 40)}`,
          );
        return {
          heading: [...document.querySelectorAll("h1")].find(visible)?.textContent,
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          unnamed,
          smallTargets,
          controlCount: controls.length,
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        };
      });
      expect(audit.unnamed, `${path}: accessible control names`).toEqual([]);
      expect(audit.smallTargets, `${path}: non-inline controls meet 24px minimum target`).toEqual([]);
      expect(audit.scrollWidth, `${path}: horizontal containment`).toBeLessThanOrEqual(audit.width);
      expect(audit.reducedMotion).toBe(true);
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const style = getComputedStyle(active);
        return {
          tag: active.tagName,
          outline: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
          boxShadow: style.boxShadow,
          visible: active.getBoundingClientRect().width > 0,
        };
      });
      expect(focus.tag).not.toBe("BODY");
      expect(focus.visible).toBe(true);
      expect(
        (focus.outline !== "none" && focus.outlineWidth > 0) || focus.boxShadow !== "none",
        `${path}: visible keyboard focus`,
      ).toBe(true);
      observations.push({ role, path, ...audit, focus });
      if (["/profile", "/notifications", "/admin/matching"].includes(path))
        await page.screenshot({
          path: info.outputPath(`${path.replaceAll("/", "-")}-reduced-motion-focus.png`),
          fullPage: true,
        });
    }
    await writeFile(
      info.outputPath("quality-observations.json"),
      JSON.stringify({ caseId: "0.1", viewport: info.project.use.viewport, observations }, null, 2),
    );
  });
  test("keyboard reaches and saves owned profile then logout removes private access", async ({ page }, info) => {
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).focus();
    await page.keyboard.type(f!.studentEmail);
    await page.keyboard.press("Tab");
    await page.keyboard.type(f!.password);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/dashboard");
    await page.goto("/profile");
    const name = page.getByLabel("Display name", { exact: true });
    await expect(name).toBeVisible();
    const original = await name.inputValue();
    await name.focus();
    const save = page.getByRole("button", { name: "Save profile", exact: true });
    for (let step = 0; step < 6 && !(await save.evaluate((element) => element === document.activeElement)); step++)
      await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Your profile is saved/)).toBeVisible();
    await page.reload();
    await expect(name).toHaveValue(original);
    await page.screenshot({ path: info.outputPath("keyboard-profile-saved.png"), fullPage: true });
    const logout = page.getByRole("button", { name: "Sign out", exact: true });
    await logout.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/login/);
    expect(
      (await page.context().cookies()).filter((cookie) => cookie.name.includes("auth-token") && cookie.value).length,
    ).toBe(0);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login$/);
  });
  test("phone touch events complete profile save and logout", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Actual touch input belongs to the phone viewport variant.");
    const tap = async (target: ReturnType<Page["getByRole"]>) => {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    };
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(f!.studentEmail);
    await page.getByLabel("Password", { exact: true }).fill(f!.password);
    await tap(page.getByRole("button", { name: "Sign in", exact: true }));
    await page.waitForURL("**/dashboard");
    await page.goto("/profile");
    const name = await page.getByLabel("Display name", { exact: true }).inputValue();
    await tap(page.getByRole("button", { name: "Save profile", exact: true }));
    await expect(page.getByText(/Your profile is saved/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(name);
    await page.screenshot({ path: info.outputPath("touch-profile-saved.png"), fullPage: true });
    await tap(page.getByRole("button", { name: "Sign out", exact: true }));
    await page.waitForURL(/\/login/);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login$/);
  });
});
