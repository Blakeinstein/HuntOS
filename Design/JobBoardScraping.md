# Design: Job Board Scraping

## 1. Overview

This document describes the design of the Job Board Scraping feature. The goal is to automate the discovery of new job opportunities from various online job boards (initially LinkedIn) and collect structured listing details — company name, location, job type (remote/hybrid/on-site), salary, and a description containing responsibilities — then add them to the `Backlog` swimlane on the user's Roadmap.

**Important:** This feature is strictly concerned with **scraping job postings**. The scraping agents do not attempt to apply for jobs, fill out application forms, or generate form fields. Form fields are only relevant during the separate application automation phase (see `BrowserAutomation.md`).

## 2. Core Features

### 2.1. Scheduled Job Hunting

-   **Automated Scraping:** A background service will automatically visit specified job board URLs on a user-defined schedule.
-   **Configurable Schedule:** The user can configure how often the scraper should run for each job board (e.g., daily, weekly).

### 2.2. Configurable Job Boards

-   **User-Defined Sources:** Users can add multiple job search URLs to be monitored. For example, a user could have one source for "Senior Frontend Developer jobs in New York" and another for "Remote TypeScript jobs".
-   **Initial Support:** The initial implementation will focus exclusively on scraping LinkedIn job search result pages.

### 2.3. Queuing New Listings

-   **Backlog Integration:** When the scraper finds a new job posting that is not already in the system, it will create a new application entry with the scraped listing details and place it in the `Backlog` swimlane.
-   **Duplicate Prevention:** The system will check the URL of a job posting to ensure it doesn't add duplicates to the backlog.
-   **No Form Fields:** Scraped listings only store job details (title, company, location, job type, salary, description) directly on the application record. No `application_fields` rows are generated during scraping — those are only relevant when actually applying for a job.

## 3. Technical Design

### 3.1. Data Model

#### `JobBoard`

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Primary Key |
| `name` | TEXT | A user-friendly name for the job search (e.g., "LinkedIn - Remote Svelte Jobs"). |
| `url` | TEXT | The full URL of the job search results page to be scraped. |
| `schedule` | TEXT | A cron string representing the scraping schedule (e.g., `0 9 * * *` for 9 AM daily). |
| `isEnabled` | INTEGER | Boolean (0 or 1) to enable or disable scraping for this source. |
| `lastRunAt` | TEXT | ISO 8601 timestamp of the last time the scraper ran for this source. |
| `maxListingsPerScrape` | INTEGER | Maximum number of job listings to collect per scrape session. Default: `25`. |
| `lastScrapedPage` | INTEGER | The 1-based page number the scraper last stopped on (nullable). |
| `lastScrapedPageUrl` | TEXT | The full URL (with pagination query params) of the page the scraper last stopped on (nullable). |
| `lastPageScrapedAt` | TEXT | ISO 8601 timestamp of when the pagination bookmark was saved (nullable). |
| `pageRetentionDays` | INTEGER | Number of days to retain the pagination bookmark before resetting. Default: `3`. |

#### Scraped Job Output Schema

Each scraped job listing is returned by the agent as a structured object with the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | The job title |
| `company` | string | The company name |
| `location` | string \| null | The job location (city, state, country) |
| `url` | string | Absolute URL for the individual job posting (used for deduplication) |
| `job_type` | enum | Work arrangement: `"remote"`, `"hybrid"`, `"on-site"`, or `"unknown"` |
| `salary_range` | string \| null | Salary range if displayed |
| `description` | string \| null | Visible description/responsibilities snippet from the listing card |
| `posted_at` | string \| null | When the job was posted |

**Note:** There is no `relevance` score — the scraper collects all visible listings without filtering. There are no form fields generated — the scraper only extracts listing details.

### 3.1.1. Pagination & Resume Behaviour

The scraper supports resuming from the last scraped page so that consecutive scrape sessions produce fresh results rather than re-scraping the same listings.

#### How It Works

1. **Before each scrape** the system calls `resolvePaginationState(jobBoardId)` which reads `lastScrapedPage`, `lastScrapedPageUrl`, and `lastPageScrapedAt` from the `JobBoard` row.
2. **Retention check:** If `lastPageScrapedAt` is older than `pageRetentionDays`, the bookmark is considered stale (the job board has likely refreshed its listings). The bookmark is cleared and the scrape starts from page 1.
3. **Resume or start fresh:** If the bookmark is still valid, the scraper navigates directly to `lastScrapedPageUrl` and begins extracting from there. Otherwise it uses the board's base `url`.
4. **Sub-agent routing:** The sub-agent is always resolved against the board's **base URL** (not the paginated resume URL) to prevent pagination query parameters (e.g. `&start=50`) from causing a routing mismatch.
5. **Listing cap:** The scraper (and the underlying agent prompt) enforce `maxListingsPerScrape`. Once enough listings have been collected the agent stops scrolling/paginating.
6. **After each scrape** the agent reports `current_page`, `current_page_url`, and `has_more_pages` in its structured output.
7. **Bookmark advancement (key logic):**
   - If `has_more_pages` is `true`: the system stores `current_page + 1` as the resume bookmark so the **next** session starts on the page **after** the one already scraped — avoiding re-scraping the same page.
   - If `has_more_pages` is `false`: the system **clears** the bookmark entirely so the next session starts from page 1. The board has been fully traversed and will have refreshed listings by the next scheduled run.
   - If the agent omitted pagination fields (defensive fallback): the existing bookmark is left untouched.
8. **Next-page URL computation:** The system attempts to automatically build the next page's URL by detecting and incrementing common pagination query parameters (`start`, `page`, `p`, `offset`) in the `current_page_url`. If no known parameter is detected, the current URL is stored as a fallback and the agent uses the `resume_page` number to navigate.

#### Duplicate Handling

The `addApplicationFromJob` method returns `{ id, isNew }` so the persistence layer accurately distinguishes:
- **New applications** (`isNew: true`) — a row was inserted into the `applications` table.
- **Duplicates skipped** (`isNew: false`) — the URL already existed; the existing row's ID is returned without modification.
- **Errors** — database or validation failures are counted separately and logged.

This prevents the previous bug where duplicates were silently counted as "new" because the returned ID was always > 0.

#### Configuration Defaults

| Setting | Default | Description |
| --- | --- | --- |
| `maxListingsPerScrape` | 25 | Jobs collected per session before the agent stops. Configurable per board in the UI. |
| `pageRetentionDays` | 3 | Days before the resume bookmark expires and the scrape resets to page 1. Configurable per board. |

#### Pagination Context (Agent Side)

A `PaginationContext` JSON object is injected into each scraping agent's dynamic context at runtime:

```json
{
  "resume_page": 2,
  "resume_page_url": "https://www.linkedin.com/jobs/search?keywords=typescript&start=25",
  "max_listings": 25
}
```

The agent is instructed to:
- Navigate to `resume_page_url` (or the base URL if `null`).
- Stop extracting once `max_listings` is reached.
- Report `current_page`, `current_page_url`, and `has_more_pages` in its JSON response.
- `has_more_pages` must be `true` if the agent stopped because it hit `max_listings` but more results were available (e.g. a "Next" button existed), or `false` if the agent reached the end of all available results.

#### Agent Output Schema (Pagination Fields)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `current_page` | number | Yes | The 1-based page number the agent finished scraping. |
| `current_page_url` | string | Yes | The full URL of that page (with pagination query params). |
| `has_more_pages` | boolean | Yes | Whether additional pages exist beyond the last page scraped. |
| `total_found` | number | Yes | Must equal `jobs.length` — the count of listings in the response. |

### 3.2. Backend Services & Logic

-   **Service File:** `src/lib/services/jobBoard.ts` will contain the business logic for managing job board configurations.
-   **Browser Automation Agent:** The actual scraping will be performed by the `BrowserAutomation` agent (detailed in `BrowserAutomation.md`), using `agent-browser`.
-   **Scheduler:** A cron-based scheduler (e.g., `node-cron`) will be used to trigger the scraping tasks.
    -   The scheduler will run periodically (e.g., every hour).
    -   It will query the `JobBoard` table for all enabled sources whose `schedule` matches the current time.
    -   For each matched source, it will trigger a scraping task.

### 3.3. Scraping Flow

1.  The scheduler triggers a job for a specific `JobBoard` entry.
2.  The system launches a headless browser instance using `agent-browser`.
3.  **Authentication (Challenge):** The agent navigates to LinkedIn. It will need to be logged in to see full job details. This will likely require the user to provide a session cookie that the agent can inject into the browser instance. Storing this cookie securely is paramount.
4.  The agent navigates to the `url` specified in the `JobBoard` entry.
5.  The system resolves the pagination state for this board (resume page or start fresh based on retention expiry).
6.  A `PaginationContext` is built and injected into the agent's request context alongside the target URL and user profile.
7.  The sub-agent is resolved against the board's **base URL** (not the paginated resume URL) to ensure correct routing regardless of pagination query parameters.
8.  The agent navigates to the resume URL (or the base URL if starting fresh) and extracts job listings, stopping once `maxListingsPerScrape` is reached. **The agent only reads listing data — it does NOT click "Apply" or interact with application forms.**
9.  For each listing, the agent extracts: title, company, location, job type (remote/hybrid/on-site/unknown), salary range, description/responsibilities, and posted date.
10. For each extracted job URL, the system checks if an application with that URL already exists in the `applications` table (deduplication by URL). `addApplicationFromJob` returns `{ id, isNew }` so new vs duplicate counts are accurate.
11. If the job is new, the system creates a new application record with the scraped listing details stored in the `job_description` column and places it in the `Backlog` swimlane. **No `application_fields` rows are created** — form fields are only relevant during the application automation phase.
12. The `lastRunAt` timestamp for the `JobBoard` is updated.
13. **Pagination bookmark advancement:** Based on the agent's `has_more_pages` flag:
    - `true` → store `current_page + 1` and the computed next-page URL as the bookmark (the system auto-increments known pagination params like `start`, `page`, `p`, `offset`).
    - `false` → clear the bookmark so the next session starts from page 1.

### 3.4. API Endpoints

-   `GET /api/settings/job-boards`: Fetches all configured job board sources.
-   `POST /api/settings/job-boards`: Adds a new job board source.
-   `PUT /api/settings/job-boards/[id]`: Updates a job board source (e.g., to change its schedule or URL).
-   `DELETE /api/settings/job-boards/[id]`: Deletes a job board source.

### 3.5. Frontend (SvelteKit)

-   **Route:** `/settings/job-boards` will provide the UI for managing scraping sources.
-   **Interface:** A form to add a new source (name, URL, schedule, max listings per scrape, page retention days) and a list of existing sources with controls to edit, delete, or temporarily disable them. Each board card displays the current pagination bookmark (e.g., "Resumes at page 3") and retention window.

## 4. Implementation Notes

-   The scraping agents' instructions explicitly forbid clicking "Apply" buttons or interacting with application forms. The agents are only permitted to read and extract listing data from search result pages.
-   The `scrapedJobSchema` includes a `job_type` field (enum: `remote`, `hybrid`, `on-site`, `unknown`) and a `description` field for any visible responsibilities/snippet text. These are persisted as part of the application's `job_description` column.
-   No `application_fields` rows are generated during scraping. The old approach of creating form fields (e.g., `job_title`, `company`, `location`, `salary_range`) from scraped data has been removed — listing details are stored directly on the application record.
-   This feature uses `agent-browser` for browser automation, with site-specific sub-agents (LinkedIn, Greenhouse) and a generic fallback agent.
-   The most significant technical challenge will be handling authentication with job board sites like LinkedIn, which have strong anti-bot measures. Using pre-authenticated session cookies is a common workaround.
-   The HTML structure of job boards changes frequently, which will break the scraper. The scraping logic needs to be designed to be as resilient as possible, but it will require ongoing maintenance.