import type { UserClient } from "@/lib/supabase/server";
import { readBookingStudentNotes, readTutorBookingNotes } from "@/domains/bookings/service";
import { loadWorkspace } from "@/components/workspace/load";
import { Section } from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { safeMessage } from "@/domains/shared/errors";
import { saveBookingNotesAction } from "../actions";
export async function BookingLearningNotes({
  client,
  bookingId,
  role,
}: {
  client: UserClient;
  bookingId: string;
  role: "student" | "tutor";
}) {
  if (role === "tutor") {
    const result = await loadWorkspace(() => readTutorBookingNotes(client, bookingId));
    if (!result.ok)
      return (
        <Section title="Shared reservation notes">
          <p className="notice warning" role="alert">
            {safeMessage(result.error)}
          </p>
        </Section>
      );
    const notes = result.value;
    return (
      <Section title="Shared reservation notes">
        {!notes ? (
          <p>The learner has not shared reservation notes with you.</p>
        ) : (
          <>
            <dl className="workspace-facts">
              <div>
                <dt>Learning goal</dt>
                <dd className="workspace-prose">{notes.learningGoal || "No goal shared"}</dd>
              </div>
              <div>
                <dt>Topics</dt>
                <dd>{notes.topics.join(" · ") || "No topics shared"}</dd>
              </div>
              <div>
                <dt>Questions</dt>
                <dd className="workspace-prose">{notes.questions || "No questions shared"}</dd>
              </div>
            </dl>
            <p className="hint">This is the learner’s shared context for this reservation.</p>
          </>
        )}
      </Section>
    );
  }
  const result = await loadWorkspace(() => readBookingStudentNotes(client, bookingId));
  if (!result.ok)
    return (
      <Section title="Your reservation notes">
        <p className="notice warning" role="alert">
          {safeMessage(result.error)}
        </p>
      </Section>
    );
  const notes = result.value;
  return (
    <Section title="Your reservation notes">
      <p>
        Keep a learning goal, topics and questions with this booking. You choose whether that context is shared with its
        tutor; your private note stays in your account.
      </p>
      <WorkflowForm
        title="Save booking learning notes"
        action={saveBookingNotesAction}
        hidden={{ bookingId }}
        submit="Save notes & sharing"
        fields={[
          {
            name: "learningGoal",
            label: "Learning goal",
            type: "textarea",
            wide: true,
            maxLength: 500,
            value: notes?.learningGoal ?? "",
          },
          {
            name: "topics",
            label: "Topics",
            wide: true,
            maxLength: 800,
            value: notes?.topics.join(", ") ?? "",
            hint: "Separate topics with commas.",
          },
          {
            name: "questions",
            label: "Questions for the session",
            type: "textarea",
            wide: true,
            maxLength: 2000,
            value: notes?.questions ?? "",
          },
          {
            name: "shareWithTutor",
            label: "Share this goal, topics and questions with the tutor on this booking",
            type: "checkbox",
            wide: true,
            checked: notes?.shareWithTutor ?? false,
          },
          {
            name: "privateNote",
            label: "Private note — only you",
            type: "textarea",
            wide: true,
            maxLength: 1000,
            value: notes?.privateNote ?? "",
          },
        ]}
      />
    </Section>
  );
}
