import { TutorAvatar } from "@/components/workspace/tutor-avatar";
import Link from "next/link";
import { ProfileForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { readOwnProfile } from "@/domains/profiles/service";
import { readLearningProfile } from "@/domains/marketplace/service";
import { hasRole } from "@/domains/auth/policy";
import { WorkspaceHeading, WorkspaceError, Section } from "@/components/workspace/ui";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { learningProfileAction, profileAvatarAction, deleteProfileAvatarAction } from "./actions";
export default async function Profile() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(() => Promise.all([readOwnProfile(client), readLearningProfile(client)]));
  if (!loaded.ok) return <WorkspaceError title="Your profile" error={loaded.error} />;
  const [profile, learning] = loaded.value;
  const preference = (key: string) =>
    typeof learning.learningPreferences[key] === "string" ? (learning.learningPreferences[key] as string) : "";
  return (
    <>
      <WorkspaceHeading
        eyebrow="A little more you"
        title="Your profile."
        description="The personal details and learning preferences that make your learning space feel right."
      />
      <div className="workspace-grid">
        <div className="workspace-stack">
          <Section title="Personal details">
            <p>These details belong to your account. They are separate from a public tutor listing.</p>
            <ProfileForm profile={profile} />
          </Section>
          <Section title="Your private profile photo">
            <div className="tutor-identity">
              <TutorAvatar name={profile.display_name} url={profile.avatarUrl} />
              <p>
                Your account photo is visible only to you. Tutor studio controls the portrait on a public tutor listing.
              </p>
            </div>
            <WorkflowForm
              title="Upload private profile photo"
              action={profileAvatarAction}
              submit="Save private profile photo"
              fields={[
                {
                  name: "avatar",
                  label: "Profile photo",
                  type: "file",
                  required: true,
                  wide: true,
                  accept: "image/png,image/jpeg,image/webp",
                  hint: "PNG, JPEG or WebP, up to 2 MiB. Choose the image again if an upload fails.",
                },
              ]}
            />
            {profile.avatarUrl && (
              <details className="workspace-details">
                <summary>Remove private profile photo</summary>
                <WorkflowForm
                  title="Remove private profile photo"
                  action={deleteProfileAvatarAction}
                  submit="Remove photo"
                  fields={[
                    {
                      name: "confirmed",
                      label: "I confirm removal of my private profile photo",
                      type: "checkbox",
                      required: true,
                      wide: true,
                    },
                  ]}
                />
              </details>
            )}
          </Section>
          <Section title="Your private learning profile">
            <WorkflowForm
              title="Save learning preferences"
              action={learningProfileAction}
              submit="Save learning profile"
              fields={[
                {
                  name: "interests",
                  label: "Learning interests",
                  wide: true,
                  maxLength: 1500,
                  value: learning.interests?.join(", ") ?? "",
                  hint: "Separate topics or subjects with commas. These interests stay in your private profile.",
                },
                {
                  name: "preferredMode",
                  label: "Preferred learning mode",
                  type: "select",
                  required: true,
                  wide: true,
                  value: learning.preferredMode ?? "no_preference",
                  options: [
                    { value: "no_preference", label: "No preference" },
                    { value: "virtual", label: "Virtual" },
                    { value: "in_person", label: "In person" },
                  ],
                },
                {
                  name: "bio",
                  label: "A little about you",
                  type: "textarea",
                  wide: true,
                  maxLength: 4000,
                  value: learning.bio ?? "",
                },
                { name: "city", label: "City", maxLength: 100, value: learning.city ?? "" },
                { name: "region", label: "State or region", maxLength: 100, value: learning.region ?? "" },
                { name: "postalCode", label: "Postal code", maxLength: 20, value: learning.postalCode ?? "" },
                {
                  name: "countryCode",
                  label: "Country code",
                  maxLength: 2,
                  value: learning.countryCode ?? "",
                  hint: "Two uppercase letters, such as US.",
                },
                {
                  name: "goals",
                  label: "What you want to learn",
                  type: "textarea",
                  wide: true,
                  maxLength: 1500,
                  value: preference("goals"),
                },
                {
                  name: "preferredApproach",
                  label: "How you prefer to learn",
                  type: "textarea",
                  wide: true,
                  maxLength: 1000,
                  value: preference("preferredApproach"),
                  hint: "For example, worked examples, reading first or step-by-step practice.",
                },
                {
                  name: "accessNeeds",
                  label: "Learning access preferences",
                  type: "textarea",
                  wide: true,
                  maxLength: 1000,
                  value: preference("accessNeeds"),
                  hint: "Share only what you want recorded in your private profile.",
                },
              ]}
            />
          </Section>
        </div>
        <Section title="Your account, your details.">
          <p>
            Your age confirmation and account capabilities are protected. Profile edits cannot change roles or grant
            administrator access.
          </p>
          {hasRole(actor, "tutor") && (
            <p>
              <Link className="button secondary" href="/tutor-studio">
                Edit your public tutor listing →
              </Link>
            </p>
          )}
          <p>
            <Link className="small-link" href="/notifications">
              Manage notification preferences →
            </Link>
          </p>
          <Link className="text-link" href="/update-password">
            Change your password →
          </Link>
        </Section>
      </div>
    </>
  );
}
