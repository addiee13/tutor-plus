import { TEACHING_LANGUAGES, languageLabel } from "@/lib/languages";
import { describeTutorBadge } from "@/lib/badge-presentation";
import { resolveDiscoveryLocation } from "./location";
import { TutorAvatar } from "@/components/workspace/tutor-avatar";
import Link from "next/link";
import { DateTimeField } from "@/components/date-time-field";
import { parseDiscoveryQuery, type DiscoveryQuery } from "./filters";
import { explainTutorMatches } from "@/domains/marketplace/matching";
import { PublicHeader, Footer, SetupNotice } from "@/components/shell";
import { publicConfig } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";
import { listSubjects, searchTutors } from "@/domains/marketplace/service";
import type { PublicTutorCard, TutorSearchFilters } from "@/domains/marketplace/types";
import { formatMoney } from "@/domains/bookings/presentation";
import { InputError, safeMessage } from "@/domains/shared/errors";
import { EmptyState } from "@/components/workspace/ui";

export const dynamic = "force-dynamic";
type Query = DiscoveryQuery;
const scalar = (query: Query, key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");

export default async function TutorsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const queryText = scalar(query, "q");
  const subjectId = scalar(query, "subject");
  const mode = scalar(query, "mode");
  const rate = scalar(query, "rate");
  const minRate = scalar(query, "minRate");
  const rating = scalar(query, "rating");
  const latitude = scalar(query, "latitude"),
    longitude = scalar(query, "longitude"),
    radius = scalar(query, "radius");
  let filters: TutorSearchFilters = { page: 1, pageSize: 12 };
  let filterFailure: string | null = null;
  try {
    filters = parseDiscoveryQuery(
      publicConfig() ? await resolveDiscoveryLocation(await createUserClient(), query) : query,
    );
  } catch (error) {
    filterFailure = error instanceof InputError ? Object.values(error.fields).join(" ") : safeMessage(error);
  }
  let subjects: Awaited<ReturnType<typeof listSubjects>> = [];
  let results: Awaited<ReturnType<typeof searchTutors>> | null = null;
  let failure: string | null = filterFailure;
  if (publicConfig()) {
    try {
      const client = await createUserClient();
      [subjects, results] = await Promise.all([
        listSubjects(client),
        filterFailure ? Promise.resolve(null) : searchTutors(client, filters),
      ]);
    } catch (error) {
      failure = error instanceof InputError ? Object.values(error.fields).join(" ") : safeMessage(error);
    }
  }
  const matches = results
    ? explainTutorMatches(results.items, {
        subjectId: filters.subjectId,
        mode: filters.mode,
        maxHourlyRateMinor: filters.maxHourlyRateMinor,
        location: filters.near,
        startAt: filters.availableAt,
      }).filter((match) => match.eligible)
    : [];
  const pageLink = (page: number) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    });
    params.set("page", String(page));
    return `/tutors?${params}`;
  };
  return (
    <>
      <PublicHeader />
      <main id="main" className="container discovery-main">
        <section className="page-heading discovery-intro">
          <span className="eyebrow">Guidance that fits your goals</span>
          <h1>Find your tutor.</h1>
          <p>
            Explore adult learning support by subject, teaching mode and budget. Every profile here comes from a
            published tutor listing.
          </p>
        </section>
        {!publicConfig() ? (
          <SetupNotice />
        ) : (
          <>
            <p>
              <Link className="small-link" href="/matching">
                Match tutors to a specific learning goal →
              </Link>
            </p>
            <section className="panel discovery-search" aria-label="Filter tutors">
              <form action="/tutors" method="get">
                <div className="discovery-filters">
                  <div className="field">
                    <label htmlFor="q">Name or teaching keyword</label>
                    <input id="q" name="q" defaultValue={queryText} maxLength={100} />
                  </div>
                  <div className="field">
                    <label htmlFor="subject">Subject</label>
                    <select id="subject" name="subject" defaultValue={subjectId}>
                      <option value="">All subjects</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="mode">Teaching mode</label>
                    <select id="mode" name="mode" defaultValue={mode}>
                      <option value="">Any mode</option>
                      <option value="virtual">Virtual</option>
                      <option value="in_person">In person</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="min-rate">Minimum per hour (USD)</label>
                    <input
                      id="min-rate"
                      name="minRate"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      defaultValue={minRate}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="rate">Maximum per hour (USD)</label>
                    <input id="rate" name="rate" type="number" min="0" max="1000000" step="0.01" defaultValue={rate} />
                  </div>
                  <button type="submit" className="button primary">
                    Find tutors <span aria-hidden="true">→</span>
                  </button>
                </div>
                <details
                  className="workspace-details"
                  open={
                    !!(
                      rating ||
                      latitude ||
                      longitude ||
                      radius ||
                      scalar(query, "availableAt") ||
                      scalar(query, "sort")
                    )
                  }
                >
                  <summary>Availability, rating & nearby tutors</summary>
                  <div className="workflow-fields">
                    <div className="field">
                      <label htmlFor="language">Teaching language</label>
                      <select id="language" name="language" defaultValue={scalar(query, "language")}>
                        <option value="">Any listed language</option>
                        {TEACHING_LANGUAGES.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="other-language">Other language tags</label>
                      <input
                        id="other-language"
                        name="otherLanguage"
                        defaultValue={scalar(query, "otherLanguage")}
                        maxLength={200}
                      />
                      <span className="hint">
                        Optional BCP-47 tags, separated by commas. Tutors must list at least one selected tag.
                      </span>
                    </div>
                    <DateTimeField
                      name="availableAt"
                      label="Available at"
                      required={false}
                      defaultValue={scalar(query, "availableAt")}
                      hint="Choose a start time in UTC, together with a duration."
                    />
                    <div className="field">
                      <label htmlFor="duration">Session duration</label>
                      <select id="duration" name="duration" defaultValue={scalar(query, "duration")}>
                        <option value="">Any available time</option>
                        {[30, 45, 60, 90, 120].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} minutes
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="sort">Sort tutors</label>
                      <select id="sort" name="sort" defaultValue={scalar(query, "sort")}>
                        <option value="">Best match</option>
                        <option value="rating">Highest rating</option>
                        <option value="rate">Lowest base rate</option>
                        <option value="name">Name</option>
                        <option value="distance">Nearest — requires location</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="rating">Minimum rating</label>
                      <select id="rating" name="rating" defaultValue={rating}>
                        <option value="">Any rating</option>
                        <option value="4">4 stars or more</option>
                        <option value="3">3 stars or more</option>
                        <option value="5">5 stars</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="city">City or place</label>
                      <input id="city" name="city" defaultValue={scalar(query, "city")} maxLength={100} />
                    </div>
                    <div className="field">
                      <label htmlFor="region">State or region</label>
                      <input id="region" name="region" defaultValue={scalar(query, "region")} maxLength={100} />
                    </div>
                    <div className="field">
                      <label htmlFor="postal">Postal code</label>
                      <input id="postal" name="postal" defaultValue={scalar(query, "postal")} maxLength={20} />
                    </div>
                    <div className="field">
                      <label htmlFor="country">Country code</label>
                      <input
                        id="country"
                        name="country"
                        defaultValue={scalar(query, "country")}
                        maxLength={2}
                        placeholder="US"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="radius">Search radius (km)</label>
                      <input id="radius" name="radius" type="number" min="1" max="500" defaultValue={radius} />
                    </div>
                    <div className="field">
                      <label htmlFor="latitude">Your approximate latitude</label>
                      <input
                        id="latitude"
                        name="latitude"
                        type="number"
                        min="-90"
                        max="90"
                        step="any"
                        defaultValue={latitude}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="longitude">Your approximate longitude</label>
                      <input
                        id="longitude"
                        name="longitude"
                        type="number"
                        min="-180"
                        max="180"
                        step="any"
                        defaultValue={longitude}
                      />
                    </div>
                  </div>
                  <p className="hint">
                    Enter a city or postal code with a country and radius. Approximate coordinates can be entered
                    directly if location lookup is unavailable. Distance filters use a tutor’s public service area.
                  </p>
                </details>
              </form>
            </section>
            {failure ? (
              <div className="notice warning" role="alert">
                <strong>We couldn’t load tutor listings.</strong>
                <p>{failure}</p>
                <Link href="/tutors">Try again</Link>
              </div>
            ) : (
              results && (
                <>
                  <div className="workspace-record-head">
                    <p>
                      {results.items.length} tutor{results.items.length === 1 ? "" : "s"} on this page
                      {subjectId ? ` · ${subjects.find((s) => s.id === subjectId)?.name ?? "Selected subject"}` : ""}
                    </p>
                    <Link className="small-link" href="/tutors">
                      Clear filters
                    </Link>
                  </div>
                  {results.items.length ? (
                    <div className="tutor-grid">
                      {matches.map(({ tutor }) => (
                        <TutorResult key={tutor.id} tutor={tutor} filters={filters} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No tutors match these details">
                      Try a different subject, a wider budget or another teaching mode. Only published profiles appear
                      here.
                    </EmptyState>
                  )}
                  <nav className="workspace-actions" aria-label="Tutor result pages" style={{ marginTop: "2rem" }}>
                    {results.page > 1 && (
                      <Link className="button secondary" href={pageLink(results.page - 1)}>
                        Previous page
                      </Link>
                    )}
                    {results.hasMore && (
                      <Link className="button secondary" href={pageLink(results.page + 1)}>
                        Next page →
                      </Link>
                    )}
                  </nav>
                </>
              )
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function TutorResult({ tutor, filters }: { tutor: PublicTutorCard; filters: TutorSearchFilters }) {
  const relevant = filters.subjectId
    ? tutor.offerings.find((subject) => subject.subjectId === filters.subjectId)
    : null;
  return (
    <article className="panel workspace-section">
      <div className="tutor-identity">
        <TutorAvatar name={tutor.publicDisplayName} url={tutor.publicAvatarUrl} />
        <div>
          <h2>
            <Link href={`/tutors/${tutor.id}`}>{tutor.publicDisplayName}</Link>
          </h2>
          <p>{tutor.headline}</p>
        </div>
      </div>
      <p className="workspace-prose">{tutor.bio.length > 220 ? `${tutor.bio.slice(0, 220)}…` : tutor.bio}</p>
      <ul className="tutor-subjects">
        {(tutor.badges ?? []).map((badge) => (
          <li key={badge.key}>
            <span className="tag" title={describeTutorBadge(badge)}>
              {badge.label}
              <span className="visually-hidden"> · {describeTutorBadge(badge)}</span>
            </span>
          </li>
        ))}
        {tutor.offerings.map((subject) => (
          <li className="tag" key={subject.subjectId}>
            {subject.name}
          </li>
        ))}
      </ul>
      {tutor.recommendedCount > 0 && (
        <p className="hint">
          {tutor.recommendedCount} learner recommendation{tutor.recommendedCount === 1 ? "" : "s"} from visible reviews.
        </p>
      )}
      <p className="hint">{tutor.languages?.map(languageLabel).join(" · ") || "Languages not specified"}</p>
      <div className="workspace-meta">
        <span>
          {[tutor.supportsVirtual ? "Virtual" : "", tutor.supportsInPerson ? "In person" : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span>
          {tutor.ratingCount
            ? `${tutor.ratingAverage?.toFixed(1)} / 5 · ${tutor.ratingCount} reviews`
            : "No reviews yet"}
        </span>
        {tutor.distanceKm !== null && <span>{tutor.distanceKm.toFixed(1)} km away</span>}
      </div>
      {(filters.subjectId || filters.mode || filters.maxHourlyRateMinor || filters.availableAt) && (
        <p className="hint">
          Why this matches:{" "}
          {[
            relevant ? `offers ${relevant.name}` : "",
            filters.mode ? `supports ${filters.mode === "virtual" ? "virtual" : "in-person"} learning` : "",
            filters.maxHourlyRateMinor ? "within your hourly budget" : "",
            filters.availableAt ? "has the requested session time available" : "",
          ]
            .filter(Boolean)
            .join("; ")}
          .
        </p>
      )}
      <div className="workspace-record-head">
        <strong className="tutor-rate">
          {formatMoney(relevant?.hourlyRateMinor ?? tutor.hourlyRateMinor, tutor.currency)} / hour
        </strong>
        <Link className="button secondary compact" href={`/tutors/${tutor.id}`}>
          Meet your tutor ↗
        </Link>
      </div>
    </article>
  );
}
