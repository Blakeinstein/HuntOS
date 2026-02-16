# Design: Application Management

## 1. Overview

This document outlines the design for the Application Management feature, which is the central hub for tracking job applications. The primary interface for this feature is a Kanban-style board, referred to as the "Roadmap."

## 2. Core Features

### 2.1. Kanban Board (Roadmap)

-   **Purpose:** To provide a visual representation of the job application pipeline.
-   **Interface:** A multi-column layout where each column represents a "swimlane" or stage in the application process.
-   **Applications:** Each job application will be represented as a card on the board.
-   **Interaction:** Users can drag and drop application cards from one swimlane to another to update their status.

### 2.2. Swimlanes

-   **Default Swimlanes:** The board will come with four default swimlanes:
    -   `Backlog`: For new job postings found by the scraping service.
    -   `Applied`: For applications that have been successfully submitted.
    -   `Rejected`: For applications that have been rejected.
    -   `Action Required`: For applications that require manual user input (e.g., missing information).
-   **Immutable Swimlanes:** The `Backlog`, `Applied`, and `Rejected` swimlanes cannot be removed or renamed by the user.
-   **Custom Swimlanes:** Users can create, rename, and delete their own custom swimlanes to match their personal workflow (e.g., "Phone Screen," "Technical Interview," "Offer").

### 2.3. Application Cards

-   **Content:** Each card on the board will display summary information about the job application, such as:
    -   Job Title
    -   Company Name
    -   Date Applied
-   **Navigation:** Clicking on an application card will navigate the user to a detailed page for that application.

### 2.4. Application Detail Page

-   **Purpose:** To provide a comprehensive view of a single job application.
-   **Contents:**
    -   All details from the original job posting.
    -   The version of the resume that was used for the application.
    -   A record of all the form fields that were filled out by the automation agent.
    -   A history of status changes (i.e., which swimlanes it has been in).
    -   A section for user notes.

## 3. Technical Design

### 3.1. Data Models

#### `Application`

| Column        | Type    | Description                                      |
|---------------|---------|--------------------------------------------------|
| `id`          | INTEGER | Primary Key                                      |
| `jobTitle`    | TEXT    | The title of the job.                            |
| `companyName` | TEXT    | The name of the company.                         |
| `jobUrl`      | TEXT    | The URL of the original job posting.             |
| `status`      | TEXT    | The current status (maps to a swimlane).         |
| `createdAt`   | TEXT    | ISO 8601 timestamp of when the record was created. |
| `updatedAt`   | TEXT    | ISO 8601 timestamp of when the record was last updated. |

#### `Swimlane`

| Column    | Type    | Description                                      |
|-----------|---------|--------------------------------------------------|
| `id`      | INTEGER | Primary Key                                      |
| `name`    | TEXT    | The name of the swimlane (e.g., "Applied").      |
| `isRemovable` | INTEGER | Boolean (0 or 1) indicating if it can be deleted. |
| `order`   | INTEGER | The display order of the swimlane on the board.  |

### 3.2. API Endpoints

-   `GET /api/applications`: Fetches all applications.
-   `POST /api/applications`: Creates a new application.
-   `GET /api/applications/[id]`: Fetches a single application by its ID.
-   `PUT /api/applications/[id]`: Updates an application (e.g., to change its status/swimlane).
-   `DELETE /api/applications/[id]`: Deletes an application.
-   `GET /api/swimlanes`: Fetches all swimlanes.
-   `POST /api/swimlanes`: Creates a new custom swimlane.
-   `PUT /api/swimlanes/[id]`: Updates a swimlane (e.g., to change its name or order).
-   `DELETE /api/swimlanes/[id]`: Deletes a custom swimlane.

### 3.3. Frontend (SvelteKit)

-   **Route:** `/` or `/roadmap` will display the Kanban board.
-   **Component:** A `KanbanBoard.svelte` component will manage the swimlanes and application cards.
-   **State Management:** Svelte stores will be used to manage the state of applications and swimlanes on the client-side, keeping the UI reactive.
-   **Drag and Drop:** Utilize a library like `svelte-dnd-action` for the drag-and-drop functionality. When a card is dropped into a new swimlane, a request will be sent to the `PUT /api/applications/[id]` endpoint to persist the change.

## 4. Implementation Notes

-   The `application.ts` and `swimlane.ts` services in `src/lib/services` contain the business logic for interacting with the database.
-   The UI for the board is located at `src/routes/applications/+page.svelte`.
-   Initial implementation has the basic structure, but drag-and-drop persistence and real-time updates need to be robustly tested.