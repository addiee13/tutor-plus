import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import type { Actor } from "../../src/domains/auth/policy";
import { BookingInputError, parseBookingRequest, parseCancellation, parseUtcTimestamp } from "../../src/domains/bookings/validation";
import { requireBookingActor, requireBookingParticipant, requireBookingStudent } from "../../src/domains/bookings/policy";
import { requestBooking, cancelBooking, readBookingWorkspace } from "../../src/domains/bookings/service";
import { formatMoney } from "../../src/domains/bookings/presentation";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const tutorId = "00000000-0000-4000-8000-000000000001";
const subjectId = "00000000-0000-4000-8000-000000000002";
const bookingId = "00000000-0000-4000-8000-000000000003";
const key = "00000000-0000-4000-8000-000000000004";
const actor: Actor = { id: "student-owner", roles: ["student"], sessionStartedAt: "2026-09-30T12:00:00Z" };
const now = Date.parse("2026-09-30T12:00:00Z");

function request(overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({ tutor: tutorId, subject: subjectId, starts_at: "2026-10-02T14:00:00Z", ends_at: "2026-10-02T15:00:00Z", mode: "virtual", request_key: key, ...overrides }).forEach(([name, value]) => form.set(name, value));
  return form;
}

function cancellation(overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({ booking: bookingId, reason: "Plans changed", ...overrides }).forEach(([name, value]) => form.set(name, value));
  return form;
}

function database({ rpcError = null, savedStatus = "payment_pending", student = actor.id, publicTutor = true, activeSubject = true }: { rpcError?: { code: string; message?: string } | null; savedStatus?: string; student?: string; publicTutor?: boolean; activeSubject?: boolean } = {}) {
  const booking = { id: bookingId, student_id: student, tutor_id: tutorId, subject_id: subjectId, status: savedStatus, price_minor: 3000, platform_fee_minor: 0, currency: "USD", hold_expires_at: "2026-10-02T14:15:00Z" };
  const rows: Record<string, unknown[]> = {
    public_tutor_snapshots: publicTutor ? [{ id: tutorId, public_display_name: "Tutor", headline: "Mathematics", hourly_rate_minor: 3000, currency: "USD", supports_virtual: true, supports_in_person: false }] : [],
    subjects: activeSubject ? [{ id: subjectId, name: "Mathematics" }] : [],
    bookings: [booking], tutor_profiles: [], availability_rules: [], availability_exceptions: [], tutor_subjects: []
  };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null })),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null })
    };
    return query;
  });
  const rpc = vi.fn<(name: string, parameters: Record<string, unknown>) => Promise<{ data: string | null; error: typeof rpcError }>>(async (name) => {
    if (name === "cancel_booking" && !rpcError) booking.status = "cancelled";
    return { data: name === "create_booking" ? bookingId : null, error: rpcError };
  });
  const rpcWithCatalog = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
    if (name === "list_public_tutor_subjects") return { data: activeSubject ? [{ subject_id: subjectId, name: "Mathematics", hourly_rate_minor: 3000, currency: "USD" }] : [], error: null };
    return rpc(name, parameters);
  });
  return { client: { from, rpc: rpcWithCatalog } as unknown as SupabaseClient, from, rpc, rpcWithCatalog };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(getActor).mockResolvedValue(actor); });

describe("UC-04 strict request parsing", () => {
  it("normalizes UTC timestamps and stable UUID request keys", () => {
    expect(parseBookingRequest(request({ starts_at: "2026-10-02T14:00Z", request_key: key.toUpperCase() }), now)).toMatchObject({ starts_at: "2026-10-02T14:00:00.000Z", ends_at: "2026-10-02T15:00:00.000Z", request_key: key });
    expect(parseUtcTimestamp("2028-02-29T00:00:00.1Z", "starts_at")).toBe("2028-02-29T00:00:00.100Z");
  });

  it.each(["2026-02-29T14:00:00Z", "2026-04-31T14:00:00Z", "2026-13-01T14:00:00Z", "2026-10-02T24:00:00Z", "2026-10-02T14:60:00Z", "2026-10-02T14:00:00", "2026-10-02T14:00:00+00:00", "2026-10-02T10:00:00-04:00", "10/02/2026 14:00", "infinity", "2026-10-02T14:00:00.0001Z"])("rejects invalid or non-UTC input %s", (value) => {
    expect(() => parseUtcTimestamp(value, "starts_at")).toThrow(BookingInputError);
  });

  it("rejects missing or file-valued timestamps", () => {
    expect(() => parseUtcTimestamp(null, "starts_at")).toThrow(BookingInputError);
    const form = request(); form.set("starts_at", new Blob(["2026-10-02T14:00:00Z"]));
    expect(() => parseBookingRequest(form, now)).toThrow(BookingInputError);
  });

  it("rejects a start time at or before now", () => {
    expect(() => parseBookingRequest(request({ starts_at: "2026-09-30T12:00:00Z" }), now)).toThrow(BookingInputError);
    expect(() => parseBookingRequest(request({ starts_at: "2026-09-29T12:00:00Z" }), now)).toThrow(BookingInputError);
  });

  it.each(["2026-10-02T14:00:00Z", "2026-10-02T13:59:00Z", "2026-10-02T14:14:00Z", "2026-10-02T17:01:00Z", "2026-10-02T15:00:01Z"])("rejects invalid duration ending at %s", (ends_at) => {
    expect(() => parseBookingRequest(request({ ends_at }), now)).toThrow(BookingInputError);
  });

  it.each(["2026-10-02T14:15:00Z", "2026-10-02T17:00:00Z"])("accepts a duration boundary ending at %s", (ends_at) => {
    expect(parseBookingRequest(request({ ends_at }), now).ends_at).toBe(new Date(ends_at).toISOString());
  });

  it.each(["", "unsafe-key", "x".repeat(201), "00000000-0000-1000-8000-000000000004"])("rejects invalid request key %s", (request_key) => {
    expect(() => parseBookingRequest(request({ request_key }), now)).toThrow(BookingInputError);
  });

  it("allows an omitted key only for server-side generation", () => {
    const form = request(); form.delete("request_key");
    expect(parseBookingRequest(form, now).request_key).toBeUndefined();
  });

  it("rejects forged IDs and unsupported modes", () => {
    for (const field of ["tutor", "subject", "mode"]) expect(() => parseBookingRequest(request({ [field]: "forged" }), now)).toThrow(BookingInputError);
  });

  it("ignores browser-supplied actor, price and confirmed status", () => {
    const parsed = parseBookingRequest(request({ student_id: "stranger", price_minor: "1", status: "confirmed" }), now);
    expect(parsed).not.toHaveProperty("student_id"); expect(parsed).not.toHaveProperty("price_minor"); expect(parsed).not.toHaveProperty("status");
  });

  it("validates and trims cancellation reasons", () => {
    expect(parseCancellation(cancellation({ reason: "  Plans changed  " })).reason).toBe("Plans changed");
    expect(() => parseCancellation(cancellation({ reason: "  " }))).toThrow(BookingInputError);
    expect(() => parseCancellation(cancellation({ reason: "x".repeat(501) }))).toThrow(BookingInputError);
    expect(() => parseCancellation(cancellation({ booking: "forged" }))).toThrow(BookingInputError);
  });

  it("formats currency-specific monetary minor units", () => {
    expect(formatMoney(3000, "USD")).toBe("$30.00"); expect(formatMoney(3000, "JPY")).toBe("¥3,000");
  });
});

describe("UC-04 server authorization and SQL contracts (mocked, not live persistence)", () => {
  it("allows Student+Tutor accounts and refuses tutor-only reservation creation", () => {
    expect(() => requireBookingStudent({ ...actor, roles: ["student", "tutor"] })).not.toThrow();
    expect(() => requireBookingStudent({ ...actor, roles: ["tutor"] })).toThrow();
    expect(() => requireBookingActor({ ...actor, roles: ["administrator"] })).toThrow();
  });

  it("requires participant ownership rather than only the tutor role", () => {
    const booking = { student_id: "other-student", tutor_id: tutorId };
    expect(() => requireBookingParticipant({ ...actor, roles: ["tutor"] }, booking, [tutorId])).not.toThrow();
    expect(() => requireBookingParticipant({ ...actor, roles: ["tutor"] }, booking, [])).toThrow();
    expect(() => requireBookingParticipant(actor, booking, [tutorId])).toThrow();
  });

  it("passes only the migration’s named arguments to create_booking and reads saved state", async () => {
    const fixture = database();
    const starts_at = new Date(Date.now() + 86400000).toISOString();
    const ends_at = new Date(Date.parse(starts_at) + 3600000).toISOString();
    const saved = await requestBooking(fixture.client, request({ starts_at, ends_at, price_minor: "1", status: "confirmed" }));
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("create_booking", { tutor: tutorId, subject: subjectId, starts_at, ends_at, mode: "virtual", request_key: key });
    expect(saved).toMatchObject({ id: bookingId, status: "payment_pending", price_minor: 3000 });
  });

  it("generates a UUID key on the server when no key was submitted", async () => {
    const fixture = database();
    const starts_at = new Date(Date.now() + 86400000).toISOString();
    const form = request({ starts_at, ends_at: new Date(Date.parse(starts_at) + 3600000).toISOString() }); form.delete("request_key");
    await requestBooking(fixture.client, form);
    expect(fixture.rpc.mock.calls[0]?.[1]).toMatchObject({ request_key: expect.stringMatching(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/) });
  });

  it("denies tutor-only creation before reading any data or calling RPC", async () => {
    vi.mocked(getActor).mockResolvedValue({ ...actor, roles: ["tutor"] });
    const fixture = database();
    await expect(requestBooking(fixture.client, request())).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.from).not.toHaveBeenCalled(); expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("does not claim success when current-actor resolution fails", async () => {
    vi.mocked(getActor).mockRejectedValue(new Error("expired"));
    const fixture = database();
    await expect(requestBooking(fixture.client, request())).rejects.toThrow(); expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it.each([{ publicTutor: false }, { activeSubject: false }])("rechecks published tutor and active subject before SQL mutation: %o", async (options) => {
    const fixture = database(options);
    const starts_at = new Date(Date.now() + 86400000).toISOString();
    await expect(requestBooking(fixture.client, request({ starts_at, ends_at: new Date(Date.parse(starts_at) + 3600000).toISOString() }))).rejects.toBeInstanceOf(BookingInputError);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("passes only booking and reason to cancel_booking and rereads the cancelled state", async () => {
    const fixture = database();
    expect(await cancelBooking(fixture.client, cancellation())).toMatchObject({ status: "cancelled" });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("cancel_booking", { booking: bookingId, reason: "Plans changed" });
  });

  it("denies another student’s booking even if a faulty query exposed it", async () => {
    const fixture = database({ student: "stranger" });
    await expect(cancelBooking(fixture.client, cancellation())).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("does not fake cancellation of completed sessions", async () => {
    const fixture = database({ savedStatus: "completed" });
    await expect(cancelBooking(fixture.client, cancellation())).rejects.toBeInstanceOf(BookingInputError);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("treats SQL exclusion conflicts as unavailable time, not success", async () => {
    const fixture = database({ rpcError: { code: "23P01", message: "private constraint detail" } });
    const starts_at = new Date(Date.now() + 86400000).toISOString();
    await expect(requestBooking(fixture.client, request({ starts_at, ends_at: new Date(Date.parse(starts_at) + 3600000).toISOString() }))).rejects.toMatchObject({ fields: { starts_at: expect.stringContaining("conflicts") } });
  });

  it("reads only the safe public tutor projection and does not invent schedule rows", async () => {
    const fixture = database();
    const workspace = await readBookingWorkspace(fixture.client);
    expect(workspace.rules).toEqual([]); expect(workspace.exceptions).toEqual([]);
    expect(fixture.from.mock.results[0].value.select).toHaveBeenCalledWith("id,public_display_name,headline,hourly_rate_minor,currency,supports_virtual,supports_in_person");
  });
});
