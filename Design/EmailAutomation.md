# Design: Email Automation

## 1. Overview

This document outlines the design for the Email Automation feature. Its purpose is to connect to a user's email account, monitor for incoming emails related to job applications, and automatically update the status of those applications on the Roadmap board. This reduces manual effort and helps keep the application tracker up-to-date.

## 2. Core Features

### 2.1. Email Account Connection

-   **Secure Connection:** Users can connect their email accounts (initially supporting IMAP-based services like Gmail).
-   **Credential Management:** The system will store the necessary credentials to access the email account.

### 2.2. Automated Email Monitoring

-   **Background Service:** A background process will periodically scan the user's inbox for new emails that might be related to job applications.
-   **Filtering:** The service will use heuristics to identify relevant emails, such as searching for keywords like "application," "interview," "position," or company names from the applications list.

### 2.3. LLM-Powered Email Parsing

-   **Status Classification:** When a relevant email is found, its content (subject and body) will be sent to an LLM.
-   **Swimlane Mapping:** The LLM's task is to classify the email's intent (e.g., rejection, interview request, assessment link) and map it to one of the user's swimlanes on the Roadmap board. For example, an email saying "thank you for your interest, but..." would be classified as `Rejected`. An email asking "are you available for a call next week?" could be mapped to a custom `Interview` swimlane.

### 2.4. Automatic Application Updates

-   Once the LLM has classified an email and identified the corresponding application, the system will automatically move the application card to the appropriate swimlane.
-   A record of this change will be added to the application's history.

## 3. Technical Design

### 3.1. Data Models

#### `EmailAccount`

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Primary Key |
| `emailAddress` | TEXT | The user's email address. |
| `imapHost` | TEXT | The IMAP server hostname. |
| `imapPort` | INTEGER | The IMAP server port. |
| `credentials` | TEXT | **Encrypted** credentials (e.g., password or app-specific password). |
| `isEnabled` | INTEGER | Boolean (0 or 1) to enable/disable monitoring for this account. |

### 3.2. Backend Services & Logic

-   **Service File:** `src/lib/services/emailMonitor.ts` will contain the core logic.
-   **Email Client:** An IMAP client library (e.g., `node-imap` or a more modern equivalent) will be used to connect to the email server and fetch emails. The current `SimpleImapClient` is a placeholder and must be replaced.
-   **Scheduling:** A scheduler (e.g., `node-cron` or a simple `setInterval` for this single-user app) will trigger the email check at a configurable interval (e.g., every 15 minutes).

### 3.3. Email Processing Flow

1.  The scheduled job runs.
2.  It connects to the user's email account using the stored credentials.
3.  It fetches unread emails or emails received since the last check.
4.  For each email, it performs a quick pre-filtering check based on keywords or sender domains matching companies in the `applications` table.
5.  If an email seems relevant, its content is passed to the LLM via a Mastra agent.
6.  The prompt for the LLM will include the email content and a list of available swimlanes. The prompt will ask the LLM to return the name of the most appropriate swimlane and the ID of the application it relates to.
7.  If the LLM returns a valid swimlane and application ID, the `applicationService` is called to update the application's status.

### 3.4. API Endpoints

-   `GET /api/settings/email`: Fetches the list of connected email accounts (without credentials).
-   `POST /api/settings/email`: Adds a new email account and its credentials. The backend will encrypt the credentials before storing them.
-   `DELETE /api/settings/email/[id]`: Deletes a connected email account.

### 3.5. Frontend (SvelteKit)

-   **Route:** `/settings/email` will provide the UI for managing email connections.
-   **Interface:** A simple form to add a new account (email, password/app password, IMAP details) and a list of currently connected accounts with options to disable or remove them.

## 4. Security Considerations

-   **Credential Storage:** Storing user email passwords is a significant security risk.
    -   **Absolute Minimum:** Credentials MUST be encrypted at rest (e.g., using Node.js `crypto` module and a secret key stored in an environment variable). The current Base64 encoding is insecure and is only a placeholder.
    -   **Better Approach:** Encourage or require the use of "app-specific passwords" for services like Gmail, which limits the scope of the password.
    -   **Best Approach (Future):** Implement OAuth 2.0 for services like Google and Microsoft. This is more complex but avoids storing passwords altogether.

## 5. Implementation Notes

-   The `emailMonitor.ts` service exists but uses a placeholder client. This needs to be replaced with a robust IMAP library.
-   The credential storage is currently insecure and must be addressed before this feature is functional.
-   The LLM prompt and the logic for mapping its response to a swimlane need to be designed and implemented.