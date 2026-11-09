import "server-only";
import type { UserClient } from "@/lib/supabase/server";
import { listResources } from "@/domains/platform/service";
import { listAssessments, listAssignments, listLearningRelationships } from "@/domains/learning/service";
import type { PlanLinkOption } from "./editors";
export async function loadPlanLinks(client: UserClient): Promise<PlanLinkOption[]> {
  const [resources, assessments, assignments, relationships] = await Promise.all([
    listResources(client),
    listAssessments(client),
    listAssignments(client),
    listLearningRelationships(client),
  ]);
  return [
    ...resources.map((resource) => ({
      kind: "resource" as const,
      id: resource.id,
      label: `Resource · ${resource.title}`,
      subjectId: resource.subjectId,
    })),
    ...assessments.map((assessment) => ({
      kind: "assessment" as const,
      id: assessment.id,
      label: `Assessment · ${assessment.title}`,
      subjectId: assessment.subject_id,
      studentId: assessment.student_id,
    })),
    ...assignments.flatMap((assignment) => {
      const relation = relationships.find((row) => row.bookingId === assignment.booking_id);
      return relation
        ? [
            {
              kind: "assignment" as const,
              id: assignment.id,
              label: `Assignment · ${assignment.title}`,
              studentId: assignment.student_id,
              subjectId: relation.subjectId,
            },
          ]
        : [];
    }),
  ];
}
