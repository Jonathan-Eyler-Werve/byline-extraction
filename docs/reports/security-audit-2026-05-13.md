# Security Audit Report

**Project:** byline-extraction
**Date:** 2026-05-13
**Audit Mode:** Full
**Auditor:** Claude Code (production-ready skill)

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total Checks** | 10 |
| **Passed** | 8 |
| **Warnings** | 2 |
| **Critical Issues** | 0 |

### Overall Status: ✅ PASS (with minor recommendations)

The project has no critical vulnerabilities, no secrets in source control, and no dependency vulnerabilities. Two non-critical items require attention: a potential ReDoS pattern and missing optional documentation files.

---

## Tech Stack Detected

| Component | Value |
|-----------|-------|
| Primary Language | TypeScript |
| Runtime | Node.js 20 |
| Package Manager | npm |
| Frameworks | Cheerio (HTML parsing) |

---

## Tools Used

| Tool | Version | Purpose | Result |
|------|---------|---------|--------|
| gitleaks | latest | Secret detection in git history | ✅ Clean |
| trufflehog | 3.95.2 | Deep secret scanning with verification | ✅ Clean |
| npm audit | 11.4.0 | npm dependency vulnerabilities | ✅ Clean |
| grype | latest | Multi-language vulnerability scanning | ✅ Clean |
| trivy | 0.70.0 | Comprehensive security scanner | ✅ Clean |
| semgrep | 1.157.0 | Static analysis (SAST) | ⚠️ 1 finding |
| syft | latest | SBOM generation | ✅ Generated |

---

## Findings

### Medium Severity Issues

#### 1. Potential ReDoS in Dynamic RegExp Construction

- **Severity:** Medium
- **Location:** `src/feeds.ts:12`
- **Rule:** `javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp`
- **Description:** `RegExp()` is called with a `feed.linkPattern` argument from configuration. If an attacker could control this value, they could potentially cause Regular Expression Denial-of-Service (ReDoS).

```typescript
const pattern = feed.linkPattern ? new RegExp(feed.linkPattern) : null;
```

- **Risk Assessment:** **Low actual risk** — The `linkPattern` comes from `FeedConfig`, which appears to be developer-controlled configuration, not user input. However, if configs are ever loaded from external sources, this could become exploitable.

- **Remediation Options:**
  1. **Accept risk** (recommended if configs are always developer-controlled)
  2. Add regex complexity validation using a library like [recheck](https://www.npmjs.com/package/recheck)
  3. Wrap in a timeout using `vm.runInNewContext()` with a time limit
  4. Use [re2](https://www.npmjs.com/package/re2) for linear-time regex matching

---

## Dependency Vulnerabilities

| Package | Current | Fixed In | Severity | CVE |
|---------|---------|----------|----------|-----|
| — | — | — | — | — |

**No vulnerable dependencies found.** All 3 direct dependencies and 25 transitive dependencies are free of known vulnerabilities.

---

## SBOM Summary

| Metric | Value |
|--------|-------|
| Total Packages | 28 |
| Direct Dependencies | 3 |
| Transitive Dependencies | 25 |
| SBOM Format | CycloneDX JSON |
| SBOM Location | `docs/reports/sbom-2026-05-13.json` |

---

## Configuration Hardening

| Check | Status | Notes |
|-------|--------|-------|
| `.gitignore` excludes `.env` | ✅ | Properly configured |
| `.gitignore` excludes `*.key`, `*.pem` | ✅ | Properly configured |
| `.env.example` exists | ✅ | Template provided for developers |
| No hardcoded secrets in code | ✅ | Verified by gitleaks + trufflehog |
| Secrets use environment variables | ✅ | `WEBHOOK_URL`, `WEBHOOK_TOKEN` in CI |

---

## Documentation Review

| Document | Status | Notes |
|----------|--------|-------|
| README.md | ✅ | Present |
| LICENSE | ✅ | Present |
| SECURITY.md | ❌ | Missing — recommended for vulnerability reporting |
| CONTRIBUTING.md | ❌ | Missing — optional for private repos |
| CHANGELOG.md | ❌ | Missing — optional |

---

## CI/CD Validation

| Check | Status | Notes |
|-------|--------|-------|
| CI pipeline exists | ✅ | `.github/workflows/run.yml` |
| Secrets in CI use GitHub Secrets | ✅ | `secrets.WEBHOOK_URL`, `secrets.WEBHOOK_TOKEN` |
| Pinned action versions | ✅ | `actions/checkout@v4`, `actions/setup-node@v4` |
| Minimal permissions | ✅ | `contents: read` only |
| Concurrency controls | ✅ | Prevents overlapping runs |
| Security scanning in CI | ❌ | Not configured |

---

## Observability

| Check | Status | Notes |
|-------|--------|-------|
| Health check endpoint | N/A | CLI tool, not a service |
| Structured logging | ❌ | Uses console output |
| Error tracking (Sentry, etc.) | ❌ | Not configured |
| Metrics collection | N/A | CLI tool |

**Note:** This is a CLI/scheduled job, so health endpoints and metrics are not applicable. Structured logging could improve debugging in CI.

---

## Recommendations

### Priority 1 (Consider)

1. **Evaluate ReDoS risk** — If `feed.linkPattern` will only ever come from developer-controlled configs, the semgrep finding can be marked as accepted risk. If configs could come from external sources, add regex validation.

### Priority 2 (Nice to Have)

2. **Add SECURITY.md** — Document how to report vulnerabilities, especially if open-sourcing.

3. **Add security scanning to CI** — Consider adding a workflow step for `npm audit` or `trivy fs .` to catch future vulnerabilities automatically.

---

## Checklist Summary

### Security

- [x] Zero hardcoded secrets detected
- [x] Zero high/critical vulnerabilities with available fixes
- [x] SBOM generated and stored

### Documentation

- [x] README.md present
- [x] LICENSE present
- [ ] SECURITY.md present
- [ ] CHANGELOG.md maintained

### CI/CD

- [x] CI pipeline configured
- [x] Secrets managed via GitHub Secrets
- [x] Pinned action versions
- [ ] Security scanning in pipeline

### Operational

- [x] Environment variables for secrets
- [x] .env.example provided
- [x] .gitignore properly configured

---

## Exit Criteria Assessment

| Criterion | Status |
|-----------|--------|
| Zero high/critical vulnerabilities with fixes | ✅ |
| Zero hardcoded secrets | ✅ |
| Required documentation present | ✅ (README, LICENSE) |
| CI/CD pipeline passes | ✅ |
| SBOM generated | ✅ |
| Security audit report generated | ✅ |

**Verdict:** Project is **production-ready** with minor recommendations noted above.

---

*Generated by production-ready skill v2.0.0*
