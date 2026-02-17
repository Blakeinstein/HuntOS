# Design: Job Board Scraping

## 1. Overview

This document describes the design of the Job Board Scraping feature. The goal is to automate the discovery of new job opportunities from various online job boards (initially LinkedIn) and add them to the `Backlog` swimlane on the user's Roadmap for further processing.

## 2. Core Features

### 2.1. Scheduled Job Hunting

-   **Automated Scraping:** A background service will automatically visit specified job board URLs on a user-defined schedule.
-   **Configurable Schedule:** The user can configure how often the scraper should run for each job board (e.g., daily, weekly).

### 2.2. Configurable Job Boards

-   **User-Defined Sources:** Users can add multiple job search URLs to be monitored. For example, a user could have one source for "Senior Frontend Developer jobs in New York" and another for "Remote TypeScript jobs".
-   **Initial Support:** The initial implementation will focus exclusively on scraping LinkedIn job search result pages.

### 2.3. Queuing New Applications

-   **Backlog Integration:** When the scraper finds a new job posting that is not already in the system, it will create a new application entry and place it in the `Backlog` swimlane.
-   **Duplicate Prevention:** The system will check the URL of a job posting to ensure it doesn't add duplicates to the backlog.

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

### 3.1.1. Pagination & Resume Behaviour

The scraper supports resuming from the last scraped page so that consecutive scrape sessions produce fresh results rather than re-scraping the same listings.

#### How It Works

1. **Before each scrape** the system calls `resolvePaginationState(jobBoardId)` which reads `lastScrapedPage`, `lastScrapedPageUrl`, and `lastPageScrapedAt` from the `JobBoard` row.
2. **Retention check:** If `lastPageScrapedAt` is older than `pageRetentionDays`, the bookmark is considered stale (the job board has likely refreshed its listings). The bookmark is cleared and the scrape starts from page 1.
3. **Resume or start fresh:** If the bookmark is still valid, the scraper navigates directly to `lastScrapedPageUrl` and begins extracting from there. Otherwise it uses the board's base `url`.
4. **Listing cap:** The scraper (and the underlying agent prompt) enforce `maxListingsPerScrape`. Once enough listings have been collected the agent stops scrolling/paginating.
5. **After each scrape** the agent reports `current_page` and `current_page_url` in its structured output. The system persists these as the new bookmark so the next session can pick up where this one left off.

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
- Report `current_page` and `current_page_url` in its JSON response.

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
7.  The agent navigates to the resume URL (or the base URL if starting fresh) and extracts job listings, stopping once `maxListingsPerScrape` is reached.
8.  For each extracted job URL, the system checks if an application with that URL already exists in the `applications` table.
9.  If the job is new, the system calls the `applicationService` to create a new application record with the extracted details and places it in the `Backlog` swimlane.
10. The `lastRunAt` timestamp for the `JobBoard` is updated.
11. The pagination bookmark (`lastScrapedPage`, `lastScrapedPageUrl`, `lastPageScrapedAt`) is updated from the agent's reported `current_page` and `current_page_url`.

### 3.4. API Endpoints

-   `GET /api/settings/job-boards`: Fetches all configured job board sources.
-   `POST /api/settings/job-boards`: Adds a new job board source.
-   `PUT /api/settings/job-boards/[id]`: Updates a job board source (e.g., to change its schedule or URL).
-   `DELETE /api/settings/job-boards/[id]`: Deletes a job board source.

### 3.5. Frontend (SvelteKit)

-   **Route:** `/settings/job-boards` will provide the UI for managing scraping sources.
-   **Interface:** A form to add a new source (name, URL, schedule, max listings per scrape, page retention days) and a list of existing sources with controls to edit, delete, or temporarily disable them. Each board card displays the current pagination bookmark (e.g., "Resumes at page 3") and retention window.

## 4. Implementation Notes

-   This feature is heavily dependent on the `BrowserAutomation` agent, which has not yet been implemented.
-   The most significant technical challenge will be handling authentication with job board sites like LinkedIn, which have strong anti-bot measures. Using pre-authenticated session cookies is a common workaround.
-   The HTML structure of job boards changes frequently, which will break the scraper. The scraping logic needs to be designed to be as resilient as possible, but it will require ongoing maintenance.
-   The `jobBoard.ts` service and the UI page are currently placeholders and need to be implemented.