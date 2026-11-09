-- The attachment SELECT policy invokes this predicate as the authenticated database role.
-- A later learning migration revoked its earlier marketplace grant. Restore only this read predicate;
-- its security-definer body still checks the current verified actor and ownership of the booking.
grant execute on function private.booking_tutor(uuid) to authenticated;
