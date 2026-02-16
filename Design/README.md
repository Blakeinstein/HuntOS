# System Design Documents

This directory contains detailed design documents for the various components of the Auto Job Application platform. Each document focuses on a specific area of functionality.

## Documents

-   [**ApplicationManagement.md**](./ApplicationManagement.md): Describes the design of the job application tracking system, including the Kanban board (Roadmap), swimlanes, and application states.
-   [**ProfileManagement.md**](./ProfileManagement.md): Outlines the user profile system, which allows an LLM to understand the user's skills and experience for filling out applications.
-   [**JobBoardScraping.md**](./JobBoardScraping.md): Details the service responsible for finding and queuing job postings from various job boards like LinkedIn.
-   [**BrowserAutomation.md**](./BrowserAutomation.md): Covers the design of the agent responsible for automatically filling out and submitting job applications in a browser.
-   [**EmailAutomation.md**](./EmailAutomation.md): Explains the system for monitoring a user's email inbox to automatically track the status of submitted applications.
-   [**ResumeGeneration.md**](./ResumeGeneration.md): Describes the service that dynamically generates tailored resumes based on a job description.

## Implemented Features Checklist

This section provides a high-level overview of what has been implemented versus what is still in the design/placeholder phase.

### Core Infrastructure
-   **[✅] Monolithic Structure:** The application is set up as a SvelteKit monolith.
-   **[✅] Database:** SQLite is integrated for data persistence. A `database.ts` service manages the connection and schema.
-   **[✅] Service Layer:** Responsibilities are separated into individual service files (e.g., `application.ts`, `profile.ts`).
-   **[✅] UI/API Routes:** Basic routes for all major features have been created.

### Feature Implementation Status

-   **Application Management (Roadmap):**
    -   **[✅] Basic UI:** The Kanban board UI is in place.
    -   **[✅] Data Model:** Database tables for applications and swimlanes are defined.
    -   **[✅] API Endpoints:** APIs for creating, reading, and updating applications and swimlanes are functional.
    -   **[⚠️] Notes:** Drag-and-drop functionality for moving applications between swimlanes is implemented on the frontend, but the backend logic to persist these changes is present but may need further testing and refinement.

-   **Profile Management:**
    -   **[✅] Basic UI:** A page for profile management exists.
    -   **[✅] Data Model:** A simple key-value table for profile data is in the database.
    -   **[⚠️] Notes:** The UI is basic. The core feature of conversing with an LLM to build the profile is not yet implemented.

-   **Job Board Scraping:**
    -   **[✅] Data Model:** A table for job boards is defined.
    -   **[❌] Notes:** This is one of the least implemented features. The service (`jobBoard.ts`) and UI exist as placeholders. The actual scraping logic using `agent-browser` has not been built. The scheduling mechanism is also not implemented.

-   **Browser Automation:**
    -   **[❌] Notes:** The `browserAgent.ts` service is a placeholder. No integration with `agent-browser` or Copilot Kit has been done. This is a core component that requires significant implementation work.

-   **Email Automation:**
    -   **[✅] Basic UI:** A settings page to connect email accounts exists.
    -   **[⚠️] Notes:** The backend service (`emailMonitor.ts`) uses a placeholder IMAP client. It does not connect to a real email service. The logic for parsing emails and moving applications is conceptual and not implemented. Credential storage is insecure (Base64).

-   **Resume Generation:**
    -   **[❌] Notes:** The `resume.ts` service is a placeholder. There is no UI or backend logic for generating resumes based on job descriptions. This feature has not been implemented.