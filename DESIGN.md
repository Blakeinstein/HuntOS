# Auto Job Application System - Design Document

## Overview

This document defines the architecture and implementation plan for an automated job application system. The system is designed as a **single-service monolith** using **SvelteKit** to handle both frontend and backend responsibilities, while maintaining clean architectural boundaries for potential future modularization.

### Core Principles

1. **Single User Focus**: Designed exclusively for one user's personal use
2. **Monolithic Architecture**: All services run within one SvelteKit application
3. **SvelteKit as Full-Stack Framework**: Server-side APIs and client-side UI in one codebase
4. **Adaptable Workflow**: Kanban-style application management with customizable swimlanes
5. **AI-Enhanced Automation**: LLM-driven assistance for profile understanding and application completion

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | SvelteKit | Full-stack web application framework |
| UI Library | Skeleton UI | Pre-built component library |
| Browser Automation | agent-browser | Job application form filling |
| LLM Integration | Mastra | AI agent framework for conversational interface and decision making |
| Database | SQLite | Lightweight file-based database |
| Email | IMAP/SMTP | Email monitoring and sending |
| Styling | Tailwind CSS 4 | Utility-first CSS framework |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SvelteKit Monolith                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │   Frontend UI    │  │   API Endpoints  │  │     Server       │       │
│  │  (Svelte 5)      │  │   (+server.ts)   │  │     Logic        │       │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘       │
│           │                     │                     │                 │
│           └─────────────────────┼─────────────────────┘                 │
│                                 │                                       │
│  ┌──────────────────────────────▼────────────────────────────────────┐  │
│  │                         Services Layer                            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                 │                                       │
│  ┌──────────────┬───────────────┼──────────────┬─────────────────────┐ │
│  │  Application │  Job Boards   │  Email       │  Resume Builder     │ │
│  │  Service     │  Watchers     │  Monitor     │  Generator          │ │
│  └──────────────┴───────────────┴──────────────┴─────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                        Agent Browser                               │ │
│  │  (Browser automation for form filling and navigation)             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Database Schema (SQLite)

```sql
-- Users (only one user in this system)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Applications (job applications)
CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    job_description_url TEXT,
    job_description TEXT,
    status_swimlane_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME,
    FOREIGN KEY (status_swimlane_id) REFERENCES swimlanes(id)
);

-- Swimlanes (application status categories)
CREATE TABLE swimlanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_custom BOOLEAN DEFAULT 1,  -- Default swimlanes (Backlog, Applied, Rejected) are non-custom
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Profile information (user's skills, experience, preferences)
CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,  -- e.g., "skills", "experience", "preferred_companies"
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Application fields (form fields for applications)
CREATE TABLE application_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    field_value TEXT,
    is_required BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'pending',  -- 'pending', 'filled', 'missing', 'user_input_required'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id)
);

-- Resume versions
CREATE TABLE resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    content TEXT NOT NULL,  -- Markdown or HTML content
    job_description_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id)
);

-- Email accounts
CREATE TABLE email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,  -- 'gmail', 'outlook', 'imap'
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    is_default BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Job board configurations
CREATE TABLE job_boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    check_interval_minutes INTEGER NOT NULL DEFAULT 1440,  -- Default: 24 hours
    last_checked DATETIME,
    next_check DATETIME,
    is_enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Job board credentials
CREATE TABLE job_board_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_board_id INTEGER NOT NULL,
    username TEXT,
    password_encrypted TEXT,
    session_cookie TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_board_id) REFERENCES job_boards(id)
);

-- Email messages (for monitoring application status)
CREATE TABLE email_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    email_account_id INTEGER NOT NULL,
    message_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    sender TEXT NOT NULL,
    received_at DATETIME NOT NULL,
    processed BOOLEAN DEFAULT 0,
    processed_at DATETIME,
    status_update TEXT,  -- 'interview', 'offer', 'rejected', etc.
    FOREIGN KEY (application_id) REFERENCES applications(id),
    FOREIGN KEY (email_account_id) REFERENCES email_accounts(id)
);

-- Application history (audit trail)
CREATE TABLE application_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    swimlane_id INTEGER NOT NULL,
    changed_by TEXT NOT NULL,  -- 'system', 'user', 'email_monitor'
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id),
    FOREIGN KEY (swimlane_id) REFERENCES swimlanes(id)
);
```

### Default Swimlanes

1. **Backlog** - Applications waiting to be processed (non-removable)
2. **Applied** - Applications that have been submitted (non-removable)
3. **Rejected** - Applications that were rejected (non-removable)
4. **Action Required** - Applications needing user input (non-removable)
5. **Interview** - Application in interview process (custom)
6. **Offer** - Received an offer (custom)

---

## Service Modules

### 1. Application Service (`src/lib/services/application.ts`)

Manages application CRUD operations and swimlane transitions.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `getApplication(id)` | Retrieve a single application with all related data |
| `getApplicationList(swimlaneId?)` | List applications, optionally filtered by swimlane |
| `createApplication(data)` | Create a new application in Backlog swimlane |
| `moveApplication(applicationId, newSwimlaneId, reason)` | Move application to different swimlane |
| `updateApplicationFields(applicationId, fields)` | Update form field values |
| `getApplicationHistory(applicationId)` | Get audit trail for an application |

**Events:**

- `application.created` - New application added
- `application.moved` - Application swimlane changed
- `application.fields.updated` - Form fields updated

---

### 2. Profile Service (`src/lib/services/profile.ts`)

Manages user profile data and LLM-powered profile understanding.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `getProfile(key?)` | Retrieve profile data |
| `updateProfile(key, value)` | Update profile section |
| `analyzeJobDescription(jobDescription)` | Use LLM to extract relevant profile matches |
| `suggestProfileUpdates(jobDescription)` | Recommend profile updates for specific job |

**LLM Integration Points:**

- Profile enrichment from conversation
- Skill mapping to job requirements
- Experience level assessment

---

### 3. Resume Service (`src/lib/services/resume.ts`)

Generates tailored resumes for job applications.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `generateResume(jobDescription, profile)` | Create a tailored resume |
| `saveResume(applicationId, content, jobDescriptionHash)` | Save resume version |
| `getResume(applicationId)` | Retrieve resume for application |
| `calculateResumeMatchScore(resume, jobDescription)` | Calculate match percentage |

**Output Format:**

- Markdown with YAML frontmatter for easy parsing
- PDF export capability via browser printing APIs

---

### 4. Job Board Watcher (`src/lib/services/jobBoards.ts`)

Monitors job boards and adds new postings to the backlog.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `initiateSearch(jobBoard)` | Start job search on a board |
| `parseJobPosting(url, html)` | Extract job details from posting |
| `addApplicationFromJob(jobData)` | Create application from job posting |
| `scheduleAutomaticSearches()` | Run scheduled searches |

**Supported Job Boards:**

- **LinkedIn** (initial)
  - Company job listings
  - Job board aggregations
  - Skill-based job recommendations

**Configuration:**

```typescript
interface JobBoardConfig {
  name: string;
  baseUrl: string;
  checkIntervalMinutes: number;
  searchQueries: string[];  // Job search terms
  location: string;
  isRemote: boolean;
}
```

---

### 5. Email Monitor (`src/lib/services/emailMonitor.ts`)

Monitors email for application status updates.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `connectEmailAccount(accountId)` | Connect to email account |
| `fetchUnreadMessages()` | Retrieve unread emails |
| `parseApplicationStatus(email)` | Extract status from email body |
| `updateApplicationStatus(applicationId, status)` | Update application based on email |

**Email Patterns Detected:**

- **Interview requests** → Move to "Interview" swimlane
- **Rejection emails** → Move to "Rejected" swimlane
- **Offer letters** → Move to "Offer" swimlane
- **Information requests** → Move to "Action Required" swimlane

---

### 6. Browser Automation Agent (`src/lib/services/agentBrowser.ts`)

Uses `agent-browser` to fill out application forms.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `launchBrowser()` | Start browser instance |
| `navigateToApplication(url)` | Navigate to application form |
| `fillField(fieldName, value)` | Fill form field with value |
| `submitApplication()` | Submit completed form |
| `extractMissingFields()` | Identify fields that couldn't be auto-filled |

**Missing Field Handling:**

1. Identify unfilled required fields
2. Mark application as "Action Required"
3. Store field names for user to complete

---

## API Routes (`src/routes/api/`)

All API routes use SvelteKit's server-side endpoints (`+server.ts`).

```
src/routes/api/
├── applications/
│   ├── +server.ts          # GET (list), POST (create)
│   └── [id]/
│       ├── +server.ts      # GET, PUT, DELETE
│       └── move/
│           └── +server.ts  # POST to move swimlane
├── profiles/
│   └── +server.ts          # GET, PUT profile
├── resumes/
│   ├── +server.ts          # POST generate resume
│   └── [id]/
│       └── +server.ts      # GET resume
├── job-boards/
│   ├── +server.ts          # GET list, POST add config
│   └── [id]/
│       ├── +server.ts      # GET, PUT, DELETE
│       └── search/
│           └── +server.ts  # POST start search
├── email-accounts/
│   ├── +server.ts          # GET list, POST add
│   └── [id]/
│       ├── +server.ts      # GET, PUT, DELETE
│       └── sync/
│           └── +server.ts  # POST sync emails
└── swimlanes/
    ├── +server.ts          # GET list, POST create
    └── [id]/
        ├── +server.ts      # GET, PUT, DELETE
        └── applications/
            └── +server.ts  # GET applications in swimlane
```

---

## Frontend Pages (`src/routes/`)

```
src/routes/
├── +layout.svelte          # Main layout with tabs
├── +page.svelte           # Redirect to /applications
├── applications/
│   ├── +page.svelte       # Roadmap/Kanban board
│   └── [id]/
│       ├── +page.svelte   # Application details
│       └── edit/
│           └── +page.svelte  # Edit application
├── profiles/
│   └── +page.svelte       # Profile management
└── settings/
    ├── +page.svelte       # Settings hub
    ├── email/
    │   └── +page.svelte   # Email connections
    └── job-boards/
        └── +page.svelte   # Job board configuration
```

### Layout Structure

```svelte
<!-- +layout.svelte -->
<svelte:fragment>
  <nav class="tabs">
    <a href="/applications">Roadmap</a>
    <a href="/profiles">Profiles</a>
    <a href="/settings">Settings</a>
  </nav>
  <main>{children}</main>
</svelte:fragment>
```

---

## User Workflows

### 1. Initial Setup

```
1. User starts app
2. System checks for default swimlanes
3. If missing, create: Backlog, Applied, Rejected, Action Required
4. User configures email account (optional)
5. User configures job boards (LinkedIn initially)
6. User completes initial profile
```

### 2. Job Application Process

```
1. Job board watcher finds new posting
2. Application created in "Backlog" swimlane
3. Agent browser automates application form filling
4. If fields missing → Move to "Action Required"
5. User provides missing info
6. Application moved to "Applied"
7. Email monitor checks for status updates
8. Application moved based on response email
```

### 3. Profile-Driven Application

```
1. User converses with LLM to build profile
2. LLM extracts skills, experience, preferences
3. When new job found, LLM suggests profile matches
4. Resume generated using profile data
5. Application automated with profile info
```

---

## State Management

### Svelte 5 Stores

```typescript
// src/lib/stores/applications.ts
const applications = writable<Application[]>([]);
const selectedApplication = writable<Application | null>(null);
const swimlanes = writable<Swimlane[]>([]);

// src/lib/stores/profile.ts
const profile = writable<ProfileData>({});
const profileIncomplete = writable<string[]>([]);

// src/lib/stores/session.ts
const user = writable<User | null>(null);
const isLoading = writable(false);
```

### Reactive Data Flow

```
API Response → Store Update → Svelte 5 $store → UI Reactivity
```

---

## Browser Automation Integration

### agent-browser Usage

```typescript
// src/lib/services/agentBrowser.ts
import { Browser } from 'agent-browser';

export class ApplicationAgent {
  private browser: Browser;
  
  async fillForm(application: Application) {
    await this.browser.visit(application.jobDescriptionUrl);
    
    // Fill common fields using profile data
    await this.browser.fill('#first-name', this.profile.firstName);
    await this.browser.fill('#last-name', this.profile.lastName);
    await this.browser.fill('#email', this.profile.email);
    await this.browser.fill('#phone', this.profile.phone);
    
    // Resume upload
    const resume = await this.resumeService.generateResume(
      application.jobDescription,
      this.profile
    );
    await this.browser.upload('#resume', resume);
    
    // Identify missing fields
    const missing = await this.browser.identifyMissingFields();
    
    return { completed: missing.length === 0, missing };
  }
}
```

---

## LLM Integration (Mastra)

### Profile Understanding

```
User: "I'm a frontend developer with 5 years experience"
LLM → Updates profile.skills to ["React", "TypeScript", "Svelte"]
LLM → Updates profile.yearsExperience to 5
LLM → Updates profile.jobTitle to "Senior Frontend Developer"
```

### Application Decision Making

```
Email: "We'd like to schedule an interview for you"
LLM → Extract status: "interview"
LLM → Suggest swimlane: "Interview"
LLM → Generate summary: "Scheduling interview for Frontend Developer role"
```

---

## Deployment

### Production Build

```bash
# Install dependencies
bun install

# Build for production
npm run build

# Preview
npm run preview
```

### Docker (Optional for advanced users)

```dockerfile
# Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "build"]
```

---

## Development Setup

```bash
# Clone repository
git clone <repo>
cd auto-job-application

# Install dependencies
bun install

# Start development server
npm run dev

# Access app at http://localhost:5173
```

---

## Configuration Files

```typescript
// src/lib/config.ts
export const CONFIG = {
  defaultSwimlanes: [
    { name: 'Backlog', description: 'Applications to be processed', isCustom: false },
    { name: 'Applied', description: 'Applications submitted', isCustom: false },
    { name: 'Rejected', description: 'Applications that were rejected', isCustom: false },
    { name: 'Action Required', description: 'Need user input', isCustom: false }
  ],
  jobBoards: ['linkedin'],
  emailProviders: ['gmail', 'outlook', 'imap'],
  resumeFormats: ['markdown', 'pdf']
};
```

---

## Future Enhancements

1. **Multi-User Support**: Add user accounts and authentication
2. **Advanced Analytics**: Application success rate, time-to-offer metrics
3. **Custom Form Templates**: Save common application form structures
4. **Cover Letter Generator**: AI-powered cover letter writing
5. **Interview Preparation**: LLM-based interview question generation
6. **Salary Negotiation Assistant**: Data-driven negotiation guidance
7. **Reference Manager**: Track and manage references
8. **Offer Comparison Tool**: Side-by-side offer evaluation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Applications per week | 20+ |
| Auto-fill rate | 80%+ |
| Time saved per application | 15+ minutes |
| Email status updates | Real-time |

---

## License

Proprietary - Single user license
```
````
