import { AccountStatusForm, RoleForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { requireRole } from "@/domains/auth/policy";

export default async function Admin() {
  if (!publicConfig()) return null;
  const { actor } = await protectedContext();
  requireRole(actor, "administrator");
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">Administration</span>
        <h1>Account capabilities.</h1>
        <p>Narrow, audited account management for authorized administrators.</p>
      </section>
      <div className="profile-grid">
        <section className="panel">
          <span className="tag">Roles</span>
          <h2>Grant or revoke a role</h2>
          <p className="panel-description">
            The database rechecks your current administrator authority and records the change. A single account can hold
            both Student and Tutor capabilities.
          </p>
          <RoleForm />
        </section>
        <section className="panel">
          <span className="tag clay">Status</span>
          <h2>Account status</h2>
          <p className="panel-description">
            Deactivation denies access without deleting profile, financial, or audit records. Both deactivation and
            reactivation require a reason.
          </p>
          <AccountStatusForm />
        </section>
      </div>
      <p className="session-note">
        Administrator access comes from current database roles, never editable metadata. Enable administrator MFA before
        production use.
      </p>
    </>
  );
}
