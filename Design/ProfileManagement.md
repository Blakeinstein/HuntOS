# Design: Profile Management

## 1. Overview

This document details the design of the Profile Management feature. The primary goal is to create a comprehensive, semi-structured profile description of the user through a conversational AI agent. This profile serves as the **single source of truth** for all downstream agents — the job search agent uses it to find relevant positions, and the browser automation agent uses it to fill out applications.

The profile manager is a **Mastra agent** that follows a structured conversation flow: it first understands what the user is looking for, then gathers their professional background, optionally parses their resume and scrapes their external links, and finally produces a comprehensive profile description.

## 2. Conversation Flow

### Phase 1: Job Search Preferences

The agent starts by understanding what the user wants:

1. **Desired job titles / roles** — Target positions (e.g. "Senior Frontend Engineer", "Engineering Manager")
2. **Desired work location** — City, state, country, or "remote"; willingness to relocate
3. **Desired job type** — Full-time, part-time, contract, freelance, internship
4. **Work arrangement** — Remote, hybrid, on-site
5. **Salary expectations** — Optional range
6. **Specific criteria** — Must-haves, dealbreakers, company size, industry, technologies, companies to avoid, visa needs, etc.

### Phase 2: Professional Background

Once preferences are clear, the agent learns about the user:

1. **Professional summary** — Brief elevator pitch
2. **Work experience** — For each role: company, title, dates, responsibilities, achievements
3. **Projects** — Personal, open-source, freelance, side projects with technologies and impact
4. **Education** — Degrees, institutions, dates, coursework, honors
5. **Skills** — Technical (languages, frameworks, tools) and soft skills
6. **Certifications & training** — Professional certs, bootcamps, courses
7. **Languages** — Spoken/written with proficiency levels

### Phase 3: Supplemental Information

The agent offers ways to accelerate profile building:

1. **Resume upload** — User pastes resume text; agent calls `parseResume` tool to extract structured fields automatically
2. **External links** — User shares GitHub, LinkedIn, portfolio URLs; agent calls `scrapeWebsite` tool to fetch and analyze page content, then extracts relevant data
3. **Anything else** — Publications, speaking engagements, volunteer work, awards

### Phase 4: Profile Description Generation

Once sufficient data is gathered:

1. Agent reviews all collected data via `getProfile`
2. Composes a comprehensive semi-structured markdown description
3. Calls `saveProfileDescription` to persist the description and summary
4. Reports completeness score and areas for improvement

## 3. Core Features

### 3.1. LLM-Powered Conversational Profile Building

- **Chat interface** using `@ai-sdk/svelte` `Chat` class with streaming responses
- **Incremental saving** — each piece of information is saved immediately via `updateProfile` tool calls
- **Memory persistence** — conversation history stored via Mastra memory (LibSQL), allowing users to resume where they left off
- **Progress tracking** — agent checks `getIncompleteFields` periodically and guides the user

### 3.2. Resume Parsing

- User pastes raw resume text into the chat
- Agent calls the `parseResume` tool with the raw text and its extraction of structured fields
- Tool saves raw text under `resume_raw_text` and updates individual profile fields
- Array fields (skills, certifications, languages) are **appended** rather than overwritten
- All parsing operations are logged to the **audit system** under the `profile` category

### 3.3. Website Scraping

- User provides URLs (GitHub, LinkedIn, portfolio, etc.)
- Agent calls `scrapeWebsite` tool which:
  - Fetches the page via HTTP with a browser-like User-Agent
  - Detects site type (GitHub, LinkedIn, GitLab, etc.) for contextual hints
  - Strips HTML to plain text (or pretty-prints JSON for API responses)
  - Truncates to 15K chars to stay within context limits
  - Stores URL in `website_urls` and sets specific fields (`github_url`, `linkedin_url`)
  - Accumulates all scraped content under `scraped_content`
- Agent analyzes the returned text and saves relevant data via `updateProfile`
- Falls back gracefully — if scraping fails (blocked, timeout), asks user to paste content manually
- All scraping operations are logged to the **audit system**

### 3.4. Comprehensive Profile Description

- The **most important artifact** produced by the profile manager
- Semi-structured markdown covering:
  - Job Search Preferences
  - Professional Summary
  - Technical Skills / Soft Skills
  - Work Experience (per role)
  - Projects
  - Education
  - Certifications & Training
  - Languages
  - Online Presence (links)
  - Additional Context
- Saved via `saveProfileDescription` tool along with a short 1-3 sentence summary
- Consumed by downstream agents (job search, application filling) as their primary context about the user

### 3.5. Manual Editing

- Form-based interface (tabs: Personal, Professional, Links) for direct viewing and editing
- Complementary to the chat — users can make quick corrections without conversing

### 3.6. Audit Integration

All profile-building operations are logged to the audit system:

| Operation | Category | Agent ID | Details |
|-----------|----------|----------|---------|
| Resume parsing | `profile` | `profile-agent` | Fields extracted, raw text length |
| Website scraping | `profile` | `profile-agent` | URL, site type, text extracted |
| Profile description saved | `profile` | `profile-agent` | Description length, completeness |

Uses the `AuditLogService.start()` timer pattern for duration tracking.

## 4. Technical Design

### 4.1. Data Model

Profile data is stored in the `profiles` table (key-value, `UNIQUE(user_id, key)`).

#### Profile Keys

| Key | Type | Description |
|-----|------|-------------|
| `name` | string | Full name |
| `email` | string | Email address |
| `phone` | string | Phone number |
| `location` | string | Current location |
| `skills` | string[] | Technical and soft skills |
| `experience` | string | Work experience (formatted text) |
| `education` | string | Education history |
| `certifications` | string[] | Professional certifications |
| `languages` | string[] | Spoken/written languages |
| `preferred_companies` | string[] | Target companies |
| `job_titles` | string[] | Target job titles |
| `salary_expectations` | string | Salary range |
| `availability` | string | Start date |
| `resume_summary` | string | Short professional summary |
| `portfolio_url` | string | Portfolio URL |
| `linkedin_url` | string | LinkedIn URL |
| `github_url` | string | GitHub URL |
| `website_urls` | string[] | All professional URLs |
| `desired_location` | string | Where they want to work |
| `desired_job_type` | string | Full-time, part-time, contract, etc. |
| `desired_work_arrangement` | string | Remote, hybrid, on-site |
| `job_search_criteria` | string | Specific criteria, dealbreakers |
| `years_of_experience` | string | Total years |
| `projects` | string | Notable projects (formatted text) |
| `profile_description` | string | **Comprehensive semi-structured description** |
| `resume_raw_text` | string | Raw resume text from upload |
| `scraped_content` | string | Accumulated scraped web content |

### 4.2. Agent Tools

| Tool | ID | Purpose |
|------|----|---------|
| `updateProfile` | `update-user-profile` | Save a single profile field |
| `getProfile` | `get-user-profile` | Retrieve current profile data + completeness |
| `getIncompleteFields` | `get-incomplete-fields` | List missing required fields |
| `parseResume` | `parse-resume` | Extract structured data from pasted resume text |
| `scrapeWebsite` | `scrape-website` | Fetch and extract text from a URL |
| `saveProfileDescription` | `save-profile-description` | Save the comprehensive profile description |

All tools are wrapped with `withToolLogging` for debug-level observability.

### 4.3. API Endpoints

- `GET /api/profile` — Fetch entire profile as structured JSON
- `PUT /api/profile` — Update one or more profile entries
- `POST /api/chat/profile` — Send a chat message to the profile agent (streamed response)
- `GET /api/chat/profile` — Retrieve existing chat history (for session resumption)

### 4.4. Frontend

- **Route:** `/profiles`
- **Components:**
  - `ProfileChat.svelte` — Chat interface using `@ai-sdk/svelte` `Chat` class with custom transport to `/api/chat/profile`. Renders messages with tool invocation status indicators. Loads existing messages on mount for conversation continuity.
  - Profile form tabs (inline in `+page.svelte`) — Personal, Professional, Links tabs for manual editing
- **State:** Page server load provides `profile`, `incompleteFields`, and `completeness`. Chat `onFinish` callback triggers `invalidate('db:profile')` to refresh form data after agent updates.

### 4.5. File Structure

```
src/
├── lib/
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── profile-agent.ts          # Agent factory (wires all tools)
│   │   ├── prompts/
│   │   │   └── profile-agent.md          # System prompt with conversation flow
│   │   └── tools/
│   │       ├── profile-tools.ts          # Core CRUD tools (update, get, incomplete)
│   │       └── profile/
│   │           ├── index.ts              # Barrel export
│   │           ├── parse-resume.ts       # Resume parsing tool
│   │           ├── scrape-website.ts     # Website scraping tool
│   │           └── save-description.ts   # Profile description tool
│   ├── components/
│   │   └── ProfileChat.svelte            # Chat UI component
│   └── services/
│       └── services/
│           └── profile.ts                # ProfileService (DB operations)
├── routes/
│   ├── api/chat/profile/+server.ts       # Chat streaming endpoint
│   ├── api/profiles/+server.ts           # REST profile endpoint
│   └── profiles/
│       ├── +page.server.ts               # Page data loader
│       └── +page.svelte                  # Profile page (tabs + chat)
```

## 5. Completeness Scoring

Profile completeness uses a weighted scoring system:

**Required fields (weight):**
- `name` (1), `email` (1), `phone` (1), `skills` (2), `experience` (2)

**Bonus fields (weight):**
- `education` (1), `desired_location` (1), `desired_job_type` (1), `job_titles` (1), `resume_summary` (1), `profile_description` (2), `projects` (1)

Score = (filled weight / total weight) × 100

## 6. Downstream Usage

The `profile_description` field is the primary artifact consumed by other agents:

- **Job Search Agent** — Reads the description to understand target roles, required skills, location preferences, and salary expectations when searching job boards
- **Application Agent** — Uses the description plus individual profile fields to fill out application forms accurately and consistently

Other agents can access the profile via `ProfileService.getProfileDescription()` or `ProfileService.getProfile()`.