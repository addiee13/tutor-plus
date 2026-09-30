import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { safeMessage } from "@/domains/shared/errors";
import { readBookingWorkspace } from "@/domains/bookings/service";
import { formatMoney, formatUtc, localDate } from "@/domains/bookings/presentation";
import { BookingCancellationForm, BookingRequestForm } from "./forms";
import styles from "./bookings.module.css";

export const dynamic = "force-dynamic";
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function BookingsPage() {
  if (!publicConfig()) return null;
  const { client } = await protectedContext();
  let workspace: Awaited<ReturnType<typeof readBookingWorkspace>>;
  try { workspace = await readBookingWorkspace(client); } catch (error) {
    return <section className="panel"><h1>Bookings.</h1><div className="notice warning" role="alert">{safeMessage(error)}</div><p>Refresh this page to try again. No reservation or charge was created by loading it.</p></section>;
  }
  const { actor, tutors, subjects, bookings, ownTutors, links, rules, exceptions } = workspace;
  const now = workspace.observedAt;
  const horizon = now + 7 * 86400000;
  return <>
    <section className="page-heading"><span className="eyebrow">UC-04 · REAL RESERVATIONS</span><h1>Bookings.</h1><p>Request a tutoring reservation, inspect its saved price and hold, or cancel an eligible reservation.</p></section>
    <div className="notice warning" role="note"><strong>Payment not implemented — no charge.</strong><br />This page does not run checkout, take payment, or confirm a session. A saved request is normally <code>payment_pending</code> with a temporary hold. Only verified provider events can confirm payment; there is no payment button or simulated confirmation here.</div>
    <div className={styles.grid}>
      <section className={`panel ${styles.card}`} aria-labelledby="request-heading"><h2 id="request-heading">Request a reservation</h2>
        {actor.roles.includes("student") ? tutors.length && subjects.length ? <BookingRequestForm tutors={tutors} subjects={subjects} links={links} readableSubjectTutorIds={workspace.readableSubjectTutorIds} requestKey={workspace.requestKey} /> : <p>No readable published tutors and active subjects are available for a request. No sample tutor or availability has been invented.</p> : <p>Student capability is required to request a reservation. Tutors can view and cancel their own participating reservations below.</p>}
      </section>
      <section className={styles.stack} aria-labelledby="tutors-heading"><h2 id="tutors-heading">Published tutors &amp; availability</h2><p className="hint">Readable schedule summary for the next seven days, as of {formatUtc(new Date(now).toISOString())}. Local schedule times show their IANA time zone; request fields require UTC. These are not guaranteed free slots.</p>
        {!tutors.length && <p>No published tutor listings are readable for your account.</p>}
        {tutors.map((tutor) => {
          const tutorRules = rules.filter((rule) => rule.tutor_id === tutor.id && rule.valid_from <= localDate(horizon, rule.timezone) && (!rule.valid_until || rule.valid_until >= localDate(now, rule.timezone)));
          const tutorExceptions = exceptions.filter((exception) => exception.tutor_id === tutor.id && exception.local_date >= localDate(now, exception.timezone) && exception.local_date <= localDate(horizon, exception.timezone));
          const tutorLinks = links.filter((link) => link.tutor_id === tutor.id);
          return <article key={tutor.id} className={`panel ${styles.card}`}><h3>{tutor.public_display_name}</h3><p>{tutor.headline}</p><p>Base rate: <strong>{formatMoney(tutor.hourly_rate_minor, tutor.currency)}/hour</strong> · {[tutor.supports_virtual ? "Virtual" : "", tutor.supports_in_person ? "In person" : ""].filter(Boolean).join(" / ")}</p>
            {tutorLinks.length ? <ul className={styles.summary}>{tutorLinks.map((link) => <li key={link.subject_id}>{link.name} · {formatMoney(link.hourly_rate_minor, link.currency)}/hour</li>)}</ul> : <p className="hint">No published subject offerings could be loaded for this tutor. Requests require a real public subject offering.</p>}
            {tutorRules.length || tutorExceptions.length ? <ul className={styles.summary}>{tutorRules.map((rule, index) => <li key={`rule-${index}`}>{weekdays[rule.weekday]} · {rule.local_start}–{rule.local_end} ({rule.timezone}); valid {rule.valid_from} through {rule.valid_until ?? "no specified end date"}.</li>)}{tutorExceptions.map((exception, index) => <li key={`exception-${index}`}>{exception.local_date} · {exception.exception_type === "additional" ? "Additional availability" : "Unavailable"} · {exception.local_start ?? "00:00"}–{exception.local_end ?? "next day 00:00"} ({exception.timezone}).</li>)}</ul> : <p className="hint">No scheduling details are readable for this tutor in this window. This does not mean the tutor is free or unavailable. Enter a UTC time shared by the tutor; the database checks actual availability, buffers and conflicts.</p>}
          </article>;
        })}
      </section>
    </div>
    <section className={styles.stack} aria-labelledby="saved-heading"><h2 id="saved-heading">Your saved reservations</h2><p className="hint">Latest 50 participant-visible records, reloaded from the database. Times below are UTC. Refresh to see changes made since this page loaded.</p>
      {!bookings.length && <div className="panel"><p>No reservations are visible for your account yet.</p></div>}
      {bookings.map((booking) => {
        const tutor = tutors.find((entry) => entry.id === booking.tutor_id) ?? ownTutors.find((entry) => entry.id === booking.tutor_id);
        const subject = subjects.find((entry) => entry.id === booking.subject_id);
        const canCancel = ["draft", "payment_pending", "confirmed"].includes(booking.status);
        const expiredHold = booking.status === "payment_pending" && booking.hold_expires_at && Date.parse(booking.hold_expires_at) <= now;
        return <article key={booking.id} className={`panel ${styles.card}`} data-booking-id={booking.id}><h3>{tutor?.public_display_name ?? "Tutor listing no longer public"} · {subject?.name ?? "Subject no longer public"}</h3><dl className={styles.facts}>
          <dt>Booking ID</dt><dd>{booking.id}</dd><dt>Saved status</dt><dd><code data-testid="booking-status">{booking.status}</code></dd>
          <dt>Starts (UTC)</dt><dd><time dateTime={booking.starts_at}>{formatUtc(booking.starts_at)}</time></dd><dt>Ends (UTC)</dt><dd><time dateTime={booking.ends_at}>{formatUtc(booking.ends_at)}</time></dd>
          <dt>Mode</dt><dd>{booking.mode === "virtual" ? "Virtual" : "In person"}</dd><dt>Saved price</dt><dd data-testid="booking-price">{formatMoney(booking.price_minor, booking.currency)} ({booking.price_minor} {booking.currency} minor units)</dd><dt>Saved platform fee</dt><dd>{formatMoney(booking.platform_fee_minor, booking.currency)}</dd>
          <dt>Hold expires (UTC)</dt><dd>{booking.hold_expires_at ? formatUtc(booking.hold_expires_at) : "No hold recorded"}{expiredHold ? " · Expired as of page load; saved status is unchanged until database cleanup." : ""}</dd>
          {booking.cancellation_reason && <><dt>Cancellation reason</dt><dd>{booking.cancellation_reason}</dd></>}
        </dl>{booking.status === "payment_pending" && <p className="hint">Payment pending is not a confirmed session. This request did not charge you, and this UI has no checkout.</p>}
        {canCancel && <details><summary>Cancel reservation</summary><BookingCancellationForm bookingId={booking.id} /></details>}</article>;
      })}
    </section>
  </>;
}
