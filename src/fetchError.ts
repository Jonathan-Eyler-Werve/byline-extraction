export function classifyFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "timeout";
    if (err.message === "fetch failed") return "network";
    return err.message;
  }
  return String(err);
}
