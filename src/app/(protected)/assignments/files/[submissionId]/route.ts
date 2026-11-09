import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { getAssignmentDownload } from "@/domains/learning/service";
import { safeMessage } from "@/domains/shared/errors";

/** Signed links are minted only after the domain authorizes this exact private submission. */
export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const { submissionId } = await params;
    const url = await getAssignmentDownload(await createUserClient(), submissionId);
    return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return new NextResponse(safeMessage(error), {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
