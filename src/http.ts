/** Abort even a misbehaving adapter promise; production fetch also receives signal. */
export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); signal.throwIfAborted(); }
  let abort: () => void = () => {};
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Aborted")); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
export async function boundedBody(response: Response, maxBytes = 1_000_000, signal?: AbortSignal): Promise<string> {
  const error = () => new Error(`Response exceeds ${maxBytes / 1_000_000}MB limit`);
  if (Number(response.headers.get("content-length")) > maxBytes) { void response.body?.cancel().catch(() => {}); throw error(); }
  const reader = response.body?.getReader(); if (!reader) throw new Error("Provider returned an empty body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await (signal ? abortable(reader.read(), signal) : reader.read());
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw error();
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
