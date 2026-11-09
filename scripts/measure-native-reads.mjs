// Q0.2: read-only loopback document timing. Private fixtures never enter the artifact.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import { sourceDigest } from "./native-verification-source.mjs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3018";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Local benchmark only");
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES || "/tmp/tutorplus-native-runtime/fixtures.json";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const artifact = process.env.READ_BENCHMARK_OUTPUT || "docs/evidence/sprint4/ordinary-reads.json";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const contexts = new Map();
const warmups = 20;
const measured = 200;
const samples = [];
const startedAt = new Date().toISOString();

const result = {
  caseId: "0.2",
  startedAt,
  finishedAt: null,
  environment: {
    target: baseURL,
    mode: process.env.READ_BENCHMARK_MODE || "production",
    runtime: process.version,
    operatingSystem: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    loadAverageAtStart: os.loadavg(),
    concurrency: 1,
    warmupsPerRoute: warmups,
    samplesPerRoute: measured,
    thresholdMsExclusive: 800,
    percentile: "nearest-rank: sorted sample 190 of 200",
    timing:
      "Monotonic duration from authenticated HTTP GET through complete HTML body. Includes loopback transport, server rendering, local Auth/PostgREST/database reads; excludes browser hydration. Conservative upper bound on ordinary server execution, not an internal server span.",
    providers:
      "No AI, geocoding, payment or external email operations are requested. Local identity verification needed for ordinary reads is included. External provider latency was not measured and is not claimed zero.",
    dataset: null,
    datasetAtEnd: null,
    sourceSha256: null,
    sourceSha256AtEnd: null,
    build: null,
  },
  routes: samples,
  allPassed: false,
};

async function signedContext(role) {
  if (contexts.has(role)) return contexts.get(role);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(fixture[`${role}Email`]);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  const welcome = page.getByRole("heading", { level: 1 }).filter({ hasText: /^Hello,/ });
  await welcome.waitFor({ state: "visible" });
  assert.match(await welcome.innerText(), /^Hello,/);
  const entry = { context, page };
  contexts.set(role, entry);
  return entry;
}

async function listDetail(role, listPath, prefix) {
  const { page } = await signedContext(role);
  await page.goto(listPath);
  const link = page.locator(`a[href^="${prefix}/"]`).first();
  assert.ok(await link.count(), `A saved fixture detail is required for ${prefix}`);
  return link.getAttribute("href");
}

function heading(body) {
  return [...body.matchAll(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/g)]
    .map((match) => match[1].replace(/<[^>]*>/g, "").trim())
    .filter((value) => !/Opening your space|Loading/.test(value))
    .at(-1);
}

async function read(context, path, expectedHeading, requiredFragments = []) {
  const before = performance.now();
  const response = await context.request.get(path, {
    maxRedirects: 0,
    failOnStatusCode: false,
    timeout: 30000,
    headers: { accept: "text/html", "cache-control": "no-cache" },
  });
  try {
    const body = await response.text();
    const durationMs = performance.now() - before;
    assert.equal(response.status(), 200, `${path}: HTTP must be 200 without redirect`);
    assert.match(response.headers()["content-type"] || "", /text\/html/);
    assert.ok(body.includes("</html>"), `${path}: complete HTML required`);
    assert.ok(!body.includes('role="alert"'), `${path}: page must not render a failure alert`);
    assert.ok(
      !body.includes("NEXT_REDIRECT") && !body.includes("NEXT_HTTP_ERROR_FALLBACK"),
      `${path}: no streamed redirect or route error`,
    );
    assert.ok(!body.includes("Refresh this page to try again."), `${path}: no workspace failure fallback`);
    assert.equal(heading(body), expectedHeading, `${path}: canonical final page heading must agree`);
    for (const fragment of requiredFragments)
      assert.ok(body.includes(fragment), `${path}: expected saved result content must be present`);
    return durationMs;
  } finally {
    await response.dispose();
  }
}

function datasetSnapshot() {
  return JSON.parse(
    execFileSync(
      "/opt/homebrew/opt/postgresql@17/bin/psql",
      [
        "-X",
        "-h",
        "/tmp/tutorplus-native-runtime",
        "-p",
        "55438",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-At",
        "-c",
        "select json_build_object('profiles',(select count(*) from public.profiles),'tutorListings',(select count(*) from public.tutor_profiles),'bookings',(select count(*) from public.bookings),'assessments',(select count(*) from public.assessments),'assignments',(select count(*) from public.assignments),'studyPlans',(select count(*) from public.study_plans));",
      ],
      { encoding: "utf8" },
    ).trim(),
  );
}

try {
  result.environment.sourceSha256 = await sourceDigest();
  result.environment.build = JSON.parse(await readFile(".next/verifier-production/verification-build.json", "utf8"));
  assert.equal(
    result.environment.sourceSha256,
    result.environment.build.sourceSha256,
    "Benchmark source differs from production build",
  );
  assert.equal(
    (await readFile(".next/verifier-production/BUILD_ID", "utf8")).trim(),
    result.environment.build.buildId,
    "Production build identity changed",
  );
  result.environment.dataset = datasetSnapshot();
  const assessment = await listDetail("student", "/assessments", "/assessments");
  const assignment = await listDetail("student", "/assignments", "/assignments");
  const plan = await listDetail("student", "/study-plans", "/study-plans");
  const { page: slotPage } = await signedContext("student");
  await slotPage.goto(`/bookings?tutor=${fixture.tutorListingId}`);
  const reservation = slotPage.getByRole("form", { name: "Request a booking", exact: true });
  await reservation.getByLabel("Published tutor", { exact: true }).selectOption(fixture.tutorListingId);
  await reservation.getByRole("button", { name: /^Soonest/ }).click();
  const feasibleStart = await reservation.locator('input[name="starts_at"]').inputValue();
  assert.ok(Number.isFinite(Date.parse(feasibleStart)), "A canonical feasible slot is required for the matching read");
  const matchingQuery = new URLSearchParams({
    run: "1",
    subject: fixture.subjectId,
    mode: "virtual",
    rate: "40",
    availableAt: feasibleStart,
    duration: "60",
  });
  const tutorLink = `href="/tutors/${fixture.tutorListingId}"`;
  await slotPage.goto("/progress");
  const goal = await slotPage
    .getByRole("form", { name: "Filter learning progress", exact: true })
    .getByLabel("Goal", { exact: true })
    .locator('option:not([value=""])')
    .first()
    .getAttribute("value");
  assert.match(goal || "", /^[a-f0-9-]{36}$/i, "A saved goal is required for filtered progress timing");
  const routes = [
    ["student", "/dashboard"],
    ["student", "/saved-tutors"],
    ["student", "/profile"],
    ["student", "/bookings"],
    ["student", `/bookings/${fixture.confirmedBookingId}`],
    ["student", `/sessions/${fixture.confirmedBookingId}`],
    ["student", `/sessions/${fixture.completedBookingId}`],
    ["student", "/learning"],
    ["student", "/assessments"],
    ["student", assessment],
    ["student", "/assignments"],
    ["student", assignment],
    ["student", "/study-plans"],
    ["student", plan],
    ["student", "/progress"],
    ["student", `/progress?goal=${goal}`],
    ["student", "/reviews"],
    ["student", "/notifications"],
    ["student", "/resources"],
    ["student", "/assistant"],
    ["student", "/matching"],
    ["student", `/matching?${matchingQuery}`, [tutorLink, "Factor version"]],
    ["student", "/support"],
    ["tutor", "/tutor-studio"],
    ["tutor", "/progress"],
    ["admin", "/admin"],
    ["admin", "/admin/accounts"],
    ["admin", "/admin/safety"],
    ["admin", "/admin/templates"],
    ["admin", "/admin/matching"],
    ["admin", "/admin/assessment-templates"],
    ["admin", "/admin/badges"],
    ["admin", "/admin/operations"],
    ["tutor", "/assessments"],
    ["tutor", "/dashboard"],
    [
      "student",
      `/progress?topic=${encodeURIComponent(JSON.stringify({ subjectId: fixture.subjectId, topic: "Math factoring" }))}`,
    ],
    ["student", "/tutors"],
    ["student", `/tutors?subject=${fixture.subjectId}&mode=virtual&rate=40`, [tutorLink]],
    ["student", `/tutors/${fixture.tutorListingId}`],
  ];
  for (const [role, path, requiredFragments = []] of routes) {
    const { context, page } = await signedContext(role);
    await page.goto(path);
    assert.equal(
      await page.locator('[role="alert"]:not(#__next-route-announcer__)').count(),
      0,
      `${path}: initial browser page must load`,
    );
    const renderedHeading = page
      .getByRole("heading", { level: 1 })
      .filter({ hasNotText: /Opening your space|Loading/ });
    await renderedHeading.waitFor({ state: "visible" });
    const h1 = await renderedHeading.innerText();
    // Read one complete response first to capture the HTML-escaped heading, then verify
    // every warmup/measured response against the same fully rendered fixture page.
    const canonical = await context.request.get(path, { maxRedirects: 0 });
    assert.equal(canonical.status(), 200);
    const canonicalBody = await canonical.text();
    const expectedHeading = heading(canonicalBody);
    for (const fragment of requiredFragments)
      assert.ok(canonicalBody.includes(fragment), `${path}: baseline saved result must be present`);
    await canonical.dispose();
    assert.ok(h1 && expectedHeading && !/not found|sign in|connect your account/i.test(h1));
    for (let i = 0; i < warmups; i++) await read(context, path, expectedHeading, requiredFragments);
    const values = [];
    for (let i = 0; i < measured; i++) values.push(await read(context, path, expectedHeading, requiredFragments));
    const sorted = [...values].sort((a, b) => a - b);
    const p95Ms = sorted[Math.ceil(0.95 * measured) - 1];
    const row = {
      role,
      path,
      heading: h1,
      warmups,
      samples: measured,
      minMs: sorted[0],
      medianMs: (sorted[99] + sorted[100]) / 2,
      p95Ms,
      maxMs: sorted.at(-1),
      passed: p95Ms < 800,
      requiredSavedContent: requiredFragments,
      responseCheck:
        "Every warmup and measured response: 200, HTML content type, full body, exact heading, no redirect/error/failure alert.",
      durationsMs: values,
    };
    samples.push(row);
    console.log(
      `${row.passed ? "PASS" : "FAIL"} ${role} ${path}: p95 ${p95Ms.toFixed(2)} ms (${measured} verified reads)`,
    );
    await writeFile(artifact, `${JSON.stringify(result, null, 2)}\n`);
  }
  result.environment.sourceSha256AtEnd = await sourceDigest();
  result.environment.datasetAtEnd = datasetSnapshot();
  assert.equal(
    result.environment.sourceSha256AtEnd,
    result.environment.sourceSha256,
    "Source changed during benchmark",
  );
  assert.deepEqual(
    result.environment.datasetAtEnd,
    result.environment.dataset,
    "Fixture dataset counts changed during benchmark",
  );
  result.allPassed = samples.every((sample) => sample.passed);
  assert.ok(result.allPassed, "One or more routes failed the ordinary-read threshold");
} finally {
  result.finishedAt = new Date().toISOString();
  result.environment.loadAverageAtEnd = os.loadavg();
  await writeFile(artifact, `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
