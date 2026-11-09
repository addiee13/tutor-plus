import Link from "next/link";
import type { UserClient } from "@/lib/supabase/server";
import { getActor } from "@/domains/auth/service";
import { hasRole } from "@/domains/auth/policy";
import { listSavedTutors } from "@/domains/marketplace/service";
import { isDomainError, safeMessage } from "@/domains/shared/errors";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { saveTutorAction, unsaveTutorAction } from "@/app/(protected)/dashboard/actions";
export async function SaveTutorControl({ client, tutorId }: { client: UserClient; tutorId: string }) {
  const actor = await loadWorkspace(() => getActor(client));
  if (!actor.ok)
    return isDomainError(actor.error, "unauthenticated") ? (
      <Link className="button secondary" href="/login">
        Sign in to save this tutor →
      </Link>
    ) : (
      <p className="notice warning" role="alert">
        {safeMessage(actor.error)}
      </p>
    );
  if (!hasRole(actor.value, "student"))
    return <p className="hint">Student capability is needed to keep a personal saved tutor list.</p>;
  const result = await loadWorkspace(() => listSavedTutors(client));
  if (!result.ok)
    return (
      <p className="notice warning" role="alert">
        {safeMessage(result.error)}
      </p>
    );
  const saved = result.value.some((item) => item.id === tutorId);
  return (
    <WorkflowForm
      title={saved ? "Remove saved tutor" : "Save tutor for later"}
      action={saved ? unsaveTutorAction : saveTutorAction}
      hidden={{ tutorId }}
      submit={saved ? "Remove from saved tutors" : "Save tutor for later"}
    />
  );
}
