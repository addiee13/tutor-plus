import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { safeMessage } from "@/domains/shared/errors";
import { hasRole } from "@/domains/auth/policy";
import { readBookingWorkspace, type BookingWorkspace } from "@/domains/bookings/service";
import { formatMoney, formatUtc, localDate } from "@/domains/bookings/presentation";
import {
  CANCELLABLE_STATUSES,
  type AvailabilityException,
  type AvailabilityRule,
  type Booking,
  type PublicSubject,
  type PublicTutor,
  type TutorSubject,
} from "@/domains/bookings/types";
import { BookingCancellationForm, BookingRequestForm } from "./forms";
import styles from "./bookings.module.css";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SUMMARY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Bookings whose UC-09 planner, recap or reflection can be opened. */
/** A payment hold is only meaningful before confirmation. */
const HOLD_STATUSES: readonly Booking["status"][] = ["draft", "payment_pending"];
const WORKSPACE_STATUSES: readonly Booking["status"][] = ["confirmed", "in_progress", "completed"];

export default async function BookingsPage() {
  if (!publicConfig()) return null;
  const { client } = await protectedContext();
  let workspace: BookingWorkspace;
  try {
    workspace = await readBookingWorkspace(client);
  } catch (error) {
    return (
      <section className="panel">
        <h1>Bookings.</h1>
        <div className="notice warning" role="alert">
          {safeMessage(error)}
        </div>
        <p>Refresh this page to try again. No reservation or charge was created by loading it.</p>
      </section>
    );
  }

  const { actor, tutors, subjects, bookings, ownTutors, links, rules, exceptions } = workspace;
  const now = workspace.observedAt;
  const horizon = now + SUMMARY_WINDOW_MS;

  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">Reservations</span>
        <h1>Bookings.</h1>
        <p>Request a tutoring reservation, inspect its saved price and hold, or cancel an eligible reservation.</p>
      </section>
      <div className={`notice warning ${styles.payment}`} role="note">
        <strong>Payment not implemented — no charge.</strong>
        <br />
        This page does not run checkout, take payment, or confirm a session. A saved request is normally{" "}
        <code>payment_pending</code> with a temporary hold. Only verified provider events can confirm payment; there is
        no payment button or simulated confirmation here.
      </div>
      <div className={styles.grid}>
        <section className={`panel ${styles.card} ${styles.request}`} aria-labelledby="request-heading">
          <span className="tag">New request</span>
          <h2 id="request-heading">Request a reservation</h2>
          {!hasRole(actor, "student") ? (
            <p>
              Student capability is required to request a reservation. Tutors can view and cancel their own
              participating reservations below.
            </p>
          ) : tutors.length && subjects.length ? (
            <BookingRequestForm
              tutors={tutors}
              subjects={subjects}
              links={links}
              readableSubjectTutorIds={workspace.readableSubjectTutorIds}
              requestKey={workspace.requestKey}
            />
          ) : (
            <p>
              No readable published tutors and active subjects are available for a request. No sample tutor or
              availability has been invented.
            </p>
          )}
        </section>
        <section className={styles.stack} aria-labelledby="tutors-heading">
          <h2 id="tutors-heading" className={styles.sectionTitle}>
            Published tutors &amp; availability
          </h2>
          <p className="hint">
            Readable schedule summary for the next seven days, as of {formatUtc(new Date(now).toISOString())}. Local
            schedule times show their IANA time zone; request fields require UTC. These are not guaranteed free slots.
          </p>
          {!tutors.length && <p>No published tutor listings are readable for your account.</p>}
          {tutors.map((tutor) => (
            <TutorCard
              key={tutor.id}
              tutor={tutor}
              links={links.filter((link) => link.tutor_id === tutor.id)}
              rules={rules.filter((rule) => rule.tutor_id === tutor.id && isRuleInWindow(rule, now, horizon))}
              exceptions={exceptions.filter(
                (exception) => exception.tutor_id === tutor.id && isExceptionInWindow(exception, now, horizon),
              )}
            />
          ))}
        </section>
      </div>
      <section className={`${styles.stack} ${styles.saved}`} aria-labelledby="saved-heading">
        <h2 id="saved-heading" className={styles.sectionTitle}>
          Your saved reservations
        </h2>
        <p className="hint">
          Latest 50 participant-visible records, reloaded from the database. Times below are UTC. Refresh to see changes
          made since this page loaded.
        </p>
        {!bookings.length && (
          <div className="panel">
            <p>No reservations are visible for your account yet.</p>
          </div>
        )}
        {bookings.map((booking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            tutor={[...tutors, ...ownTutors].find((entry) => entry.id === booking.tutor_id)}
            subject={subjects.find((entry) => entry.id === booking.subject_id)}
            now={now}
          />
        ))}
      </section>
    </>
  );
}

function isRuleInWindow(rule: AvailabilityRule, now: number, horizon: number): boolean {
  return (
    rule.valid_from <= localDate(horizon, rule.timezone) &&
    (!rule.valid_until || rule.valid_until >= localDate(now, rule.timezone))
  );
}

function isExceptionInWindow(exception: AvailabilityException, now: number, horizon: number): boolean {
  return (
    exception.local_date >= localDate(now, exception.timezone) &&
    exception.local_date <= localDate(horizon, exception.timezone)
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "T"
  );
}

function modeLabels(tutor: PublicTutor): string {
  return [tutor.supports_virtual ? "Virtual" : "", tutor.supports_in_person ? "In person" : ""]
    .filter(Boolean)
    .join(" / ");
}

type TutorCardProps = {
  tutor: PublicTutor;
  links: TutorSubject[];
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
};

function TutorCard({ tutor, links, rules, exceptions }: TutorCardProps) {
  return (
    <article className={`panel ${styles.card} ${styles.tutor}`}>
      <div className={styles.tutorHead}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(tutor.public_display_name)}
        </span>
        <div className={styles.tutorName}>
          <h3>{tutor.public_display_name}</h3>
          <p>{tutor.headline}</p>
        </div>
      </div>
      <p className={styles.rate}>
        Base rate <strong>{formatMoney(tutor.hourly_rate_minor, tutor.currency)}/hour</strong>
        <span className="tag">{modeLabels(tutor)}</span>
      </p>
      {links.length ? (
        <ul className={styles.subjects} aria-label={`Subjects offered by ${tutor.public_display_name}`}>
          {links.map((link) => (
            <li key={link.subject_id}>
              {link.name} · {formatMoney(link.hourly_rate_minor, link.currency)}/hour
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          No published subject offerings could be loaded for this tutor. Requests require a real public subject
          offering.
        </p>
      )}
      {rules.length || exceptions.length ? (
        <ul className={styles.summary}>
          {rules.map((rule, index) => (
            <li key={`rule-${index}`}>
              {WEEKDAYS[rule.weekday]} · {rule.local_start}–{rule.local_end} ({rule.timezone}); valid {rule.valid_from}{" "}
              through {rule.valid_until ?? "no specified end date"}.
            </li>
          ))}
          {exceptions.map((exception, index) => (
            <li key={`exception-${index}`}>
              {exception.local_date} ·{" "}
              {exception.exception_type === "additional" ? "Additional availability" : "Unavailable"} ·{" "}
              {exception.local_start ?? "00:00"}–{exception.local_end ?? "next day 00:00"} ({exception.timezone}).
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          No scheduling details are readable for this tutor in this window. This does not mean the tutor is free or
          unavailable. Enter a UTC time shared by the tutor; the database checks actual availability, buffers and
          conflicts.
        </p>
      )}
    </article>
  );
}

type BookingCardProps = {
  booking: Booking;
  tutor?: Pick<PublicTutor, "public_display_name">;
  subject?: PublicSubject;
  now: number;
};

function BookingCard({ booking, tutor, subject, now }: BookingCardProps) {
  const canCancel = CANCELLABLE_STATUSES.includes(booking.status);
  const expiredHold =
    booking.status === "payment_pending" &&
    booking.hold_expires_at !== null &&
    Date.parse(booking.hold_expires_at) <= now;
  return (
    <article className={`panel ${styles.card} ${styles.booking}`} data-booking-id={booking.id}>
      <div className={styles.bookingHead}>
        <h3>
          {tutor?.public_display_name ?? "Tutor listing no longer public"} ·{" "}
          {subject?.name ?? "Subject no longer public"}
        </h3>
        <time className={styles.when} dateTime={booking.starts_at}>
          {formatUtc(booking.starts_at)}
        </time>
      </div>
      <dl className={styles.facts}>
        <dt>Booking ID</dt>
        <dd>{booking.id}</dd>
        <dt>Saved status</dt>
        <dd>
          <code className="status-chip" data-status={booking.status} data-testid="booking-status">
            {booking.status}
          </code>
        </dd>
        <dt>Starts (UTC)</dt>
        <dd>
          <time dateTime={booking.starts_at}>{formatUtc(booking.starts_at)}</time>
        </dd>
        <dt>Ends (UTC)</dt>
        <dd>
          <time dateTime={booking.ends_at}>{formatUtc(booking.ends_at)}</time>
        </dd>
        <dt>Mode</dt>
        <dd>{booking.mode === "virtual" ? "Virtual" : "In person"}</dd>
        <dt>Saved price</dt>
        <dd data-testid="booking-price">
          {formatMoney(booking.price_minor, booking.currency)} ({booking.price_minor} {booking.currency} minor units)
        </dd>
        <dt>Saved platform fee</dt>
        <dd>{formatMoney(booking.platform_fee_minor, booking.currency)}</dd>
        {HOLD_STATUSES.includes(booking.status) && (
          <>
            <dt>Hold expires (UTC)</dt>
            <dd>
              {booking.hold_expires_at ? formatUtc(booking.hold_expires_at) : "No hold recorded"}
              {expiredHold ? " · Expired as of page load; saved status is unchanged until database cleanup." : ""}
            </dd>
          </>
        )}
        {booking.cancellation_reason && (
          <>
            <dt>Cancellation reason</dt>
            <dd>{booking.cancellation_reason}</dd>
          </>
        )}
      </dl>
      {booking.status === "payment_pending" && (
        <p className="hint">
          Payment pending is not a confirmed session. This request did not charge you, and this UI has no checkout.
        </p>
      )}
      {WORKSPACE_STATUSES.includes(booking.status) && (
        <p className={styles.actions}>
          <Link className="button primary compact" href={`/sessions/${booking.id}`}>
            Open session workspace <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}
      {canCancel && (
        <details className={styles.cancel}>
          <summary>Cancel reservation</summary>
          <BookingCancellationForm bookingId={booking.id} />
        </details>
      )}
    </article>
  );
}
