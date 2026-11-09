import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import type { Actor } from "../../src/domains/auth/policy";
import { deleteOwnProfileAvatar, uploadProfileAvatar } from "../../src/domains/profiles/service";
import { DomainError, InputError } from "../../src/domains/shared/errors";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const actor: Actor = {
  id: "71000000-0000-4000-8000-000000000001",
  roles: ["student"],
  sessionStartedAt: "2026-11-08T10:00:00Z",
};

function fixture({ signFails = false, changed = false }: { signFails?: boolean; changed?: boolean } = {}) {
  const events: string[] = [];
  const upload = vi.fn(async () => {
    events.push("upload");
    return { error: null };
  });
  const createSignedUrl = vi.fn(async () => {
    events.push("sign");
    return { data: signFails ? null : { signedUrl: "https://storage.example/signed" }, error: null };
  });
  const remove = vi.fn(async (paths: string[]) => {
    events.push(`remove:${paths[0]}`);
    return { error: null };
  });
  const storage = { from: vi.fn(() => ({ upload, createSignedUrl, remove })) };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      update: vi.fn(() => {
        events.push("pointer-update");
        return query;
      }),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: { avatar_path: `${actor.id}/old.png` }, error: null })),
      maybeSingle: vi.fn(async () => ({ data: changed ? null : { id: actor.id }, error: null })),
    };
    if (table !== "profiles") throw new Error(`Unexpected table: ${table}`);
    return query;
  });
  return {
    client: { from, storage } as unknown as SupabaseClient,
    from,
    storage,
    upload,
    createSignedUrl,
    remove,
    events,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue(actor);
});

describe("private profile avatar storage", () => {
  it("rejects spoofed image MIME types before uploading", async () => {
    const state = fixture();
    const fakePng = new File(["not a png"], "avatar.png", { type: "image/png" });
    await expect(uploadProfileAvatar(state.client, fakePng)).rejects.toBeInstanceOf(InputError);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("verifies the short-lived URL before switching the pointer and removing the previous object", async () => {
    const state = fixture();
    const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], "avatar.png", {
      type: "image/png",
    });
    await expect(uploadProfileAvatar(state.client, png)).resolves.toEqual({
      avatarUrl: "https://storage.example/signed",
    });
    expect(state.events[0]).toBe("upload");
    expect(state.events.indexOf("sign")).toBeLessThan(state.events.indexOf("pointer-update"));
    expect(state.events.indexOf("pointer-update")).toBeLessThan(state.events.indexOf(`remove:${actor.id}/old.png`));
    expect(state.storage.from).toHaveBeenCalledWith("profile-avatars");
  });

  it("keeps the previous pointer and object when signing or optimistic pointer update fails", async () => {
    const signingFailure = fixture({ signFails: true });
    const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], "avatar.png", {
      type: "image/png",
    });
    await expect(uploadProfileAvatar(signingFailure.client, png)).rejects.toBeInstanceOf(DomainError);
    expect(signingFailure.events).not.toContain("pointer-update");
    expect(signingFailure.remove).not.toHaveBeenCalledWith([`${actor.id}/old.png`]);

    const pointerRace = fixture({ changed: true });
    await expect(uploadProfileAvatar(pointerRace.client, png)).rejects.toBeInstanceOf(DomainError);
    expect(pointerRace.remove).toHaveBeenCalledTimes(1);
    expect(pointerRace.remove.mock.calls[0]?.[0]).not.toEqual([`${actor.id}/old.png`]);
  });

  it("clears only the avatar path it read before deleting that owner's file", async () => {
    const state = fixture();
    await deleteOwnProfileAvatar(state.client);
    expect(state.events).toEqual(["pointer-update", `remove:${actor.id}/old.png`]);
  });
});
