import { TEACHING_LANGUAGES, languageLabel } from "@/lib/languages";
import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import { readOwnProfile } from "@/domains/profiles/service";
import { readOwnTutorListing, listSubjects, listOwnAvailability } from "@/domains/marketplace/service";
import { TIME_ZONES } from "@/lib/time-zones";
import { WorkspaceHeading, WorkspaceError, Section, EmptyState, Status } from "@/components/workspace/ui";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import {
  saveListingAction,
  publicationAction,
  availabilityAction,
  exceptionAction,
  deleteAvailabilityAction,
  tutorLanguagesAction,
} from "./actions";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TutorStudioPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  if (!hasRole(actor, "tutor"))
    return (
      <Section title="Tutor capability is needed">
        <p>Ask an administrator to add Tutor capability before creating a public teaching profile.</p>
        <Link className="button secondary" href="/profile">
          Your account
        </Link>
      </Section>
    );
  const loaded = await loadWorkspace(async () => {
    const [listing, subjects, profile] = await Promise.all([
      readOwnTutorListing(client),
      listSubjects(client),
      readOwnProfile(client),
    ]);
    const schedule = listing ? await listOwnAvailability(client, listing.id) : { rules: [], exceptions: [] };
    const fields: WorkflowField[] = [
      {
        name: "publicDisplayName",
        label: "Public name",
        required: true,
        value: listing?.publicDisplayName ?? profile.display_name,
        maxLength: 80,
      },
      { name: "headline", label: "Teaching headline", required: true, value: listing?.headline ?? "", maxLength: 160 },
      {
        name: "bio",
        label: "About your teaching",
        type: "textarea",
        wide: true,
        required: true,
        value: listing?.bio ?? "",
        maxLength: 5000,
        hint: "Help adult learners understand your approach and the support you offer.",
      },
      {
        name: "credentialsText",
        label: "Qualifications & experience",
        type: "textarea",
        wide: true,
        value: listing?.credentialsText ?? "",
        maxLength: 3000,
      },
      {
        name: "experienceYears",
        label: "Years of experience",
        type: "number",
        required: true,
        min: 0,
        max: 80,
        value: String(listing?.experienceYears ?? 0),
      },
      {
        name: "hourlyRate",
        label: "Base hourly rate",
        type: "number",
        min: 0.01,
        step: 0.01,
        value: listing?.hourlyRateMinor != null ? String(listing.hourlyRateMinor / 100) : "",
        hint: "Enter currency units, such as 25.00. Subject overrides are below.",
      },
      {
        name: "currency",
        label: "Currency",
        type: "select",
        required: true,
        value: listing?.currency ?? "USD",
        options: [{ value: "USD", label: "USD — US dollar" }],
      },
      {
        name: "publicAvatarUrl",
        label: "Public photo URL",
        type: "url",
        value: listing?.publicAvatarUrl ?? "",
        hint: "Use an HTTPS image you are allowed to share.",
      },
      {
        name: "supportsVirtual",
        label: "I teach virtual sessions",
        type: "checkbox",
        checked: listing?.supportsVirtual ?? true,
      },
      {
        name: "supportsInPerson",
        label: "I teach in-person sessions",
        type: "checkbox",
        checked: listing?.supportsInPerson ?? false,
      },
      {
        name: "serviceAreaLabel",
        label: "Public service area",
        value: listing?.serviceAreaLabel ?? "",
        hint: "A city or neighborhood. Keep your precise meeting address private.",
      },
      {
        name: "serviceRadiusKm",
        label: "Travel radius (km)",
        type: "number",
        min: 1,
        max: 500,
        step: 0.1,
        value: listing?.serviceRadiusKm?.toString() ?? "",
      },
      {
        name: "latitude",
        label: "Approximate area latitude",
        type: "number",
        min: -90,
        max: 90,
        step: 0.001,
        value: listing?.location?.latitude.toString() ?? "",
        hint: "Used only for distance filtering. Enter a city-level point.",
      },
      {
        name: "longitude",
        label: "Approximate area longitude",
        type: "number",
        min: -180,
        max: 180,
        step: 0.001,
        value: listing?.location?.longitude.toString() ?? "",
      },
      {
        name: "subjectIds",
        label: "Subjects you teach",
        type: "choices",
        wide: true,
        options: subjects.map((s) => ({ value: s.id, label: s.name })),
        selected: listing?.offerings.map((s) => s.subjectId) ?? [],
      },
      ...subjects.flatMap((subject): WorkflowField[] => {
        const offering = listing?.offerings.find((o) => o.subjectId === subject.id);
        return [
          {
            name: `expertise:${subject.id}`,
            label: `${subject.name} — expertise`,
            value: offering?.expertise ?? "",
            maxLength: 500,
            hint: "Only saved when this subject is selected above.",
          },
          {
            name: `rate:${subject.id}`,
            label: `${subject.name} — hourly override`,
            type: "number",
            min: 0.01,
            step: 0.01,
            value: offering?.rateOverrideMinor ? String(offering.rateOverrideMinor / 100) : "",
            hint: "Leave blank to use your base hourly rate.",
          },
        ];
      }),
    ];
    const zones = TIME_ZONES.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
    return { listing, profile, schedule, fields, zones };
  });
  if (!loaded.ok) return <WorkspaceError title="Tutor studio" error={loaded.error} />;
  const { listing, profile, schedule, fields, zones } = loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Your teaching practice"
        title="Tutor studio."
        description="Shape your public teaching profile, choose your subjects and share the hours that work for you."
      >
        {listing?.publicationState === "published" && (
          <Link className="button secondary" href={`/tutors/${listing.id}`}>
            View public profile ↗
          </Link>
        )}
      </WorkspaceHeading>
      <div className="workspace-grid">
        <Section title="Your public listing" eyebrow="01 · Profile & subjects">
          <p>
            These details become public when you publish. Your account email and private learning information stay in
            your account.
          </p>
          <WorkflowForm
            title="Save tutor listing"
            action={saveListingAction}
            fields={fields}
            hidden={{ listingId: listing?.id ?? "", expectedVersion: listing ? String(listing.version) : "" }}
            submit="Save listing"
          />
        </Section>
        <div className="workspace-stack">
          <Section title="Publication" eyebrow="02 · Go live">
            <Status>{listing?.publicationState.replaceAll("_", " ") ?? "No listing yet"}</Status>
            <p>
              Save your listing, add at least one subject and valid availability, then publish. Readiness is checked
              again when you publish.
            </p>
            {listing ? (
              <WorkflowForm
                title="Change publication"
                action={publicationAction}
                hidden={{ listingId: listing.id }}
                submit="Save publication"
                fields={[
                  {
                    name: "state",
                    label: "Listing visibility",
                    type: "select",
                    required: true,
                    value: listing.publicationState === "review_ready" ? "draft" : listing.publicationState,
                    options: [
                      { value: "draft", label: "Draft — visible only to you" },
                      { value: "published", label: "Published — available to students" },
                      { value: "paused", label: "Paused — hide from discovery" },
                    ],
                  },
                ]}
              />
            ) : (
              <p className="hint">Save your first listing to manage publication.</p>
            )}
          </Section>
          {listing && (
            <Section title="Teaching languages">
              <p>
                {listing.languages?.length
                  ? listing.languages.map(languageLabel).join(" · ")
                  : "No teaching languages are saved yet."}
              </p>
              <details className="workspace-details">
                <summary>Choose the languages you teach in</summary>
                <WorkflowForm
                  title="Save tutor teaching languages"
                  action={tutorLanguagesAction}
                  hidden={{ listingId: listing.id, expectedVersion: String(listing.version) }}
                  submit="Save teaching languages"
                  fields={[
                    {
                      name: "languages",
                      label: "Teaching languages",
                      type: "choices",
                      wide: true,
                      options: TEACHING_LANGUAGES,
                      selected: listing.languages ?? [],
                    },
                    {
                      name: "otherLanguages",
                      label: "Other language tags",
                      wide: true,
                      value: (listing.languages ?? [])
                        .filter((tag) => !TEACHING_LANGUAGES.some((language) => language.value === tag))
                        .join(", "),
                      hint: "Optional BCP-47 tags, separated by commas, such as en-GB or sw.",
                    },
                  ]}
                />
              </details>
            </Section>
          )}
          <Section title="Weekly availability" eyebrow="03 · Your schedule">
            {!listing ? (
              <EmptyState title="Start with your listing">
                Save your public profile first, then add the hours you teach.
              </EmptyState>
            ) : (
              <>
                <p>Hours use the time zone you choose. Existing reservations keep their own saved time and status.</p>
                <ul className="workspace-records">
                  {schedule.rules.map((rule) => (
                    <li className="workspace-record" key={rule.id}>
                      <strong>
                        {WEEKDAYS[rule.weekday]} · {rule.localStart.slice(0, 5)}–{rule.localEnd.slice(0, 5)}
                      </strong>
                      <p className="hint">
                        {rule.timezone} · From {rule.validFrom}
                        {rule.validUntil ? ` through ${rule.validUntil}` : ""}
                      </p>
                      <WorkflowForm
                        title="Remove weekly hours"
                        action={deleteAvailabilityAction}
                        hidden={{ listingId: listing.id, id: rule.id, kind: "rule" }}
                        submit="Remove hours"
                      />
                    </li>
                  ))}
                </ul>
                <details className="workspace-details" open={!schedule.rules.length}>
                  <summary>Add weekly hours</summary>
                  <WorkflowForm
                    title="Add weekly availability"
                    action={availabilityAction}
                    hidden={{ listingId: listing.id }}
                    submit="Add weekly hours"
                    fields={[
                      {
                        name: "weekday",
                        label: "Day",
                        type: "select",
                        required: true,
                        options: WEEKDAYS.map((day, i) => ({ value: String(i), label: day })),
                      },
                      {
                        name: "timezone",
                        label: "Time zone",
                        type: "select",
                        required: true,
                        value: profile.timezone,
                        options: zones,
                      },
                      { name: "localStart", label: "Start time", type: "time", required: true },
                      { name: "localEnd", label: "End time", type: "time", required: true },
                      {
                        name: "validFrom",
                        label: "Available from",
                        type: "date",
                        required: true,
                        value: new Date().toISOString().slice(0, 10),
                      },
                      { name: "validUntil", label: "Available until", type: "date" },
                    ]}
                  />
                </details>
              </>
            )}
          </Section>
          {listing && (
            <Section title="Date-specific changes">
              <ul className="workspace-records">
                {schedule.exceptions.map((exception) => (
                  <li className="workspace-record" key={exception.id}>
                    <strong>
                      {exception.localDate} · {exception.exceptionType === "additional" ? "Extra hours" : "Unavailable"}
                    </strong>
                    <p className="hint">
                      {exception.localStart
                        ? `${exception.localStart.slice(0, 5)}–${exception.localEnd?.slice(0, 5)}`
                        : "All day"}{" "}
                      · {exception.timezone}
                    </p>
                    <WorkflowForm
                      title="Remove date exception"
                      action={deleteAvailabilityAction}
                      hidden={{ listingId: listing.id, id: exception.id, kind: "exception" }}
                      submit="Remove exception"
                    />
                  </li>
                ))}
              </ul>
              <details className="workspace-details">
                <summary>Add a date-specific change</summary>
                <WorkflowForm
                  title="Add date exception"
                  action={exceptionAction}
                  hidden={{ listingId: listing.id }}
                  submit="Save date change"
                  fields={[
                    { name: "localDate", label: "Date", type: "date", required: true },
                    {
                      name: "exceptionType",
                      label: "Change",
                      type: "select",
                      required: true,
                      value: "unavailable",
                      options: [
                        { value: "unavailable", label: "Unavailable" },
                        { value: "additional", label: "Additional hours" },
                      ],
                    },
                    {
                      name: "timezone",
                      label: "Time zone",
                      type: "select",
                      required: true,
                      value: profile.timezone,
                      options: zones,
                      wide: true,
                    },
                    {
                      name: "localStart",
                      label: "Start time",
                      type: "time",
                      hint: "Leave both times blank for all-day unavailability.",
                    },
                    { name: "localEnd", label: "End time", type: "time" },
                    { name: "reason", label: "Private note", type: "textarea", wide: true, maxLength: 1000 },
                  ]}
                />
              </details>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
