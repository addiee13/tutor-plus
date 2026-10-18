import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor, changeRole, register } from "../../src/domains/auth/service";
import { saveOwnProfile } from "../../src/domains/profiles/service";

vi.mock("server-only", () => ({}));

function fixture({ role = "student", status = "active", session = new Date().toISOString(), confirmed = true } = {}) {
  const update = vi.fn().mockReturnThis();
  const profile = { id: "owner", status, adult_attested: true, display_name: "Alex", timezone: "UTC" };
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update,
    single: vi.fn().mockResolvedValue({ data: profile, error: null }),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: table === "user_roles" ? [{ role }] : profile, error: null }),
  }));
  const rpc = vi.fn().mockResolvedValue({ data: session, error: null });
  const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const client = {
    from,
    rpc,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "owner",
            email_confirmed_at: confirmed ? new Date().toISOString() : null,
            user_metadata: { role: "administrator" },
          },
        },
        error: null,
      }),
      signUp,
      signOut,
    },
  };
  return { client: client as unknown as SupabaseClient, from, rpc, update, signUp, signOut };
}

describe("Request-scoped domain authority", () => {
  it("reads role/status/session authority from the database, not metadata", async () => {
    const mock = fixture();
    expect((await getActor(mock.client)).roles).toEqual(["student"]);
    expect(mock.rpc).toHaveBeenCalledWith("current_session_started_at");
  });
  it("fails closed when the trusted session RPC is unavailable", async () => {
    const mock = fixture();
    mock.rpc.mockResolvedValue({ data: null, error: { message: "raw SQL error" } });
    await expect(getActor(mock.client)).rejects.toThrow("couldn’t complete");
  });
  it("denies unverified, inactive and expired users", async () => {
    await expect(getActor(fixture({ confirmed: false }).client)).rejects.toThrow("verify");
    await expect(getActor(fixture({ status: "inactive" }).client)).rejects.toThrow("not available");
    await expect(getActor(fixture({ session: "2020-01-01T00:00:00Z" }).client)).rejects.toThrow("session has ended");
  });
  it("denies non-admins before attempting a role RPC", async () => {
    const mock = fixture();
    await expect(changeRole(mock.client, new FormData())).rejects.toThrow("not available");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("sends only editable profile fields under the authenticated owner ID", async () => {
    const mock = fixture();
    const payload = new FormData();
    payload.set("display_name", "Alex");
    payload.set("timezone", "UTC");
    payload.set("id", "victim");
    payload.set("role", "administrator");
    await saveOwnProfile(mock.client, payload);
    expect(mock.update).toHaveBeenCalledWith({ display_name: "Alex", timezone: "UTC" });
  });
  it("does not show check-email success when confirmation is disabled", async () => {
    const mock = fixture();
    mock.signUp.mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
    const payload = new FormData();
    for (const [key, value] of Object.entries({
      display_name: "Alex",
      timezone: "UTC",
      email: "alex@example.com",
      password: "long-test-password",
      role_intent: "student",
      adult_attested: "on",
    }))
      payload.set(key, value);
    await expect(register(mock.client, payload, "http://localhost:3000")).rejects.toThrow("not connected");
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("maps Tutor role intent to the trusted signup trigger contract", async () => {
    const mock = fixture();
    const payload = new FormData();
    for (const [key, value] of Object.entries({
      display_name: "Alex",
      timezone: "UTC",
      email: "alex@example.com",
      password: "long-test-password",
      role_intent: "tutor",
      adult_attested: "on",
    }))
      payload.set(key, value);
    await register(mock.client, payload, "http://localhost:3000");
    expect(mock.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: expect.objectContaining({ initial_role: "tutor" }) }),
      }),
    );
  });
});
