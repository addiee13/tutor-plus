// Deterministic loopback Responses test double; never contacts an external provider.
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
const control = "/tmp/tutorplus-native-runtime/responses-fixture-control.json";
await writeFile(control, "{}\n", { mode: 0o600 });
const observations = [];
http
  .createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/__observations") {
      response.end(JSON.stringify({ testDouble: true, externalRequests: 0, observations }));
      return;
    }
    if (
      request.method !== "POST" ||
      request.url !== "/v1/responses" ||
      request.headers.authorization !== "Bearer tutorplus-local-fixture-key"
    ) {
      response.writeHead(403);
      response.end(JSON.stringify({ error: "Local fixture boundary refused" }));
      return;
    }
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 64000) {
        response.writeHead(413);
        response.end("{}");
        return;
      }
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      response.writeHead(400);
      response.end("{}");
      return;
    }
    const text = (payload.input || [])
      .flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("\n");
    let mode = "success";
    try {
      mode = JSON.parse(await readFile(control, "utf8")).mode || mode;
    } catch {}
    observations.push({
      sequence: observations.length + 1,
      model: payload.model,
      store: payload.store,
      maxOutputTokens: payload.max_output_tokens,
      inputCharacters: text.length,
      hasSelectedResourceContext: text.includes("Approved selected resources"),
      hasSessionContext: text.includes("Selected session"),
      hasPlanContext: text.includes("Selected study plan"),
      mode,
    });
    if (mode === "unavailable") {
      response.writeHead(503);
      response.end(JSON.stringify({ error: { message: "PRIVATE_PROVIDER_SENTINEL: local deterministic outage" } }));
      return;
    }
    response.end(
      JSON.stringify({
        id: `local_fixture_response_${observations.length}`,
        status: "completed",
        output_text:
          "Deterministic local adapter fixture: this is not a live AI response. Review the selected reference and explain one worked example; any change to a study plan still needs authorized confirmation.",
      }),
    );
  })
  .listen(55449, "127.0.0.1", () =>
    console.log("Deterministic Responses fixture ready on loopback55449; no external requests"),
  );
