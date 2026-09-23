import { createHash } from "node:crypto";

// Process-local only: no dialogue, credentials or images are persisted.
const entries = new Map<string, { expires: number; value: unknown }>();
const MAX_ENTRIES = 256;
const TTL_MS = 15 * 60_000;

export async function cachedAdvisorResult<T>(
  dependencies: unknown,
  work: () => Promise<T>,
  signal?: AbortSignal,
  bypass = false,
): Promise<T> {
  signal?.throwIfAborted();
  const key = createHash("sha256").update(JSON.stringify(dependencies)).digest("hex");
  const entry = entries.get(key);
  if (!bypass && entry && entry.expires > Date.now()) {
    entries.delete(key);
    entries.set(key, entry);
    return structuredClone(entry.value) as T;
  }
  // Never share in-flight work: one caller's cancellation must not stop another.
  const value = await work();
  signal?.throwIfAborted();
  entries.delete(key);
  entries.set(key, { value: structuredClone(value), expires: Date.now() + TTL_MS });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  return value;
}
