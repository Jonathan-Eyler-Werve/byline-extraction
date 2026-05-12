# Error-code normalization — design

Date: 2026-05-12
Status: Approved, pending implementation
Branch: `feat/user-feedback`

## Goal

Replace the ad-hoc `Error.message` strings currently persisted to the sheet's `error` column and shown in CLI progress output with a small, normalized vocabulary. Same string in both places — no more divergence between terminal and sheet.

## Why this matters

Today, an HTTP 403 on an article fetch persists as `"fetch https://example.com/article failed: 403"`, while a DNS failure on the same article persists as `"fetch failed"`. The CLI strips the `"fetch … failed: "` prefix for display only, so terminal and sheet show different strings. Users browsing the `error` column can't easily sort, filter, or aggregate.

## Out of scope

- Webhook (Apps Script) failures. Those abort the whole run and are not persisted to a row. They stay as-is.
- Migrating existing sheet rows. Old strings persist until a row is overwritten by a successful `--retry-errors` run.
- A separate `error_code` column. Single string in the existing `error` column.
- Distinguishing DNS / TLS / connection-refused / reset within the non-HTTP bucket. All collapse to `network`. The `source_url` is on the row if anyone needs to diagnose further.

## Normalized vocabulary

| Persisted string | Source |
|---|---|
| `"403 Forbidden"`, `"504 Gateway Timeout"`, `"500 Internal Server Error"`, … | Non-2xx HTTP: `${res.status} ${res.statusText}`.trim() |
| `"403"` (bare number) | Same, but server returned empty `statusText`. Rare; mostly HTTP/2. |
| `"timeout"` | `AbortSignal.timeout` fired — `err.name === "AbortError"` (or `"TimeoutError"`) |
| `"network"` | Node's `TypeError("fetch failed")` — DNS / TLS / refused / reset / unreachable all collapse here |
| (passthrough `err.message`) | Anything else — preserves the raw message as a last-resort fallback |

## Architecture

### New module: `src/fetchError.ts`

```typescript
export function classifyFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "timeout";
    if (err.message === "fetch failed") return "network";
    return err.message;
  }
  return String(err);
}
```

That's the whole module. No class. No reason-phrase map. The classifier only does real work for the two non-HTTP cases; HTTP cases are pre-formatted at the throw site and pass straight through `err.message`.

### Changes to existing files

**`src/feeds.ts`** — line 40:
```typescript
// before
if (!res.ok) throw new Error(`fetch ${feed.pageUrl} failed: ${res.status}`);
// after
if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
```

**`src/extract.ts`** — line 300:
```typescript
// before
if (!res.ok) throw new Error(`fetch ${sourceUrl} failed: ${res.status}`);
// after
if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
```

The URL is dropped from the thrown message — it's already on the surrounding `ProgressEvent` (`sourceUrl` / `pageUrl`) and on the row.

**`src/run.ts`** — both catch blocks (feed-level `findLinks` failure at ~line 61, article-level `extractAuthor` failure at ~line 100):
```typescript
} catch (err) {
  const error = classifyFetchError(err);
  // ... use `error` in both the ProgressEvent and the row
}
```

**`src/render-progress.ts`** — line 39:
```typescript
// before
const reason = e.error?.replace(`fetch ${e.sourceUrl} failed: `, "").trim() || e.error || "unknown";
// after
const reason = e.error || "unknown";
```

The string-stripping hack disappears.

## Data flow

```
fetch() ──► non-2xx Response ──► Error("403 Forbidden") thrown
   │                                    │
   │                                    ▼
   └──► AbortError /                run.ts catch
        TypeError("fetch failed")       │
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

- `new Error("403 Forbidden")` → `"403 Forbidden"` (passthrough).
- `Object.assign(new Error("..."), { name: "AbortError" })` → `"timeout"`.
- `new TypeError("fetch failed")` → `"network"`.
- `new Error("something weird")` → `"something weird"` (passthrough fallback).

Existing tests touched:

- `test/feeds.test.ts` / `test/extract.test.ts` — any assertion on the thrown message for non-2xx becomes `expect(err.message).toMatch(/^\d{3}/)` or the literal `"403 Forbidden"`.
- `test/run.test.ts` (and progress-event tests) — assertions that expected the old `"fetch … failed: 403"` string become `"403 Forbidden"`.

## Compatibility / migration

- **Existing sheet rows** keep their old error strings. No migration. `--retry-errors` reads `source_url` only, so format mismatch is invisible to that path.
- **No schema change.** Same `error` column, same shape.
- **No config change.** No flags added.

## Acceptance

- `npm test` passes (existing + new tests).
- `npm run build` produces no type errors.
- A live dry-run against current `config.json` produces normalized strings in the per-URL progress lines for any failures (no `"fetch … failed: 403"` substrings).
- A sheet-writing run produces normalized strings in the `error` column for any failed rows.
