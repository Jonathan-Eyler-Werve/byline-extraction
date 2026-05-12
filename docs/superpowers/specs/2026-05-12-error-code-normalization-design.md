# Error-code normalization — design

Date: 2026-05-12
Status: Approved, pending implementation
Branch: `feat/user-feedback`

## Goal

Replace the ad-hoc `Error.message` strings currently persisted to the sheet's `error` column and shown in CLI progress output with a small, normalized vocabulary of "web error codes." The same normalized string is used in both places — no more divergence between what a user sees in the terminal and what ends up in the sheet.

## Why this matters

Today, an HTTP 403 on an article fetch persists as `"fetch https://example.com/article failed: 403"`, while a DNS failure on the same article persists as `"fetch failed"`. The CLI strips the `"fetch … failed: "` prefix for display only, so the terminal and the sheet show different strings. Users browsing the sheet's `error` column can't easily sort, filter, or aggregate failures.

## Out of scope

- Webhook (Apps Script) failures. Those throw `webhook seen failed: 500` / `webhook append failed: 500` and abort the whole run; they are not persisted to a row's `error` column. They stay as-is.
- Migrating existing sheet rows. Old error strings persist until the row is overwritten by a `--retry-errors` run that succeeds or produces a new error.
- Adding a separate `error_code` column. Single normalized string in the existing `error` column.

## Normalized vocabulary

**HTTP errors:** `"<status> <reason phrase>"` — e.g., `"403 Forbidden"`, `"504 Gateway Timeout"`, `"429 Too Many Requests"`.
- Source of reason phrase: `Response.statusText` when non-empty; otherwise a built-in fallback map for the codes we actually see (400, 401, 403, 404, 408, 410, 429, 500, 502, 503, 504).
- If both `statusText` and the fallback are absent, render the bare number: `"418"`.

**Non-HTTP categories.** The classifier dispatches by error shape first (`FetchHttpError` → HTTP path; `DOMException` with `name === "AbortError"` → `timeout`; `TypeError("fetch failed")` → inspect `.cause.code`). Inside the `.cause.code` branch the table below is matched in order — first match wins — but the code sets are disjoint in practice, so order only matters for the catch-all `network` fallback.

| Code | Trigger |
|---|---|
| `timeout` | `DOMException` with `.name === "AbortError"` (our `AbortSignal.timeout` fired) |
| `dns` | `TypeError("fetch failed")` with `.cause.code` in `{ENOTFOUND, EAI_AGAIN}` |
| `connection refused` | `.cause.code === ECONNREFUSED` |
| `tls` | `.cause.code` starts with `ERR_TLS_`, or matches `CERT_HAS_EXPIRED`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN` |
| `network` | Any other `TypeError("fetch failed")`, including `ECONNRESET`, `EPIPE`, `ENETUNREACH`, `EHOSTUNREACH`, or unknown cause |
| (raw message) | Anything that doesn't match any of the above — preserve `err.message` as last-resort fallback |

## Architecture

### New module: `src/fetchError.ts`

```typescript
export class FetchHttpError extends Error {
  constructor(public readonly status: number, public readonly statusText: string) {
    super(`${status} ${statusText}`.trim());
    this.name = "FetchHttpError";
  }
}

export function classifyFetchError(err: unknown): string;
```

`classifyFetchError` is the single point of truth for the normalized vocabulary. It handles:

1. `FetchHttpError` instances → `${status} ${reasonPhrase}` using `statusText` or the fallback map.
2. `DOMException` with `name === "AbortError"` → `"timeout"`.
3. `TypeError` with `message === "fetch failed"` and a `cause` → inspect `cause.code` against the table above.
4. Anything else → return `err.message` (or `String(err)` if no `.message`).

### Changes to existing files

**`src/feeds.ts`** — line 40:
```typescript
// before
if (!res.ok) throw new Error(`fetch ${feed.pageUrl} failed: ${res.status}`);
// after
if (!res.ok) throw new FetchHttpError(res.status, res.statusText);
```

**`src/extract.ts`** — line 300:
```typescript
// before
if (!res.ok) throw new Error(`fetch ${sourceUrl} failed: ${res.status}`);
// after
if (!res.ok) throw new FetchHttpError(res.status, res.statusText);
```

The URL is intentionally dropped from the thrown error — it's already present in the surrounding `ProgressEvent` (`sourceUrl` / `pageUrl`) and on the persisted row.

**`src/run.ts`** — both catch blocks (feed-level `findLinks` failure, article-level `extractAuthor` failure):
```typescript
} catch (err) {
  const error = classifyFetchError(err);
  // ... use `error` in both the ProgressEvent and the row
}
```

The variable currently named `error` already exists at `run.ts:101`; it just gets sourced from `classifyFetchError(err)` instead of `(err as Error).message`. Same swap at the `findLinks` catch (line 61).

**`src/render-progress.ts`** — line 39:
```typescript
// before
const reason = e.error?.replace(`fetch ${e.sourceUrl} failed: `, "").trim() || e.error || "unknown";
// after
const reason = e.error || "unknown";
```

The string-stripping hack disappears. The CLI prints whatever `run.ts` already normalized.

## Data flow

```
fetch() ──► non-2xx Response ──► FetchHttpError thrown
   │                                    │
   │                                    ▼
   └──► thrown DOMException/        run.ts catch
        TypeError                       │
                                        ▼
                              classifyFetchError(err)
                                        │
                                        ▼
                              normalized string
                                ┌───────┴───────┐
                                ▼               ▼
                          ProgressEvent     row.error
                                │               │
                                ▼               ▼
                          render-progress    sheet
                          (terminal)         (Apps Script)
```

## Testing

New test file `test/fetchError.test.ts`:

- `FetchHttpError` with various statuses + reason phrases → expected string.
- `FetchHttpError` with empty `statusText` and a known fallback code → expected string from the map.
- `FetchHttpError` with empty `statusText` and an unknown code → bare number.
- Synthetic `DOMException("...", "AbortError")` → `"timeout"`.
- Synthetic `TypeError("fetch failed")` with `cause: { code: "ENOTFOUND" }` → `"dns"`.
- Same with `ECONNREFUSED`, `ERR_TLS_CERT_ALTNAME_INVALID`, `CERT_HAS_EXPIRED`, `ECONNRESET`, `ENETUNREACH`.
- Unknown error → falls back to `err.message`.

Existing tests touched:

- `test/feeds.test.ts` and `test/extract.test.ts` (if they assert on thrown error messages for non-2xx) — update to expect `FetchHttpError` with the right `status`/`statusText`, or simply assert `instanceof FetchHttpError`.
- `test/run.test.ts` / progress-event tests — update any assertion that expects the old `"fetch … failed: 403"` string to expect `"403 Forbidden"` instead.

## Compatibility / migration

- **Existing sheet rows** keep their old error strings. No migration. `--retry-errors` reads `source_url` only, so format mismatch is invisible to that path.
- **No schema change.** Same `error` column, same shape.
- **No config change.** No flags added.

## Acceptance

- `npm test` passes (existing + new tests).
- `npm run build` produces no type errors.
- A live dry-run against current `config.json` produces normalized error strings in the per-URL progress lines for any failures (no `"fetch … failed: 403"` substrings).
- A sheet-writing run produces normalized strings in the `error` column for any failed rows.
