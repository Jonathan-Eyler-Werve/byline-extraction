# Unbreaking.org — Issue Pages

Scraped from the unbreaking.org home page (the site's "Issues" index lives at `/`, not `/issues/`).
Date: 2026-05-10. 10 issues total.

| Title | URL |
|---|---|
| Immigration | https://unbreaking.org/issues/immigration/ |
| Equitable Federal Workforce | https://unbreaking.org/issues/equality-at-work-decimating-the-federal-workforce/ |
| Archives & History | https://unbreaking.org/issues/archives-history/ |
| Data Security | https://unbreaking.org/issues/data-security/ |
| Infectious Disease Control & Prevention | https://unbreaking.org/issues/infectious-disease-control/ |
| Transgender Healthcare | https://unbreaking.org/issues/transgender-healthcare/ |
| Food Safety | https://unbreaking.org/issues/food-safety/ |
| Medicaid | https://unbreaking.org/issues/medicaid/ |
| Medical Research Funding | https://unbreaking.org/issues/medical-research-funding/ |
| Postal Service | https://unbreaking.org/issues/postal-service/ |

## Notes

- `/issues/` itself returns 404; no index page at that path.
- No `sitemap.xml`.
- Site uses Pagefind for search (79 indexed pages total — includes blog, about, how-to-help, etc., not just issues).
- All issues follow the `/issues/<slug>/` shape.
- Order above is the order on the home page (Immigration first, Postal Service last).
- For each issue, the article-link selector that works is `.table-timeline a, .footnote a` (per `config.json`).
