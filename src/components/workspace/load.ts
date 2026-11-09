import "server-only";

/** Catch service failures before rendering; render-time errors remain the route error boundary's responsibility. */
export async function loadWorkspace<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error };
  }
}
