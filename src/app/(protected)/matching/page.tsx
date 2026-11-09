import { TEACHING_LANGUAGES, languageLabel } from "@/lib/languages";
import { TEACHING_METHODS } from "@/lib/teaching-methods";
import { describeTutorBadge } from "@/lib/badge-presentation";
import { hasRole } from "@/domains/auth/policy";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { listSubjects, matchTutors } from "@/domains/marketplace/service";
import { formatMoney } from "@/domains/bookings/presentation";
import type { TutorMatchPage, TutorMatchInput } from "@/domains/marketplace/types";
import { InputError, safeMessage } from "@/domains/shared/errors";
import { DateTimeField } from "@/components/date-time-field";
import { TutorAvatar } from "@/components/workspace/tutor-avatar";
import { WorkspaceHeading, Section, EmptyState, Status } from "@/components/workspace/ui";
import { resolveDiscoveryLocation } from "@/app/tutors/location";
import type { DiscoveryQuery } from "@/app/tutors/filters";
export default async function MatchingPage({ searchParams }: { searchParams: Promise<DiscoveryQuery> }) {
  if (!publicConfig()) return null;
  const { client, actor } = await protectedContext();
  if (!hasRole(actor, "student"))
    return (
      <>
        <WorkspaceHeading
          eyebrow="A match you can understand"
          title="Tutor matching."
          description="Student capability is needed to request a tutor match."
        />
        <Section title="Explore teaching profiles">
          <p>You can browse published tutor profiles without creating a matching intake.</p>
          <Link className="button secondary" href="/tutors">
            Browse tutors →
          </Link>
        </Section>
      </>
    );
  const query = await searchParams;
  const read = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const selectedMethods = (Array.isArray(query.strategies) ? query.strategies : [read("strategies")]).filter(Boolean);
  let subjects: Awaited<ReturnType<typeof listSubjects>> = [];
  let results: TutorMatchPage | null = null;
  let failure: string | null = null;
  try {
    subjects = await listSubjects(client);
    if (read("run") === "1") {
      for (const key of [
        "subject",
        "mode",
        "rate",
        "availableAt",
        "duration",
        "topic",
        "level",
        "goal",
        "page",
        "language",
        "otherLanguage",
        "latitude",
        "longitude",
        "radius",
        "city",
        "region",
        "postal",
        "country",
        "geocode",
        "run",
      ])
        if (Array.isArray(query[key])) throw new InputError({ [key]: "Choose one value for each matching field." });
      const resolved = await resolveDiscoveryLocation(client, query);
      const value = (key: string) => (typeof resolved[key] === "string" ? (resolved[key] as string) : "");
      const mode = value("mode");
      if (mode !== "virtual" && mode !== "in_person")
        throw new InputError({ mode: "Choose virtual or in-person sessions." });
      const geo = [value("latitude"), value("longitude"), value("radius")];
      if (geo.some(Boolean) && !geo.every(Boolean))
        throw new InputError({ location: "Enter a complete location and radius before matching." });
      const input: TutorMatchInput = {
        subjectId: value("subject"),
        mode,
        maxHourlyRateMinor: Math.round(Number(value("rate")) * 100),
        availableAt: value("availableAt"),
        durationMinutes: Number(value("duration")),
        languageTags: [value("language"), ...value("otherLanguage").split(/[,\n]/)]
          .map((value) => value.trim())
          .filter(Boolean),
        preferredStrategies: selectedMethods,
        page: value("page") ? Number(value("page")) : 1,
        pageSize: 10,
        location: geo.every(Boolean)
          ? { latitude: Number(geo[0]), longitude: Number(geo[1]), radiusKm: Number(geo[2]) }
          : undefined,
        topic: value("topic") || undefined,
        level: value("level") || undefined,
        learningGoal: value("goal") || undefined,
      };
      results = await matchTutors(client, input);
    }
  } catch (error) {
    failure = error instanceof InputError ? Object.values(error.fields).join(" ") : safeMessage(error);
  }
  const pageLink = (page: number) => {
    const next = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (typeof value === "string") next.set(key, value);
      if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
    });
    next.set("page", String(page));
    return `/matching?${next}`;
  };
  return (
    <>
      <WorkspaceHeading
        eyebrow="A match you can understand"
        title="Find support for your next goal."
        description="Set your subject, session time, budget and preferences. Only tutors who meet the hard requirements are ranked, with the factors shown for every result."
      />
      <Section title="Your learning intake">
        <form method="get" action="/matching" className="form">
          <input type="hidden" name="run" value="1" />
          <div className="workflow-fields">
            <div className="field">
              <label htmlFor="match-subject">Subject</label>
              <select id="match-subject" name="subject" required defaultValue={read("subject")}>
                <option value="">Choose a subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="match-topic">Topic</label>
              <input
                id="match-topic"
                name="topic"
                maxLength={120}
                defaultValue={read("topic")}
                placeholder="For example, factoring"
              />
            </div>
            <div className="field">
              <label htmlFor="match-level">Your starting level</label>
              <select id="match-level" name="level" defaultValue={read("level")}>
                <option value="">Not specified</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="match-goal">Learning goal</label>
              <input
                id="match-goal"
                name="goal"
                maxLength={200}
                defaultValue={read("goal")}
                placeholder="For example, solve four of five practice questions"
              />
            </div>
            <div className="field">
              <label htmlFor="match-mode">Teaching mode</label>
              <select id="match-mode" name="mode" required defaultValue={read("mode") || "virtual"}>
                <option value="virtual">Virtual</option>
                <option value="in_person">In person</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="match-rate">Maximum per hour (USD)</label>
              <input
                id="match-rate"
                name="rate"
                type="number"
                min="0.01"
                step=".01"
                required
                defaultValue={read("rate")}
              />
            </div>
            <DateTimeField
              name="availableAt"
              label="Session start"
              hint="Enter a specific start time in UTC. This search does not reserve the slot."
              defaultValue={read("availableAt")}
            />
            <div className="field">
              <label htmlFor="match-duration">Duration</label>
              <select id="match-duration" name="duration" required defaultValue={read("duration") || "60"}>
                {[15, 30, 45, 60, 90, 120, 180].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="match-language">Teaching language</label>
              <select id="match-language" name="language" defaultValue={read("language")}>
                <option value="">Any listed language</option>
                {TEACHING_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="match-other-language">Other language tags</label>
              <input
                id="match-other-language"
                name="otherLanguage"
                defaultValue={read("otherLanguage")}
                maxLength={200}
              />
              <span className="hint">
                Optional BCP-47 tags, separated by commas. A tutor must list at least one selected tag.
              </span>
            </div>
            <div className="field field-wide">
              <fieldset className="workflow-choices" aria-describedby="match-strategies-help">
                <legend>Teaching methods (optional)</legend>
                {TEACHING_METHODS.map((method) => (
                  <label className="checkbox" key={method}>
                    <input
                      type="checkbox"
                      name="strategies"
                      value={method}
                      defaultChecked={selectedMethods.includes(method)}
                    />
                    <span>{method[0].toUpperCase() + method.slice(1)}</span>
                  </label>
                ))}
              </fieldset>
              <span className="hint" id="match-strategies-help">
                A selected method affects ranking only when a public teaching fact supports it. Topic, level and goal
                are unscored context.
              </span>
            </div>
          </div>
          <details className="workspace-details" open={!!(read("city") || read("radius") || read("latitude"))}>
            <summary>Optional location & travel radius</summary>
            <div className="workflow-fields">
              {[
                ["city", "City or place"],
                ["region", "State or region"],
                ["postal", "Postal code"],
                ["country", "Country code"],
              ].map(([name, label]) => (
                <div className="field" key={name}>
                  <label htmlFor={`match-${name}`}>{label}</label>
                  <input
                    id={`match-${name}`}
                    name={name}
                    defaultValue={read(name)}
                    maxLength={name === "country" ? 2 : 100}
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor="match-radius">Radius (km)</label>
                <input id="match-radius" name="radius" type="number" min="1" max="1000" defaultValue={read("radius")} />
              </div>
              <div className="field">
                <label htmlFor="match-latitude">Approximate latitude</label>
                <input
                  id="match-latitude"
                  name="latitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  defaultValue={read("latitude")}
                />
              </div>
              <div className="field">
                <label htmlFor="match-longitude">Approximate longitude</label>
                <input
                  id="match-longitude"
                  name="longitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  defaultValue={read("longitude")}
                />
              </div>
            </div>
            <p className="hint">
              Use a place and country, or enter approximate coordinates directly. A failed location lookup keeps the
              radius and returns an error.
            </p>
          </details>
          <button type="submit" className="button primary">
            Find eligible matches →
          </button>
        </form>
      </Section>
      {failure && (
        <div role="alert" className="notice warning" style={{ marginTop: "1.5rem" }}>
          {failure}
        </div>
      )}
      {results && (
        <section style={{ marginTop: "1.5rem" }} aria-label="Explainable matching results">
          <div className="workspace-record-head">
            <p>
              {results.items.length} eligible tutors on this page · Published factor version {results.factorVersion}
            </p>
            <Link className="small-link" href="/tutors">
              Browse all published tutors →
            </Link>
          </div>
          {!results.items.length ? (
            <EmptyState title="No tutor meets all these requirements">
              Change the time, budget, subject or location. Your hard requirements remain in the intake above.
            </EmptyState>
          ) : (
            <div className="tutor-grid">
              {results.items
                .filter((match) => match.eligible)
                .map((match) => (
                  <article key={match.tutor.id} className="panel workspace-section">
                    <div className="tutor-identity">
                      <TutorAvatar name={match.tutor.publicDisplayName} url={match.tutor.publicAvatarUrl} />
                      <div>
                        <h2>{match.tutor.publicDisplayName}</h2>
                        <p>{match.tutor.headline}</p>
                        <p className="hint">
                          {match.tutor.languages?.map(languageLabel).join(" · ") || "Languages not specified"}
                        </p>
                      </div>
                    </div>
                    <p>
                      <strong>
                        {formatMoney(
                          match.tutor.offerings.find((offer) => offer.subjectId === read("subject"))?.hourlyRateMinor ??
                            match.tutor.hourlyRateMinor,
                          match.tutor.currency,
                        )}{" "}
                        / hour
                      </strong>
                    </p>
                    <ul>
                      {match.eligibilityFacts.map((fact, index) => (
                        <li key={index}>{fact}</li>
                      ))}
                    </ul>
                    <p className="hint">Availability is checked again when requesting a reservation.</p>
                    <ul className="tutor-subjects">
                      {(match.tutor.badges ?? []).map((badge) => (
                        <li key={badge.key}>
                          <Status>{badge.label}</Status>
                          <p className="hint">{describeTutorBadge(badge)}</p>
                        </li>
                      ))}
                    </ul>
                    <details className="workspace-details">
                      <summary>Why this tutor appears here</summary>
                      <p>
                        Ranking score {match.score.toFixed(2)} · Factor version {match.factorVersion}. This is a
                        comparison using the factors below, not a claim of an objectively best tutor.
                      </p>
                      <ul className="workspace-records">
                        {match.factors.map((factor) => (
                          <li key={factor.key} className="workspace-record">
                            <strong>{factor.label}</strong>
                            <p>{factor.fact ?? "No supporting public fact"}</p>
                            <p className="hint">
                              {factor.rationale} · Weight {factor.weight} · Factor score {factor.score.toFixed(2)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                    <div className="workspace-actions">
                      <Link className="button primary compact" href={`/bookings?tutor=${match.tutor.id}`}>
                        Choose this tutor →
                      </Link>
                      <Link className="small-link" href={`/tutors/${match.tutor.id}`}>
                        Read public profile ↗
                      </Link>
                    </div>
                  </article>
                ))}
            </div>
          )}
          <nav className="workspace-actions" aria-label="Matching result pages" style={{ marginTop: "1.5rem" }}>
            {results.page > 1 && (
              <Link className="button secondary" href={pageLink(results.page - 1)}>
                Previous
              </Link>
            )}
            {results.hasMore && (
              <Link className="button secondary" href={pageLink(results.page + 1)}>
                Next eligible matches →
              </Link>
            )}
          </nav>
        </section>
      )}
    </>
  );
}
