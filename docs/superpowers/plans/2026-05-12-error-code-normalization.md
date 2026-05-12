# Error-Code Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc `Error.message` strings in the sheet's `error` column and CLI progress output with a normalized vocabulary: `"<status> <reason phrase>"` for HTTP errors, `"timeout"` for `AbortSignal.timeout`, `"network"` for everything `fetch` throws, raw message as last-resort fallback.

**Architecture:** Format HTTP errors at the throw site (`feeds.ts`, `extract.ts`). Introduce one small classifier (`src/fetchError.ts` — ~10 LOC) called from `run.ts` catch blocks. CLI renderer (`render-progress.ts`) prints the already-normalized string and loses its prefix-stripping hack.

**Tech Stack:** TypeScript, Vitest, Node 20+, cheerio. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-error-code-normalization-design.md`

---

## File map

- **Create:** `src/fetchError.ts` — exports `classifyFetchError(err: unknown): string`
- **Create:** `test/fetchError.test.ts` — unit tests for the classifier
- **Modify:** `src/feeds.ts` (line 40) — throw `new Error(\`${res.status} ${res.statusText}\`.trim())`
- **Modify:** `src/extract.ts` (line 300) — same shape
- **Modify:** `src/run.ts` (lines 61, 100-101) — wrap caught errors with `classifyFetchError`
- **Modify:** `src/render-progress.ts` (line 39) — drop the prefix-strip
- **Modify if assertions break:** `test/feeds.test.ts`, `test/run.test.ts` — existing assertions use `/500/` regex which already passes; only update if a new assertion would be clearer

---

## Task 1: Classifier module with tests (TDD)

**Files:**
- Create: `src/fetchError.ts`
- Test: `test/fetchError.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/fetchError.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyFetchError } from "../src/fetchError.js";

describe("classifyFetchError", () => {
  it("returns 'timeout' for AbortError", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyFetchError(err)).toBe("timeout");
  });

  it("returns 'timeout' for TimeoutError (alternate Node naming)", () => {
    const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(classifyFetchError(err)).toBe("timeout");
  });

  it("returns 'network' for TypeError with message 'fetch failed'", () => {
    const err = new TypeError("fetch failed");
    expect(classifyFetchError(err)).toBe("network");
  });

  it("passes through pre-formatted HTTP error messages unchanged", () => {
    const err = new Error("403 Forbidden");
    expect(classifyFetchError(err)).toBe("403 Forbidden");
  });

  it("passes through bare status when statusText is empty", () => {
    const err = new Error("418");
    expect(classifyFetchError(err)).toBe("418");
  });

  it("passes through unknown Error messages as last-resort fallback", () => {
    const err = new Error("something weird happened");
    expect(classifyFetchError(err)).toBe("something weird happened");
  });

  it("stringifies non-Error throws", () => {
    expect(classifyFetchError("just a string")).toBe("just a string");
    expect(classifyFetchError(42)).toBe("42");
    expect(classifyFetchError(null)).toBe("null");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/fetchError.test.ts`
Expected: FAIL — `Cannot find module '../src/fetchError.js'`

- [ ] **Step 3: Implement the classifier**

Create `src/fetchError.ts`:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/fetchError.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/fetchError.ts test/fetchError.test.ts
git commit -m "$(cat <<'EOF'
feat(errors): add classifyFetchError helper

Single-purpose classifier that normalizes thrown errors from outbound
fetch calls into a small vocabulary: 'timeout' for AbortError /
TimeoutError, 'network' for Node's TypeError('fetch failed'), and
passthrough err.message otherwise. HTTP errors are pre-formatted by
their throw sites and pass through unchanged.

- src/fetchError.ts: ~10-line classifier, no dependencies
- test/fetchError.test.ts: 7 unit tests covering each branch and the non-Error fallback

EOF
)"
```

---

## Task 2: Normalize HTTP error throws in `feeds.ts`

**Files:**
- Modify: `src/feeds.ts` (line 40)

- [ ] **Step 1: Apply the change**

Replace line 40 in `src/feeds.ts`:

```typescript
// before
if (!res.ok) {
  throw new Error(`fetch ${feed.pageUrl} failed: ${res.status}`);
}
// after
if (!res.ok) {
  throw new Error(`${res.status} ${res.statusText}`.trim());
}
```

- [ ] **Step 2: Run feed tests to confirm regex assertion still passes**

The existing test at `test/feeds.test.ts:77` asserts `.rejects.toThrow(/500/)`. The new message `"500 Internal Server Error"` (or bare `"500"` if statusText is empty in the mock) still matches.

Run: `npx vitest run test/feeds.test.ts`
Expected: PASS — all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/feeds.ts
git commit -m "$(cat <<'EOF'
refactor(feeds): throw normalized HTTP error messages

Non-2xx feed-page fetches now throw '<status> <statusText>' (e.g.,
'403 Forbidden'), trimmed in case statusText is empty. URL is dropped
from the message — it's already on the surrounding ProgressEvent and
on any persisted row.

EOF
)"
```

---

## Task 3: Normalize HTTP error throws in `extract.ts`

**Files:**
- Modify: `src/extract.ts` (line 300)

- [ ] **Step 1: Apply the change**

Replace line 300 in `src/extract.ts`:

```typescript
// before
if (!res.ok) {
  throw new Error(`fetch ${sourceUrl} failed: ${res.status}`);
}
// after
if (!res.ok) {
  throw new Error(`${res.status} ${res.statusText}`.trim());
}
```

- [ ] **Step 2: Run extract tests**

Run: `npx vitest run test/extract.test.ts`
Expected: PASS — no test asserts on the thrown HTTP message format directly.

- [ ] **Step 3: Commit**

```bash
git add src/extract.ts
git commit -m "$(cat <<'EOF'
refactor(extract): throw normalized HTTP error messages

Same shape as feeds.ts: '<status> <statusText>' trimmed. URL omitted
from the message — present on the row via sourceUrl.

EOF
)"
```

---

## Task 4: Wire `classifyFetchError` into `run.ts` catch sites

**Files:**
- Modify: `src/run.ts` (import + both catch blocks)
- Modify (assertion may need updating): `test/run.test.ts`

- [ ] **Step 1: Add the import**

At the top of `src/run.ts`, add to the import block:

```typescript
import { classifyFetchError } from "./fetchError.js";
```

- [ ] **Step 2: Update the feed-level catch (around line 61)**

```typescript
// before
} catch (err) {
  emit({
    type: "feed-error",
    pageUrl: feed.pageUrl,
    error: (err as Error).message,
  });
  return { newLinks: 0, successes: 0, failures: 0 };
}
// after
} catch (err) {
  emit({
    type: "feed-error",
    pageUrl: feed.pageUrl,
    error: classifyFetchError(err),
  });
  return { newLinks: 0, successes: 0, failures: 0 };
}
```

- [ ] **Step 3: Update the article-level catch (around line 100-101)**

```typescript
// before
} catch (err) {
  const error = (err as Error).message;
  feedRows.push({
// after
} catch (err) {
  const error = classifyFetchError(err);
  feedRows.push({
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS. The existing run-test assertion `expect(appended[0].error).toMatch(/500/)` still passes because `"500 Internal Server Error"` (or `"500"` if statusText is empty in the mock `new Response("server error", { status: 500 })`) matches `/500/`.

- [ ] **Step 5: Add one explicit assertion that the error is the new format**

In `test/run.test.ts`, find the test `"records extraction errors as rows with error populated"` (around line 76) and add one assertion after the existing `/500/` check:

```typescript
expect(appended[0].error).toMatch(/^500\b/);
```

This guards against a future regression where someone reintroduces the `"fetch URL failed: 500"` prefix.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/run.ts test/run.test.ts
git commit -m "$(cat <<'EOF'
feat(run): use classifyFetchError at both catch sites

Feed-level and article-level catches now run their thrown error
through classifyFetchError before emitting the ProgressEvent and
persisting to the row. Same normalized string lands in both places,
so the CLI and the sheet's error column no longer diverge.

- Article-level catch: persisted row's `error` field is normalized
- Feed-level catch: feed-error progress event carries the normalized string
- Added assertion in run.test.ts that the persisted error starts with the bare status code, guarding against re-introducing a 'fetch URL failed:' prefix

EOF
)"
```

---

## Task 5: Drop the prefix-stripping hack in `render-progress.ts`

**Files:**
- Modify: `src/render-progress.ts` (line 38-42)

- [ ] **Step 1: Apply the change**

Replace the `extract-result` failure-rendering block in `src/render-progress.ts`:

```typescript
// before
case "extract-result":
  if (e.ok) {
    process.stderr.write(`  [${e.index}/${e.total}] ${green("✓")} ${hostOf(e.sourceUrl)}\n`);
  } else {
    const reason =
      e.error?.replace(`fetch ${e.sourceUrl} failed: `, "").trim() ||
      e.error ||
      "unknown";
    process.stderr.write(`  [${e.index}/${e.total}] ${red("✗")} ${hostOf(e.sourceUrl)} — ${reason}\n`);
  }
  break;
// after
case "extract-result":
  if (e.ok) {
    process.stderr.write(`  [${e.index}/${e.total}] ${green("✓")} ${hostOf(e.sourceUrl)}\n`);
  } else {
    const reason = e.error || "unknown";
    process.stderr.write(`  [${e.index}/${e.total}] ${red("✗")} ${hostOf(e.sourceUrl)} — ${reason}\n`);
  }
  break;
```

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: PASS. `render-progress.ts` has no direct tests; the change is mechanical and only affects what's written to stderr.

- [ ] **Step 3: Commit**

```bash
git add src/render-progress.ts
git commit -m "$(cat <<'EOF'
refactor(render-progress): drop fetch-URL prefix strip

The catch sites in run.ts now normalize errors before they reach the
progress event, so the renderer no longer needs to strip a
'fetch <URL> failed: ' prefix to make the message readable. Simple
passthrough with the existing 'unknown' fallback.

EOF
)"
```

---

## Task 6: Integration verification

**Files:** None (verification only)

- [ ] **Step 1: Type-check the project**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: All tests pass. New module has 7 tests; existing tests still pass with regex-based assertions on `/500/` and the new `/^500\b/` guard in `test/run.test.ts`.

- [ ] **Step 3: Build the dist**

Run: `npm run build`
Expected: No type errors. `dist/fetchError.js` and updated `dist/feeds.js`, `dist/extract.js`, `dist/run.js`, `dist/render-progress.js` exist.

- [ ] **Step 4: Optional smoke check (dry-run)**

If a network is available, run the CLI in dry-run mode to confirm no `"fetch URL failed: "` substring appears in the progress output:

```bash
npx tsx src/cli.ts run --dry-run 2>&1 | grep -E "^\s*\[" | grep -v "✓" || true
```

Failed-extraction lines should show normalized reasons (e.g., `" — 403 Forbidden"`, `" — timeout"`, `" — network"`). The grep is best-effort; if the run produces no failures, the smoke check is inconclusive but not blocking.

- [ ] **Step 5: Final commit if any tidy-up was needed**

If no further changes were necessary, no commit. If a small follow-up was needed (e.g., a docstring tweak), commit it with a `chore:` prefix.

---

## Spec coverage check

| Spec section | Implemented by |
|---|---|
| Normalized vocabulary — HTTP `<status> <statusText>` | Tasks 2, 3 |
| Bare number fallback when `statusText` empty | Tasks 2, 3 (via `.trim()`) + Task 1 test for `"418"` |
| `"timeout"` category | Task 1 (classifier) + Task 4 (wired) |
| `"network"` category | Task 1 (classifier) + Task 4 (wired) |
| Passthrough fallback | Task 1 |
| `feeds.ts` throw-site change | Task 2 |
| `extract.ts` throw-site change | Task 3 |
| `run.ts` catch-site wiring | Task 4 |
| `render-progress.ts` cleanup | Task 5 |
| Tests for classifier | Task 1 |
| Existing tests still pass | Task 4 step 4, Task 6 step 2 |
| No schema change / no migration | (no work needed — spec confirms) |
| Webhook errors out of scope | (no work needed — `src/sheet.ts` untouched) |
