import { NextResponse } from "next/server";
import { processNotificationOutboxJob } from "@/domains/platform/service";
import { isDomainError, safeMessage } from "@/domains/shared/errors";
async function run(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    return NextResponse.json(await processNotificationOutboxJob(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: safeMessage(error) },
      { status: isDomainError(error, "forbidden") ? 403 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function POST(request: Request) {
  return run(request);
}
export async function GET(request: Request) {
  return run(request);
}
