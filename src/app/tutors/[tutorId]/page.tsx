import { languageLabel } from "@/lib/languages";
import { describeTutorBadge } from "@/lib/badge-presentation";
import { SaveTutorControl } from "./save-control";
import { TutorAvatar } from "@/components/workspace/tutor-avatar";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicHeader, Footer, SetupNotice } from "@/components/shell";
import { Section } from "@/components/workspace/ui";
import { publicConfig } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";
import { getPublicTutor } from "@/domains/marketplace/service";
import { safeMessage } from "@/domains/shared/errors";
import { formatMoney } from "@/domains/bookings/presentation";

export const dynamic = "force-dynamic";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export default async function TutorPage({ params }: { params: Promise<{ tutorId: string }> }) {
  const { tutorId } = await params;
  let tutor: Awaited<ReturnType<typeof getPublicTutor>> = null;
  let failure: string | null = null;
  const client = publicConfig() ? await createUserClient() : null;
  if (publicConfig())
    try {
      tutor = await getPublicTutor(client!, tutorId);
    } catch (error) {
      failure = safeMessage(error);
    }
  if (publicConfig() && !failure && !tutor) notFound();
  return (
    <>
      <PublicHeader />
      <main id="main" className="container discovery-main">
        <section className="discovery-intro">
          <Link className="small-link" href="/tutors">
            ← All tutors
          </Link>
        </section>
        {!publicConfig() ? (
          <SetupNotice />
        ) : failure ? (
          <div role="alert" className="notice warning">
            {failure}
          </div>
        ) : (
          tutor && (
            <>
              <section className="page-heading workspace-heading">
                <div>
                  <div className="tutor-identity">
                    <TutorAvatar name={tutor.publicDisplayName} url={tutor.publicAvatarUrl} />
                    <span className="eyebrow">Your next learning connection</span>
                  </div>
                  <h1>{tutor.publicDisplayName}</h1>
                  <p>{tutor.headline}</p>
                </div>
                <div className="workspace-heading-actions">
                  <Link className="button primary" href={`/bookings?tutor=${tutor.id}`}>
                    Explore session times →
                  </Link>
                  {client && <SaveTutorControl client={client} tutorId={tutor.id} />}
                </div>
              </section>
              <div className="workspace-grid">
                <div className="workspace-stack">
                  <Section title="A little about my teaching">
                    <p className="workspace-prose">{tutor.bio}</p>
                    {tutor.credentialsText && (
                      <>
                        <h3>Qualifications & experience</h3>
                        <p className="workspace-prose">{tutor.credentialsText}</p>
                      </>
                    )}
                  </Section>
                  <Section title="Subjects & rates">
                    <ul className="workspace-records">
                      {tutor.offerings.map((subject) => (
                        <li className="workspace-record" key={subject.subjectId}>
                          <div className="workspace-record-head">
                            <h3>{subject.name}</h3>
                            <strong>
                              {subject.hourlyRateMinor === null
                                ? "Rate unavailable"
                                : `${formatMoney(subject.hourlyRateMinor, subject.currency)} / hour`}
                            </strong>
                          </div>
                          {subject.expertise && <p>{subject.expertise}</p>}
                        </li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="What students say">
                    {tutor.recommendedCount > 0 && (
                      <p>
                        {tutor.recommendedCount} learner recommendation{tutor.recommendedCount === 1 ? "" : "s"} from
                        visible reviews.
                      </p>
                    )}
                    <p>
                      {tutor.ratingCount
                        ? `${tutor.ratingAverage?.toFixed(1)} out of 5 from ${tutor.ratingCount} reviews`
                        : "There are no published reviews yet."}
                    </p>
                    <ul className="workspace-records">
                      {tutor.reviews.map((review) => (
                        <li className="workspace-record" key={review.id}>
                          <strong>{review.rating} / 5</strong>
                          {review.recommended && <p className="hint">This learner recommends the tutor.</p>}
                          {review.comment && <p className="workspace-prose">{review.comment}</p>}
                          <Link className="small-link" href={`/support?tutor=${tutor.id}&review=${review.id}`}>
                            Report this review →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Section>
                </div>
                <div className="workspace-stack">
                  <Section title="Learning together">
                    <ul className="tutor-subjects">
                      {(tutor.badges ?? []).map((badge) => (
                        <li key={badge.key}>
                          <span className="tag">{badge.label}</span>
                          <p className="hint">{describeTutorBadge(badge)}</p>
                        </li>
                      ))}
                    </ul>
                    <dl className="workspace-facts">
                      <div>
                        <dt>Base rate</dt>
                        <dd>{formatMoney(tutor.hourlyRateMinor, tutor.currency)} / hour</dd>
                      </div>
                      <div>
                        <dt>Languages</dt>
                        <dd>{tutor.languages?.map(languageLabel).join(" · ") || "Not specified"}</dd>
                      </div>
                      <div>
                        <dt>Experience</dt>
                        <dd>{tutor.experienceYears} years</dd>
                      </div>
                      <div>
                        <dt>Sessions</dt>
                        <dd>
                          {[tutor.supportsVirtual ? "Virtual" : "", tutor.supportsInPerson ? "In person" : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </div>
                      {tutor.serviceAreaLabel && (
                        <div>
                          <dt>Service area</dt>
                          <dd>{tutor.serviceAreaLabel}</dd>
                        </div>
                      )}
                    </dl>
                    <p className="hint">
                      Choose an open time to request a reservation. Payment is unavailable, so a request does not
                      confirm a session.
                    </p>
                  </Section>
                  <p>
                    <Link className="small-link" href={`/support?tutor=${tutor.id}`}>
                      Report a concern about this tutor
                    </Link>
                  </p>
                  <Section title="Usual teaching hours">
                    <ul className="workspace-records">
                      {tutor.availabilityRules.map((rule, index) => (
                        <li key={index}>
                          <strong>{DAYS[rule.weekday]}</strong> · {rule.localStart.slice(0, 5)}–
                          {rule.localEnd.slice(0, 5)}
                          <p className="hint">{rule.timezone.replaceAll("_", " ")}</p>
                        </li>
                      ))}
                    </ul>
                    {!tutor.availabilityRules.length && (
                      <p>No weekly hours were shared. Check the booking picker for confirmed open times.</p>
                    )}
                    <p className="hint">
                      Date-specific changes and existing reservations can affect open times. The booking picker checks
                      availability again.
                    </p>
                  </Section>
                </div>
              </div>
            </>
          )
        )}
      </main>
      <Footer />
    </>
  );
}
