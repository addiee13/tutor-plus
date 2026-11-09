import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { listResources } from "@/domains/platform/service";
import { listSubjects } from "@/domains/marketplace/service";
import { WorkspaceHeading, WorkspaceError, Section, EmptyState, Status } from "@/components/workspace/ui";
import { loadWorkspace } from "@/components/workspace/load";
export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!publicConfig()) return null;
  const { client } = await protectedContext();
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  const subject = typeof query.subject === "string" ? query.subject : "";
  const result = await loadWorkspace(() =>
    Promise.all([
      listResources(client, { query: q || undefined, subjectId: subject || undefined }),
      listSubjects(client),
    ]),
  );
  if (!result.ok) return <WorkspaceError title="Learning resources" error={result.error} />;
  const [allResources, subjects] = result.value;
  const resourceId = typeof query.resource === "string" ? query.resource : undefined;
  const resources = resourceId ? allResources.filter((resource) => resource.id === resourceId) : allResources;
  return (
    <>
      <WorkspaceHeading
        eyebrow="A useful place to look"
        title="Learning resources."
        description="Explore curated reading, practice and reference material. Attribution stays with each resource."
      />
      <Section title="Find a resource">
        <form method="get" action="/resources" className="discovery-filters resource-filters">
          <div className="field">
            <label htmlFor="resource-query">Search resources</label>
            <input id="resource-query" name="q" defaultValue={q} maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="resource-subject">Subject</label>
            <select id="resource-subject" name="subject" defaultValue={subject}>
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button className="button primary" type="submit">
            Search →
          </button>
        </form>
      </Section>
      <section style={{ marginTop: "1.5rem" }} aria-label="Resource results">
        {resources.length ? (
          <div className="tutor-grid">
            {resources.map((resource) => (
              <article className="panel workspace-section" key={resource.id}>
                <Status>{resource.resourceType.replaceAll("_", " ")}</Status>
                <h2 style={{ marginTop: "1rem" }}>{resource.title}</h2>
                <p>{resource.description}</p>
                <p className="hint">
                  {subjects.find((s) => s.id === resource.subjectId)?.name ?? "General learning"} ·{" "}
                  {resource.attribution}
                </p>
                <a className="button secondary compact" href={resource.url} target="_blank" rel="noreferrer">
                  Open resource ↗
                </a>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No resources match yet">
            Try another subject or search term. The library only shows saved, active resources.
          </EmptyState>
        )}
      </section>
      <p>
        <Link className="small-link" href="/assistant">
          Discuss a learning question with the assistant →
        </Link>
      </p>
    </>
  );
}
