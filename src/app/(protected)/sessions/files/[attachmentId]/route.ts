import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { getSessionAttachmentDownload } from "@/domains/sessions/service";
import { safeMessage } from "@/domains/shared/errors";
export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const { attachmentId } = await params;
    const url = await getSessionAttachmentDownload(await createUserClient(), attachmentId);
    return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return new NextResponse(safeMessage(error), {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
