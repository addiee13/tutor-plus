"use server";
import { createUserClient } from "@/lib/supabase/server";
import { resolveAssistantResponseReport } from "@/domains/platform/service";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
export async function resolveAssistantReportAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm this assistant report decision." });
    const state = String(form.get("state") ?? "");
    if (state !== "reviewing" && state !== "resolved" && state !== "dismissed")
      throw new InputError({ state: "Choose a supported report state." });
    await resolveAssistantResponseReport(await createUserClient(), {
      id: String(form.get("id") ?? ""),
      state,
      reason: String(form.get("reason") ?? ""),
      confirmed: true,
    });
    return { success: true, message: "The assistant response report decision and reason were recorded." };
  } catch (error) {
    return actionFailure(error, { state: String(form.get("state") ?? ""), reason: String(form.get("reason") ?? "") });
  }
}
