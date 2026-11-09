import { PageLoading } from "@/components/page-loading";

// This boundary is inside AppShell, preserving the authenticated navigation and footer.
export default function WorkspaceLoading() {
  return <PageLoading />;
}
