import { NextResponse } from "next/server";
import { observeResendDeliveryWebhook } from "@/domains/platform/service";
import { isDomainError, safeMessage } from "@/domains/shared/errors";
export async function POST(request: Request) {
  const maximumBytes = 64_000;
  if (Number(request.headers.get("content-length")) > maximumBytes)
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel().catch(() => undefined);
          return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
        }
        chunks.push(value);
      }
    } catch {
      return NextResponse.json({ error: "Webhook payload could not be read." }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const rawBody = new TextDecoder().decode(body);
  try {
    await observeResendDeliveryWebhook(rawBody, {
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { error: safeMessage(error) },
      { status: isDomainError(error, "forbidden") ? 401 : isDomainError(error, "validation") ? 400 : 503 },
    );
  }
}
