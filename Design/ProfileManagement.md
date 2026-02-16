# Design: Profile Management

## 1. Overview

This document details the design of the Profile Management feature. The primary goal of this feature is to create a comprehensive, structured profile of the user's professional background, skills, and preferences. This profile will serve as the single source of truth for the browser automation agent when filling out job applications, ensuring consistency and accuracy.

## 2. Core Features

### 2.1. LLM-Powered Profile Building

-   **Conversational Interface:** The main feature is a chat interface where the user can converse with an LLM (via Copilot Kit) to build their profile. The LLM will guide the user by asking targeted questions about their work experience, education, skills, contact information, and other relevant details.
-   **Natural Language Understanding:** The system will parse the user's responses to extract structured data. For example, if a user describes a past job, the LLM should identify the company name, job title, dates of employment, and key responsibilities.

### 2.2. Structured Profile Data

-   The user's profile will be stored as a collection of structured data points, not just a free-form text blob. This allows the application-filling agent to easily retrieve specific information (e.g., "What is the user's phone number?").
-   The profile will be divided into logical sections:
    -   Personal Information (Name, Address, Phone, Email)
    -   Work Experience (Job Title, Company, Dates, Responsibilities)
    -   Education (Degree, Institution, Graduation Date)
    -   Skills (Technical, Soft)
    -   Links (LinkedIn, GitHub, Portfolio)

### 2.3. Manual Editing

-   In addition to the conversational builder, the user will have a form-based interface to directly view, add, edit, and delete any information in their profile. This gives them full control and a way to make quick corrections.

## 3. Technical Design

### 3.1. Data Model

The profile data will be stored in a simple key-value table, which provides flexibility as the profile schema evolves.

#### `Profile`

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Primary Key |
| `key` | TEXT | The unique key for the data point (e.g., `personal.firstName`, `experience.0.jobTitle`). |
| `value` | TEXT | The value associated with the key. |
| `metadata` | TEXT | JSON object for additional context (e.g., `{"type": "string"}`). |

**Example Data:**

| key | value |
| --- | --- |
| `personal.firstName` | "John" |
| `personal.lastName` | "Doe" |
| `experience.0.company` | "Acme Corp" |
| `experience.0.title` | "Software Engineer" |
| `skills.technical.0` | "TypeScript" |

### 3.2. API Endpoints

-   `GET /api/profile`: Fetches the entire user profile as a structured JSON object.
-   `PUT /api/profile`: Updates one or more profile entries. The request body would contain the key-value pairs to be updated.

### 3.3. Frontend (SvelteKit)

-   **Route:** `/profiles` will host the profile management interface.
-   **Components:**
    -   `ChatInterface.svelte`: A component for the conversational interaction with the LLM.
    -   `ProfileForm.svelte`: A form that displays the structured profile data and allows for manual editing.
-   **State Management:** A Svelte store will hold the profile data on the client, ensuring the UI is reactive to changes from both the chat interface and the manual form.

### 3.4. LLM Integration (Copilot Kit)

-   The chat interface will use the Copilot Kit to stream responses from the LLM.
-   A backend "tool" or function will be defined for the LLM to call, named something like `updateUserProfile`.
-   **Flow:**
    1.  User types a message (e.g., "I worked at Acme Corp as a software engineer").
    2.  The message is sent to the LLM with a prompt instructing it to act as a profile builder.
    3.  The LLM processes the text and determines that it needs to update the user's work experience.
    4.  The LLM calls the `updateUserProfile` function with a structured argument, like: `updateUserProfile({ experience: [{ company: "Acme Corp", title: "Software Engineer" }] })`.
    5.  The backend function receives this data and saves it to the `Profile` table in the database.
    6.  The frontend UI, subscribed to the profile store, automatically updates to reflect the new information.

## 4. Implementation Notes

-   The `profile.ts` service in `src/lib/services` contains the business logic for database interactions.
-   The UI is located at `src/routes/profiles/+page.svelte`.
-   The core LLM integration is not yet implemented. This is the most significant piece of work for this feature.
-   The current data model is a simple key-value store. As the feature matures, it may be beneficial to normalize the schema into separate tables for `experience`, `education`, etc., to allow for more complex queries and better data integrity.