import { AppShell, PublicHeader, SetupNotice, Footer } from "@/components/shell";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (!publicConfig())
    return (
      <>
        <PublicHeader />
        <main id="main" className="workspace container">
          <h1>Let’s connect your account.</h1>
          <SetupNotice />
        </main>
        <Footer />
      </>
    );
  const { actor } = await protectedContext();
  return <AppShell actor={actor}>{children}</AppShell>;
}
