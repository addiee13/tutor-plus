import { PublicHeader, Footer } from "@/components/shell";
import { PageLoading } from "@/components/page-loading";

export default function Loading() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="workspace container">
        <PageLoading />
      </main>
      <Footer />
    </>
  );
}
