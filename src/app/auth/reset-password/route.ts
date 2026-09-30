import type { NextRequest } from "next/server";
import { GET as completeCallback } from "../callback/route";

export async function GET(request: NextRequest) {
  request.nextUrl.searchParams.set("flow", "recovery");
  return completeCallback(request);
}
