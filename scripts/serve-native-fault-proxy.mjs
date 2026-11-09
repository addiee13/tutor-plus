// Test-only loopback forwarder. Control is a private local file, never an HTTP endpoint.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const control = "/tmp/tutorplus-native-runtime/verifier-fault.json";
await mkdir("/tmp/tutorplus-native-runtime", { recursive: true, mode: 0o700 });
await writeFile(control, "{}\n", { mode: 0o600 });
const server = http.createServer(async (request, response) => {
  assert.ok(request.url?.startsWith("/"));
  let fault;
  try {
    fault = JSON.parse(await readFile(control, "utf8"));
  } catch {
    fault = {};
  }
  if (fault.path && request.url.split("?")[0] === fault.path && request.method === (fault.method || "POST")) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ code: "XX000", message: "PRIVATE_SQL_SENTINEL: isolated injected dependency failure" }),
    );
    return;
  }
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: 55440,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: "127.0.0.1:55440" },
    },
    (received) => {
      response.writeHead(received.statusCode, received.headers);
      received.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("Isolated upstream unavailable");
  });
  request.pipe(upstream);
});
server.listen(55448, "127.0.0.1", () =>
  console.log("Native verifier proxy ready on loopback 55448; default pass-through, no external services"),
);
