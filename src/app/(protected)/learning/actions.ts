"use server";

import { readQuestionForm } from "@/lib/learning-question-form";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import {
  listLearningRelationships,
  createAssessment,
  updateAssessment,
  assignAssessment,
  saveAssessmentAttempt,
  scoreAssessmentAttempt,
  createAssignment,
  updateAssignment,
  assignAssignment,
  submitAssignment,
  giveAssignmentFeedback,
  createStudyPlan,
  reviseStudyPlan,
  recordMilestoneEvidence,
} from "@/domains/learning/service";
import type {
  AssessmentPurpose,
  AssignmentSubmissionType,
  StudyGoalInput,
  StudyPlanEvidence,
  StudyMilestoneStatus,
  StudyMilestoneLink,
} from "@/domains/learning/types";

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function values(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) as Record<
    string,
    string
  >;
}
function purpose(form: FormData): AssessmentPurpose {
  const value = text(form, "purpose");
  if (!["diagnostic", "pre_session", "post_session", "milestone"].includes(value))
    throw new InputError({ purpose: "Choose an assessment purpose." });
  return value as AssessmentPurpose;
}
function submissionType(form: FormData): AssignmentSubmissionType {
  const value = text(form, "submissionType");
  if (!["text", "link", "file"].includes(value)) throw new InputError({ submissionType: "Choose a submission type." });
  return value as AssignmentSubmissionType;
}
async function relationship(client: Awaited<ReturnType<typeof createUserClient>>, form: FormData) {
  const relations = await listLearningRelationships(client);
  const found = relations.find((row) => row.bookingId === text(form, "relationship"));
  if (!found) throw new InputError({ relationship: "Choose one of your established learning relationships." });
  return found;
}
function goals(form: FormData): StudyGoalInput[] {
  const count = Number(text(form, "goalCount"));
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new InputError({ goals: "Add between 1 and 20 learning goals." });
  return Array.from({ length: count }, (_, i) => {
    const milestoneCount = Number(text(form, `milestoneCount:${i}`));
    if (!Number.isInteger(milestoneCount) || milestoneCount < 1 || milestoneCount > 30)
      throw new InputError({ goals: "Each goal needs between 1 and 30 milestones." });
    return {
      id: text(form, `goalId:${i}`) || undefined,
      title: text(form, `goalTitle:${i}`),
      topic: text(form, `goalTopic:${i}`),
      targetDate: text(form, `goalTargetDate:${i}`),
      baseline: text(form, `goalBaseline:${i}`),
      schedule: text(form, `goalSchedule:${i}`),
      successCriterion: text(form, `goalCriterion:${i}`),
      description: text(form, `goalDescription:${i}`) || null,
      milestones: Array.from({ length: milestoneCount }, (_, j) => ({
        id: text(form, `milestoneId:${i}:${j}`) || undefined,
        title: text(form, `milestoneTitle:${i}:${j}`),
        description: text(form, `milestoneDescription:${i}:${j}`) || null,
        status: text(form, `milestoneStatus:${i}:${j}`) as Exclude<StudyMilestoneStatus, "unspecified">,
        targetDate: text(form, `milestoneTargetDate:${i}:${j}`) || null,
        links: form.getAll(`milestoneLinks:${i}:${j}`).map((value) => {
          const [kind, id] = String(value).split(":");
          if (kind !== "resource" && kind !== "assignment" && kind !== "assessment")
            throw new InputError({ goals: "Choose a valid learning link." });
          return { kind, id } as StudyMilestoneLink;
        }),
      })),
    };
  });
}

export async function saveAssessmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const input = {
      title: text(form, "title"),
      instructions: text(form, "instructions") || null,
      purpose: purpose(form),
      dueAt: text(form, "dueAt") || null,
      questions: readQuestionForm(form),
    };
    const existing = text(form, "assessmentId");
    const saved = existing
      ? await updateAssessment(client, existing, input)
      : await (async () => {
          const rel = await relationship(client, form);
          return createAssessment(client, {
            ...input,
            tutorId: rel.tutorId,
            studentId: rel.studentId,
            subjectId: rel.subjectId,
            bookingId: rel.bookingId,
          });
        })();
    return {
      success: true,
      message: "Assessment draft saved. Review it before assigning it to your learner.",
      values: { savedHref: `/assessments/${saved.id}` },
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function assignAssessmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assignAssessment(await createUserClient(), text(form, "assessmentId"));
    return { success: true, message: "Assessment assigned. Your learner can now open and complete it." };
  } catch (error) {
    return actionFailure(error);
  }
}
export async function attemptAssessmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const answers = Object.fromEntries(
      [...form.entries()]
        .filter(([key]) => key.startsWith("answer:"))
        .map(([key, value]) => [key.slice(7), String(value)]),
    );
    const finalize = text(form, "finalize") === "true";
    await saveAssessmentAttempt(await createUserClient(), text(form, "assessmentId"), answers, finalize);
    return {
      success: true,
      message: finalize
        ? "Your assessment attempt was submitted. Any written answers await tutor review."
        : "Your draft answers were saved.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function scoreAssessmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await scoreAssessmentAttempt(await createUserClient(), text(form, "attemptId"), {
      tutorPoints: Number(text(form, "tutorPoints")),
      feedback: text(form, "feedback"),
    });
    return { success: true, message: "Your assessment scoring and feedback were saved." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function saveAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const input = {
      title: text(form, "title"),
      topic: text(form, "topic"),
      instructions: text(form, "instructions"),
      submissionType: submissionType(form),
      dueAt: text(form, "dueAt"),
      acceptsLate: form.has("acceptsLate"),
      studyPlanId: text(form, "linkedMilestone").split(":")[0] || null,
      milestoneId: text(form, "linkedMilestone").split(":")[1] || null,
    };
    const existing = text(form, "assignmentId");
    const saved = existing
      ? await updateAssignment(client, existing, input)
      : await (async () => {
          const rel = await relationship(client, form);
          return createAssignment(client, {
            ...input,
            tutorId: rel.tutorId,
            studentId: rel.studentId,
            bookingId: rel.bookingId,
          });
        })();
    return {
      success: true,
      message: "Assignment draft saved. Assign it when the instructions are ready.",
      values: { savedHref: `/assignments/${saved.id}` },
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function assignAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assignAssignment(await createUserClient(), text(form, "assignmentId"));
    return { success: true, message: "Your assignment was assigned to the learner." };
  } catch (error) {
    return actionFailure(error);
  }
}
export async function submitAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const file = form.get("file");
    await submitAssignment(await createUserClient(), text(form, "assignmentId"), {
      body: text(form, "body") || null,
      linkUrl: text(form, "linkUrl") || null,
      file: file instanceof File && file.size ? file : null,
    });
    return { success: true, message: "Your work was submitted and saved for tutor review." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function saveAssignmentDraftAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { saveAssignmentDraft } = await import("@/domains/learning/service");
    await saveAssignmentDraft(await createUserClient(), text(form, "assignmentId"), {
      body: text(form, "body") || null,
      linkUrl: text(form, "linkUrl") || null,
    });
    return {
      success: true,
      message: "Your private assignment draft was saved. Your tutor cannot see it until you submit it.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function submitAssignmentDraftAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed"))
      throw new InputError({ confirmed: "Confirm that this saved draft is ready for tutor review." });
    const { submitAssignmentDraft } = await import("@/domains/learning/service");
    await submitAssignmentDraft(await createUserClient(), text(form, "assignmentId"));
    return {
      success: true,
      message: "Your saved draft was submitted for tutor review. The submitted work remains in your attempt history.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}
export async function feedbackAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const outcome = text(form, "outcome");
    if (outcome !== "returned" && outcome !== "completed")
      throw new InputError({ outcome: "Choose a review outcome." });
    await giveAssignmentFeedback(await createUserClient(), text(form, "submissionId"), {
      feedback: text(form, "feedback"),
      score: text(form, "score") ? Number(text(form, "score")) : null,
      outcome,
    });
    return { success: true, message: "Your assignment feedback and review outcome were saved." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function savePlanAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const input = { title: text(form, "title"), description: text(form, "description") || null, goals: goals(form) };
    const existing = text(form, "planId");
    const personal = text(form, "mode") === "personal";
    const { createPersonalStudyPlan, revisePersonalStudyPlan } = await import("@/domains/learning/service");
    const saved = existing
      ? await (personal
          ? revisePersonalStudyPlan(client, existing, {
              ...input,
              expectedRevision: Number(text(form, "expectedRevision")),
            })
          : reviseStudyPlan(client, existing, { ...input, expectedRevision: Number(text(form, "expectedRevision")) }))
      : personal
        ? await createPersonalStudyPlan(client, { ...input, subjectId: text(form, "subjectId") })
        : await (async () => {
            const rel = await relationship(client, form);
            return createStudyPlan(client, {
              ...input,
              tutorId: rel.tutorId,
              studentId: rel.studentId,
              subjectId: rel.subjectId,
              bookingId: rel.bookingId,
            });
          })();
    return {
      success: true,
      message: "Your study plan revision was saved. Progress stays linked to dated learning evidence.",
      values: { savedHref: `/study-plans/${saved.plan.id}` },
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function recordEvidenceAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const source = text(form, "source");
    const [sourceKind, sourceId] = source.split(":");
    if (!["assessment_attempt", "assignment_submission", "session_recap"].includes(sourceKind))
      throw new InputError({ source: "Choose a saved learning record." });
    await recordMilestoneEvidence(await createUserClient(), text(form, "planId"), text(form, "milestoneId"), {
      sourceKind: sourceKind as StudyPlanEvidence["source_kind"],
      sourceId,
    });
    return { success: true, message: "Evidence was linked to this milestone. Progress now reflects the saved record." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function reopenAssessmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { authorizeAssessmentRetake } = await import("@/domains/learning/service");
    await authorizeAssessmentRetake(await createUserClient(), text(form, "assessmentId"));
    return {
      success: true,
      message: "Assessment reopened for one more learner attempt. Earlier attempts remain in the history.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function rescheduleMilestoneAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { rescheduleStudyMilestone, reschedulePersonalStudyMilestone } = await import("@/domains/learning/service");
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm the new date before rescheduling." });
    const reschedule = text(form, "mode") === "personal" ? reschedulePersonalStudyMilestone : rescheduleStudyMilestone;
    await reschedule(await createUserClient(), text(form, "planId"), text(form, "milestoneId"), {
      expectedRevision: Number(text(form, "expectedRevision")),
      targetDate: text(form, "targetDate"),
      reason: text(form, "reason"),
    });
    return {
      success: true,
      message: "The milestone was rescheduled. Its previous target date, author and reason remain in the history.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function proposeMilestoneAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { createStudyPlanProposal } = await import("@/domains/learning/service");
    await createStudyPlanProposal(await createUserClient(), text(form, "planId"), {
      milestoneId: text(form, "milestoneId"),
      proposedTargetDate: text(form, "targetDate"),
      summary: text(form, "summary"),
    });
    return {
      success: true,
      message: "A draft date proposal was saved. The current plan is unchanged until the learner confirms it.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function decidePlanProposalAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { confirmStudyPlanProposal, dismissStudyPlanProposal } = await import("@/domains/learning/service");
    if (text(form, "decision") === "accept") {
      if (!form.has("confirmed"))
        throw new InputError({ confirmed: "Confirm this proposal before changing the plan." });
      await confirmStudyPlanProposal(await createUserClient(), text(form, "proposalId"), text(form, "reason"));
    } else if (text(form, "decision") === "dismiss")
      await dismissStudyPlanProposal(await createUserClient(), text(form, "proposalId"), text(form, "reason"));
    else throw new InputError({ decision: "Choose whether to accept or dismiss the proposal." });
    return {
      success: true,
      message:
        text(form, "decision") === "accept"
          ? "Your accepted date change was recorded with its reason and date."
          : "The proposal was dismissed. The current milestone date is unchanged.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function masteryAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const relations = await listLearningRelationships(client);
    const rel = relations.find(
      (row) => row.studentId === text(form, "studentId") && row.subjectId === text(form, "subjectId"),
    );
    if (!rel) throw new InputError({ topic: "Choose an established learner and subject relationship." });
    const label = text(form, "label");
    if (label !== "needs_work" && label !== "improving" && label !== "confident")
      throw new InputError({ label: "Choose Needs Work, Improving or Confident." });
    const [sourceKind, sourceId] = text(form, "source").split(":");
    if (sourceKind !== "assessment_attempt" && sourceKind !== "assignment_submission" && sourceKind !== "session_recap")
      throw new InputError({ source: "Choose a saved evidence source." });
    const { setTopicMastery } = await import("@/domains/learning/service");
    await setTopicMastery(client, {
      studentId: rel.studentId,
      subjectId: rel.subjectId,
      topic: text(form, "topic"),
      label,
      sourceKind,
      sourceId,
      observedAt: text(form, "observedAt"),
      note: text(form, "note") || null,
    });
    return {
      success: true,
      message:
        "Your topic observation was saved with its evidence source and date. Earlier observations remain in the history.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function deleteReflectionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm deletion of this optional reflection." });
    const { deleteSessionReflection } = await import("@/domains/learning/service");
    await deleteSessionReflection(await createUserClient(), text(form, "bookingId"));
    return {
      success: true,
      message: "Your optional reflection was deleted. Session, assessment and audit records are retained.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function closeAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm closure of assignment submissions." });
    const { closeAssignmentSubmissions } = await import("@/domains/learning/service");
    await closeAssignmentSubmissions(await createUserClient(), text(form, "assignmentId"));
    return {
      success: true,
      message: "Submissions were closed for this assignment. Existing work and feedback are retained.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function cancelAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm cancellation of this assignment." });
    const { cancelAssignment } = await import("@/domains/learning/service");
    await cancelAssignment(await createUserClient(), text(form, "assignmentId"), text(form, "reason"));
    return {
      success: true,
      message: "The assignment was cancelled with its reason. Existing submissions and feedback remain in the history.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function sharePersonalPlanAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed"))
      throw new InputError({ confirmed: "Confirm sharing this plan with the selected booked tutor." });
    const { sharePersonalStudyPlan } = await import("@/domains/learning/service");
    await sharePersonalStudyPlan(await createUserClient(), text(form, "planId"), text(form, "bookingId"));
    return {
      success: true,
      message: "Your plan was shared with the tutor on the selected booking. The sharing relationship is now saved.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
