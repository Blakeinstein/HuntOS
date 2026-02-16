# Design: Resume Generation

## 1. Overview

This document details the design for the Resume Generation feature. The purpose of this service is to dynamically create a resume tailored specifically for a given job description. It leverages the user's master profile and an LLM to produce a document that highlights the most relevant skills and experience for each application, increasing the chances of passing automated screening systems (ATS) and catching the eye of recruiters.

## 2. Core Features

### 2.1. Dynamic Content Tailoring

-   **LLM-Powered:** The system will use an LLM (via Mastra) to analyze a job description and compare it against the user's master profile.
-   **Keyword Optimization:** The LLM will identify key skills, technologies, and qualifications mentioned in the job description and ensure they are appropriately reflected in the generated resume.
-   **Experience Highlighting:** The service will rephrase or reorder bullet points from the user's work experience to better align with the requirements of the target role.

### 2.2. Resume Versioning

-   Each resume generated for an application will be saved and linked to that application record.
-   This provides a historical record of what was submitted for each job.

### 2.3. Standardized Output

-   The generated resumes will be created in a standard format, such as PDF, to ensure consistent presentation across different platforms.

## 3. Technical Design

### 3.1. Data Model

#### `Resume`

| Column         | Type    | Description                                                  |
|----------------|---------|--------------------------------------------------------------|
| `id`           | INTEGER | Primary Key                                                  |
| `applicationId`| INTEGER | Foreign key linking to the `applications` table.             |
| `filePath`     | TEXT    | The path on the server where the generated resume file is stored. |
| `createdAt`    | TEXT    | ISO 8601 timestamp of when the resume was generated.         |

### 3.2. Backend Services & Logic

-   **Service File:** `src/lib/services/resume.ts` will contain the business logic for generating and managing resumes.
-   **PDF Generation Library:** A library like `pdf-lib` or `puppeteer` (to print a webpage to PDF) will be used to create the final resume file from structured content.

### 3.3. Resume Generation Flow

This process is intended to be triggered automatically by the Browser Automation agent when it begins to process a job application from the `Backlog`.

1.  **Trigger:** The automation agent decides to apply for a job.
2.  **Data Gathering:**
    -   It retrieves the full job description from the job posting page.
    -   It calls `profileService.getProfile()` to get the user's complete, structured professional profile.
3.  **LLM Prompting:**
    -   The system sends the job description and the user's profile data to the LLM.
    -   The prompt will instruct the LLM to act as a professional resume writer. It will be asked to return a structured JSON object representing the tailored resume content. The prompt will be something like: *"You are a resume writing expert. Given the following user profile and job description, generate the content for a one-page resume. Emphasize the skills and experiences from the user's profile that are most relevant to the job description. Return the result as a JSON object with keys: `summary`, `experience`, `education`, `skills`."*
4.  **Content Structuring:** The LLM returns a JSON object containing the tailored text for each section of the resume.
5.  **PDF Creation:**
    -   The `resumeService` takes the JSON object from the LLM.
    -   It populates a pre-defined HTML template with this content.
    -   It uses a PDF generation library to convert the rendered HTML into a PDF file.
6.  **Storage:**
    -   The generated PDF is saved to a designated directory on the server (e.g., `/data/resumes/`).
    -   A new entry is created in the `Resume` table, storing the path to the file and linking it to the current job application.
7.  **Return Path:** The service returns the file path of the newly created resume to the browser automation agent, which can then use it to upload during the application process.

### 3.4. API Endpoints

-   Since this is an internal service called by other backend components, it may not require a dedicated public API endpoint initially. The functionality will be exposed through the `resumeService`. If manual resume generation is desired in the future, an endpoint like `POST /api/resumes` could be added.

## 4. Implementation Notes

-   This feature is currently a placeholder (`resume.ts` exists but is not implemented).
-   The core of this feature is the LLM prompt. It will require careful engineering and iteration to produce high-quality, relevant resume content consistently.
-   A simple, clean, and ATS-friendly HTML template for the resume should be created. Fancy layouts should be avoided as they can be difficult for automated systems to parse.
-   The choice of PDF generation library will be important. `Puppeteer` offers high-fidelity rendering by using a real browser engine, but `pdf-lib` might be lighter and have fewer dependencies.