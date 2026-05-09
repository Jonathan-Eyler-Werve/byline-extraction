# Project Plan

## Outcome

Improve relationships between The Organization and source authors.

- Improve awareness or The Org
- Create good vibes

We will know it's working if people like hearing from us.

## Output

CSV with one row per article linked from a configured Organization page. Columns: `author`, `authorEmail` (when published on the article page), `sourceUrl` (the article), `pageUrl` (the Organization page it was linked from).

## Scope

CLI app or simple web app on private server.

Assumes someone emails the authors.

Release one milestones
- Validate scraper
- Persist data
- Runnable via CLI

Block two milestones
- cron job
- apply data retention

possible futures
- find more authorEmail
- script the emails?

## Approach

see 2026-05-09-byline design doc for v1

Contraints
- No LLM
- The Org owns deployment stack, if any

## Open Questions

Google sheets vs CRM
Automation / cron requirement
Server?
How does the email outreach happen? Who is the end user?
pilot/rollout

## Adverse impacts

### Most harmed party

Uses public data however authors are now identified in a collected assoctiation with The Organization, which could be used adversarially.

PII => author, association, authorEmail

Mitigations
  - define least-required data retention period
  - automate removals per policy
  - reasonable security on Google sheet
  - reasonable access controls on Google sheet
  - alternatively, store PII in maintained & hardened CRM

### Other advsere impacts

Organization website traffic up (as designed ~20x pageloads weekly)

Source website traffic up (as designed 1x per source)

As designed, ongoing compute less than laptop noise
