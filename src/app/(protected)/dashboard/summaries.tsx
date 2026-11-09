import Link from "next/link";
import type { UserClient } from "@/lib/supabase/server";
import type { Actor } from "@/domains/auth/policy";
import { hasRole } from "@/domains/auth/policy";
import { getLearningWorkspace, getLearningProgress } from "@/domains/learning/service";
import {
  readOwnTutorListing,
  listOwnAvailability,
  listSavedTutors,
  readOwnTutorBadgeProgress,
} from "@/domains/marketplace/service";
import { listActorBookings } from "@/domains/bookings/service";
import { listResources } from "@/domains/platform/service";
import { loadWorkspace } from "@/components/workspace/load";
import { Section, Status, formatDate, formatInstant } from "@/components/workspace/ui";
import { safeMessage } from "@/domains/shared/errors";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { unsaveTutorAction } from "./actions";

export async function DashboardSummaries({ client, actor }: { client: UserClient; actor: Actor }) {
  const student = hasRole(actor, "student"),
    tutor = hasRole(actor, "tutor");
  if (!student && !tutor) return null;
  const [learning, progress, resources, schedule, bookings, savedTutors, badges] = await Promise.all([
    loadWorkspace(() => getLearningWorkspace(client)),
    student ? loadWorkspace(() => getLearningProgress(client, actor.id)) : Promise.resolve(null),
    loadWorkspace(() => listResources(client)),
    tutor
      ? loadWorkspace(async () => {
          const listing = await readOwnTutorListing(client);
          return { listing, schedule: listing ? await listOwnAvailability(client, listing.id) : null };
        })
      : Promise.resolve(null),
    loadWorkspace(() => listActorBookings(client)),
    student ? loadWorkspace(() => listSavedTutors(client)) : Promise.resolve(null),
    tutor ? loadWorkspace(() => readOwnTutorBadgeProgress(client)) : Promise.resolve(null),
  ]);
  const work = learning.ok ? learning.value : null;
  const upcoming = bookings.ok
    ? bookings.value
        .filter(
          (booking) =>
            ["confirmed", "in_progress"].includes(booking.status) && Date.parse(booking.ends_at) > new Date().getTime(),
        )
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .slice(0, 3)
    : [];
  const ownedTutorIds = new Set(
    work?.relationships.filter((row) => row.studentId !== actor.id).map((row) => row.tutorId) ?? [],
  );
  const dueWork = work
    ? [
        ...work.assessments
          .filter(
            (item) =>
              item.status === "assigned" &&
              item.due_at &&
              (student ? item.student_id === actor.id : ownedTutorIds.has(item.tutor_id)),
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            due: item.due_at!,
            href: `/assessments/${item.id}`,
            kind: "Assessment",
          })),
        ...work.assignments
          .filter(
            (item) =>
              ["assigned", "returned"].includes(item.status) &&
              (student ? item.student_id === actor.id : ownedTutorIds.has(item.tutor_id)),
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            due: item.due_at,
            href: `/assignments/${item.id}`,
            kind: "Assignment",
          })),
      ].sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
    : [];
  const results = progress?.ok
    ? progress.value.assessments
        .flatMap(({ assessment, attempts }) =>
          attempts.filter((attempt) => attempt.status === "scored").map((attempt) => ({ assessment, attempt })),
        )
        .sort((a, b) => Date.parse(b.attempt.scored_at ?? "") - Date.parse(a.attempt.scored_at ?? ""))
        .slice(0, 3)
    : [];
  const reviewQueue = work
    ? [
        ...work.assessments
          .filter((item) => item.status === "submitted" && ownedTutorIds.has(item.tutor_id))
          .map((item) => ({
            id: item.id,
            title: item.title,
            kind: "Assessment attempt awaiting scoring",
            href: `/assessments/${item.id}`,
          })),
        ...work.assignments
          .filter((item) => item.status === "submitted" && ownedTutorIds.has(item.tutor_id))
          .map((item) => ({
            id: item.id,
            title: item.title,
            kind: "Submission awaiting feedback",
            href: `/assignments/${item.id}`,
          })),
      ]
    : [];
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div className="workspace-grid equal" aria-label="Your current learning" style={{ marginBlock: "1.5rem" }}>
      <Section title="Upcoming & current sessions">
        {!bookings.ok ? (
          <ReadError error={bookings.error} />
        ) : upcoming.length ? (
          <ul className="workspace-records">
            {upcoming.map((booking) => {
              const relation = work?.relationships.find((item) => item.bookingId === booking.id);
              return (
                <li className="workspace-record" key={booking.id}>
                  <Link className="small-link" href={`/sessions/${booking.id}`}>
                    {relation?.subjectName ?? "Tutoring session"} ·{" "}
                    {relation
                      ? booking.student_id === actor.id
                        ? relation.tutorName
                        : relation.studentName
                      : booking.id.slice(0, 8)}{" "}
                    →
                  </Link>
                  <p className="hint">
                    {formatInstant(booking.starts_at)} – {formatInstant(booking.ends_at)}
                  </p>
                  <Status>{booking.status}</Status>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No upcoming or current confirmed session appears in your booking record.</p>
        )}
        <Link className="small-link" href="/bookings">
          All bookings →
        </Link>
      </Section>
      <Section title="Active study plans">
        {!learning.ok ? (
          <ReadError error={learning.error} />
        ) : work?.studyPlans.filter((plan) => plan.status === "active").length ? (
          <ul className="workspace-records">
            {work.studyPlans
              .filter((plan) => plan.status === "active")
              .slice(0, 3)
              .map((plan) => (
                <li className="workspace-record" key={plan.id}>
                  <Link className="small-link" href={`/study-plans/${plan.id}`}>
                    {plan.title} →
                  </Link>
                  <p className="hint">
                    Revision {plan.current_revision} · Updated {formatInstant(plan.updated_at)}
                  </p>
                </li>
              ))}
          </ul>
        ) : (
          <p>No active study plan is saved yet.</p>
        )}
        <Link className="small-link" href="/study-plans">
          All study plans →
        </Link>
      </Section>
      <Section title={tutor && !student ? "Learner deadlines" : "Learning deadlines"}>
        {!learning.ok ? (
          <ReadError error={learning.error} />
        ) : dueWork.length ? (
          <ul className="workspace-records">
            {dueWork.slice(0, 3).map((item) => (
              <li className="workspace-record" key={item.id}>
                <Link className="small-link" href={item.href}>
                  {item.title} →
                </Link>
                <p className="hint">
                  {item.kind} · Due {formatInstant(item.due)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No assigned work with a deadline appears in your current workspace.</p>
        )}
        <Link className="small-link" href="/learning">
          Open learning desk →
        </Link>
      </Section>
      {student && (
        <Section title="Recent learning results">
          {progress && !progress.ok ? (
            <ReadError error={progress.error} />
          ) : results.length ? (
            <ul className="workspace-records">
              {results.map(({ assessment, attempt }) => (
                <li className="workspace-record" key={attempt.id}>
                  <Link className="small-link" href={`/assessments/${assessment.id}`}>
                    {assessment.title} →
                  </Link>
                  <p>
                    {attempt.score}/{attempt.max_score} assessment points
                  </p>
                  <p className="hint">
                    Scored {formatInstant(attempt.scored_at)} · Attempt {attempt.attempt_no}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No scored assessment result is saved yet.</p>
          )}
          {progress?.ok &&
            progress.value.topicEvidence.slice(0, 2).map((item) => (
              <p key={item.id}>
                <Status>{item.label}</Status> {item.topic} · {formatDate(item.observed_at)}
              </p>
            ))}
          <p className="hint">Assessment points and explicit tutor observations stay separate.</p>
          <Link className="small-link" href="/progress">
            Dated progress & topic evidence →
          </Link>
        </Section>
      )}
      {tutor && (
        <Section title="Awaiting your review">
          {!learning.ok ? (
            <ReadError error={learning.error} />
          ) : reviewQueue.length ? (
            <ul className="workspace-records">
              {reviewQueue.slice(0, 4).map((item) => (
                <li className="workspace-record" key={item.id}>
                  <Link className="small-link" href={item.href}>
                    {item.title} →
                  </Link>
                  <p className="hint">{item.kind}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No submitted work is awaiting review in your current workspace.</p>
          )}
          <Link className="small-link" href="/learning">
            Open learner work →
          </Link>
        </Section>
      )}
      {student && (
        <Section title="Saved tutors">
          {savedTutors && !savedTutors.ok ? (
            <ReadError error={savedTutors.error} />
          ) : savedTutors?.ok && savedTutors.value.length ? (
            <ul className="workspace-records">
              {savedTutors.value.slice(0, 3).map((item) => (
                <li className="workspace-record" key={item.id}>
                  <Link className="small-link" href={`/tutors/${item.id}`}>
                    {item.publicDisplayName} →
                  </Link>
                  <p>{item.headline}</p>
                  <WorkflowForm
                    title={`Remove saved tutor ${item.publicDisplayName}`}
                    action={unsaveTutorAction}
                    hidden={{ tutorId: item.id }}
                    submit="Remove saved tutor"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p>No currently public tutor is saved to your account.</p>
          )}
          <Link className="small-link" href="/tutors">
            Find and save a tutor →
          </Link>
          <p>
            <Link className="small-link" href="/saved-tutors">
              Open your saved tutor list →
            </Link>
          </p>
        </Section>
      )}
      {tutor && (
        <Section title="Badge progress from platform facts">
          {badges && !badges.ok ? (
            <ReadError error={badges.error} />
          ) : badges?.ok && badges.value ? (
            <>
              <p className="hint">
                Published policy version {badges.value.policyVersion}. Badges describe platform records.
              </p>
              <ul className="workspace-records">
                {badges.value.thresholds.map((rule) => {
                  const current = badges.value!.facts[rule.fact];
                  return (
                    <li className="workspace-record" key={rule.fact}>
                      <h3>{rule.label}</h3>
                      <p>
                        {rule.fact.replaceAll("_", " ")}: {current === null ? "No recorded average" : current} ·
                        Required {rule.threshold}
                      </p>
                      <Status>{current !== null && current >= rule.threshold ? "Threshold met" : "In progress"}</Status>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p>A saved tutor listing is needed to show its factual badge progress.</p>
          )}
        </Section>
      )}
      {tutor && (
        <Section title="Your teaching schedule">
          {schedule && !schedule.ok ? (
            <ReadError error={schedule.error} />
          ) : schedule?.ok && schedule.value.listing ? (
            <>
              <p>
                <Status>{schedule.value.listing.publicationState}</Status> {schedule.value.listing.publicDisplayName}
              </p>
              {schedule.value.schedule?.rules.filter((rule) => rule.active).length ? (
                <ul>
                  {schedule.value.schedule.rules
                    .filter((rule) => rule.active)
                    .slice(0, 3)
                    .map((rule) => (
                      <li key={rule.id}>
                        {weekdays[rule.weekday]} · {rule.localStart.slice(0, 5)}–{rule.localEnd.slice(0, 5)}{" "}
                        {rule.timezone}
                      </li>
                    ))}
                </ul>
              ) : (
                <p>No active weekly availability is saved.</p>
              )}
            </>
          ) : (
            <p>No tutor listing is saved yet.</p>
          )}
          <Link className="small-link" href="/tutor-studio">
            Manage schedule & publication →
          </Link>
        </Section>
      )}
      <Section title="Curated learning resources">
        {!resources.ok ? (
          <ReadError error={resources.error} />
        ) : resources.value.length ? (
          <ul className="workspace-records">
            {resources.value.slice(0, 3).map((resource) => (
              <li className="workspace-record" key={resource.id}>
                <Link className="small-link" href={`/resources?resource=${resource.id}`}>
                  {resource.title} →
                </Link>
                <p className="hint">{resource.attribution ?? resource.resourceType}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No active curated resources are available yet.</p>
        )}
        <Link className="small-link" href="/resources">
          Browse the resource library →
        </Link>
      </Section>
    </div>
  );
}
function ReadError({ error }: { error: unknown }) {
  return (
    <p className="notice warning" role="alert">
      {safeMessage(error)}
    </p>
  );
}
