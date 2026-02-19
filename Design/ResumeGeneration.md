# Design: Resume Generation

## 1. Overview

This document details the design for the Resume Generation feature. The service dynamically creates a resume tailored for a given job description by leveraging the user's master profile, an LLM (via AI SDK + OpenRouter), and configurable Handlebars templates to produce ATS-friendly Markdown output.

The core generation logic is adapted from [resume-ai](https://github.com/Blakeinstein/resume-ai) (MIT), ported from Node.js/Express into the SvelteKit service layer as native TypeScript using the AI SDK's `generateObject` for structured output.

## 2. Core Features

### 2.1. Dynamic Content Tailoring

-   **LLM-Powered:** The system uses the AI SDK with OpenRouter (the same provider used by all other agents in the project) to analyse a job description against the user's profile.
-   **Structured Output:** The LLM returns a Zod-validated JSON object (via `generateObject`), guaranteeing a well-typed response that can be reliably rendered through a template.
-   **STAR-Method Achievements:** The prompt instructs the LLM to write experience achievements using the Situation-Task-Action-Result framework.
-   **Keyword Alignment:** The LLM is prompted to use relevant keywords and phrasing from the job listing to optimise for ATS systems.

### 2.2. Configurable Templates

-   Resume output is rendered through **Handlebars templates** stored in the database.
-   A built-in **Default** template (shipped in `src/lib/services/resume/defaultTemplate.md`) is auto-seeded on first use.
-   Users can **create custom templates**, **edit any template** (including the default), and **reset the default** back to the on-disk version.
-   Template selection happens at generation time — the user picks which template to use before clicking Generate.

### 2.3. Resume Versioning

-   Each resume generated for an application can be saved and linked to that application record via the existing `ResumeService`.
-   This provides a historical record of what was submitted for each job.

## 3. Architecture

### 3.1. Generation Pipeline

The pipeline mirrors the original resume-ai flow, rewritten in TypeScript:

```
1. Profile → plain text    (profileToText)
2. Prompt assembly         (defaultPrompt.txt + placeholders)
3. LLM call                (AI SDK generateObject + Zod schema)
4. Template rendering      (Handlebars compile + structured JSON)
5. Markdown output         (returned to caller / displayed in UI)
```

### 3.2. Service Layer

#### `ResumeGenerationService` (`src/lib/services/services/resumeGeneration.ts`)

The main orchestrator. Responsibilities:

1.  Loads the user profile via `ProfileService.getProfile()`.
2.  Serialises structured profile data into a plain-text block suitable for the LLM prompt (including `profile_description`, `resume_raw_text`, skills, experience, education, etc.).
3.  Reads the LLM prompt template from `src/lib/services/resume/defaultPrompt.txt` and fills `{resumeText}` / `{jobDescription}` placeholders.
4.  Calls the LLM via AI SDK's `generateObject` with a Zod schema (`resumeDataSchema`), so the response is always validated and well-typed.
5.  Resolves the selected Handlebars template (or falls back to the default).
6.  Compiles the template and renders the structured JSON into Markdown.
7.  Returns `{ markdown, data, templateName }`.

Configuration:
-   **`model`** — OpenRouter model identifier (default: `qwen/qwen3-30b-a3b-instruct-2507`).
-   **`timeoutMs`** — Abort signal timeout (default: 120 000ms / 2 minutes).

#### `ResumeTemplateService` (`src/lib/services/services/resumeTemplate.ts`)

CRUD service for resume Handlebars templates stored in the `resume_templates` table.

-   **`seed()`** — Auto-seeds the default template from disk on first access.
-   **`list()`** — Returns all templates, default first.
-   **`getDefault()`** / **`getById(id)`** — Template lookups.
-   **`create(input)`** / **`update(id, input)`** / **`remove(id)`** — User template CRUD.
-   **`resetDefault()`** — Resets the default template content back to the on-disk version.

#### Existing `ResumeService` (`src/lib/services/services/resume.ts`)

Unchanged. Continues to handle:
-   Saving resume versions to the database (linked to applications).
-   Retrieving resume history.
-   Calculating match scores.

The two services are complementary: `ResumeGenerationService` creates the content, `ResumeService` persists and manages versions.

### 3.3. Data Model

#### `resume_templates`

| Column       | Type    | Description                                                  |
|--------------|---------|--------------------------------------------------------------|
| `id`         | INTEGER | Primary Key                                                  |
| `name`       | TEXT    | Unique template name (e.g. "Default", "Minimal")             |
| `content`    | TEXT    | Handlebars-flavoured Markdown template content               |
| `is_default` | BOOLEAN | Whether this is the built-in default (non-deletable)         |
| `created_at` | TEXT    | ISO 8601 timestamp                                           |
| `updated_at` | TEXT    | ISO 8601 timestamp                                           |

#### Structured Resume JSON (Zod Schema — `src/lib/services/resume/schema.ts`)

```json
{
  "name": "string",
  "professional_profile": "string",
  "skills": ["string"],
  "experience": [{
    "job_title": "string",
    "company": "string",
    "location": "string",
    "start_date": "string",
    "end_date": "string",
    "achievements": ["string"]
  }],
  "education": [{
    "degree": "string",
    "institution": "string",
    "location": "string",
    "graduation_date": "string"
  }],
  "certifications": [{ "name": "string", "issuer": "string", "date": "string" }],
  "projects": [{ "name": "string", "description": "string", "technologies": ["string"] }],
  "additional_info": { "key": "value" }
}
```

### 3.4. Resume Agent (Mastra)

The resume generation pipeline is also exposed as a conversational **Mastra agent** (`resume-agent`) that can interactively guide the user through resume creation.

#### Agent Prompt (`src/lib/mastra/prompts/resume-agent.md`)

The system prompt instructs the agent to:

1.  Load the user's profile and available templates at the start of every conversation.
2.  Ask for a job description, then analyse it against the profile — summarising alignment, gaps, and template choice.
3.  Optionally search uploaded documents (via RAG) for precise details before generating.
4.  Call `generateResume` to run the full pipeline and present the rendered Markdown.
5.  Iterate on feedback — re-generate with adjusted emphasis, different templates, or refined job descriptions.

#### Agent Tools (`src/lib/mastra/tools/resume/`)

| Tool | ID | Description |
|------|----|-------------|
| `getProfile` | `get-user-profile` | Read-only profile access (reused from profile tools). Returns all profile data + completeness score. |
| `searchDocuments` | `search-documents` | RAG search across uploaded documents (reused from profile tools). Finds precise details like dates, metrics, certifications. |
| `listTemplates` | `list-resume-templates` | Lists all Handlebars templates with ID, name, default flag, and content preview. |
| `generateResume` | `generate-resume` | Core tool — accepts `{ jobDescription, templateId? }`, runs the full generation pipeline, returns `{ markdown, data, templateName }`. |

#### Agent Factory (`src/lib/mastra/agents/resume-agent.ts`)

```ts
createResumeAgent(
  profileService,
  auditLogService,
  documentService,
  resumeGenerationService,
  resumeTemplateService
)
```

Creates the agent via the shared `createAgent()` factory, which:
-   Loads instructions from `prompts/resume-agent.md` via the prompt registry.
-   Uses the shared OpenRouter model and Memory instance.
-   Wires the four tools listed above (all wrapped with `withToolLogging`).

#### Chat API (`src/routes/api/chat/resume/+server.ts`)

-   **POST** — Streams agent responses via `handleChatStream` from `@mastra/ai-sdk`. Uses thread `resume-writer` / resource `resume-chat` for memory persistence.
-   **GET** — Returns existing chat messages for session restoration.

#### Chat UI (`src/lib/components/ResumeChat.svelte`)

Adapted from `ProfileChat.svelte` with resume-specific enhancements:
-   **Resume preview rendering** — When the `generateResume` tool returns successfully, the Markdown is displayed in a collapsible preview pane with a copy-to-clipboard button (instead of the generic tool output display).
-   **Empty state** — Prompts the user to paste a job description.
-   **Loading state** — "Generating resume…" placeholder during LLM inference.

### 3.5. API Endpoints

#### `POST /api/resumes/generate`

Accepts `{ jobDescription: string, templateId?: number }`. Delegates to `ResumeGenerationService.generate()`. Returns `{ markdown, data, templateName }`.

#### `GET /api/resumes/templates`

Returns `{ templates: ResumeTemplate[] }`.

#### `POST /api/resumes/templates`

Creates a new user template. Body: `{ name: string, content: string }`. Returns `{ template }` with status `201`.

#### `PUT /api/resumes/templates`

Updates a template. Body: `{ id: number, name?: string, content?: string, reset?: boolean }`. When `reset: true`, resets the default template to its on-disk version.

#### `DELETE /api/resumes/templates`

Deletes a user template. Body: `{ id: number }`. Cannot delete the default template.

### 3.6. Frontend — Resume Generation Page

**Route:** `/resume`

A tabbed page accessible from the sidebar navigation with three tabs:

#### AI Writer Tab (default)
-   Embeds the `ResumeChat` component for conversational resume generation.
-   The agent loads the user's profile, asks for a job description, analyses alignment, generates a structured resume via the LLM, and presents the rendered Markdown — all within the chat interface.
-   Users can iterate on the output by asking for changes, different emphasis, or alternative templates.

#### Quick Generate Tab
1.  **Profile status banner** — Shown only when the profile is too incomplete to generate (< 20%).
2.  **Job description input** — A large textarea for pasting the target job description, with a word counter.
3.  **Template picker** — Dropdown to select which Handlebars template to use (shown when more than one template exists).
4.  **Generate button** — Triggers the API call with a loading spinner.
5.  **Resume preview** — Displays the generated Markdown in a scrollable monospaced pane.
6.  **Copy to clipboard** — One-click copy of the generated Markdown.
7.  **Generation stats** — Shows skill count and experience entry count on success.

#### Templates Tab
1.  **Template list** — Each template shown with a preview of its Handlebars content, edit and delete buttons.
2.  **Edit inline** — Name and content editable in-place, with save/cancel actions.
3.  **Reset default** — Button to restore the default template to the on-disk version.
4.  **Add custom template** — Form to create a new template with name and Handlebars content.
5.  **Help text** — Reference of all available template variables.

### 3.7. Data Flow

```
                        ┌─────────────────────────────────────────────────┐
                        │              /resume  (Svelte)                  │
                        │  ┌──────────┐ ┌────────────┐ ┌──────────────┐  │
                        │  │ AI Writer│ │Quick Gen.  │ │  Templates   │  │
                        │  └────┬─────┘ └─────┬──────┘ └──────────────┘  │
                        └───────┼──────────────┼─────────────────────────┘
                                │              │
                   ┌────────────▼──┐    ┌──────▼──────────────┐
                   │ POST /api/    │    │ POST /api/resumes/  │
                   │ chat/resume   │    │ generate            │
                   └────────┬──────┘    └──────┬──────────────┘
                            │                  │
                   ┌────────▼──────┐           │
                   │ Resume Agent  │           │
                   │ (Mastra)      │           │
                   │               │           │
                   │ Tools:        │           │
                   │ • getProfile  │           │
                   │ • searchDocs  │           │
                   │ • listTempls  │           │
                   │ • generateRes─┼───────────┤
                   └───────────────┘           │
                                      ┌───────▼───────────────┐
                                      │ ResumeGenerationService│
                                      └───────┬───────────────┘
                                              │
                           ┌──────────────────┼──────────────────┐
                           │                  │                  │
                  ┌────────▼────────┐ ┌───────▼──────┐ ┌────────▼───────┐
                  │ ProfileService  │ │ OpenRouter   │ │ TemplateService│
                  │ (serialise)     │ │ (LLM call)   │ │ (Handlebars)   │
                  └─────────────────┘ └──────────────┘ └────────────────┘
```

## 4. File Structure

```
src/
├── lib/
│   ├── components/
│   │   └── ResumeChat.svelte                   # Chat UI for the resume agent
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── resume-agent.ts                 # Agent factory wiring tools + prompt
│   │   ├── prompts/
│   │   │   └── resume-agent.md                 # System instructions for the agent
│   │   ├── tools/
│   │   │   └── resume/
│   │   │       ├── index.ts                    # Barrel export
│   │   │       ├── generate-resume.ts          # generateResume tool
│   │   │       └── list-templates.ts           # listTemplates tool
│   │   └── index.ts                            # Registers resume-agent in Mastra
│   └── services/
│       ├── container.ts                        # Registers all services
│       ├── index.ts                            # Re-exports services & types
│       ├── resume/
│       │   ├── defaultPrompt.txt               # LLM prompt template with placeholders
│       │   ├── defaultTemplate.md              # Default Handlebars resume template
│       │   └── schema.ts                       # Zod schema for structured resume JSON
│       └── services/
│           ├── resume.ts                       # Existing: DB persistence & versioning
│           ├── resumeGeneration.ts             # LLM generation orchestrator
│           └── resumeTemplate.ts               # Template CRUD service
└── routes/
    ├── resume/
    │   ├── +page.server.ts                     # Loads profile status & templates list
    │   └── +page.svelte                        # AI Writer + Quick Generate + Templates tabs
    └── api/
        ├── chat/
        │   └── resume/
        │       └── +server.ts                  # POST: stream agent chat, GET: recall messages
        └── resumes/
            ├── +server.ts                      # Existing: basic resume endpoint
            ├── generate/
            │   └── +server.ts                  # POST: generate via LLM (non-agent)
            └── templates/
                └── +server.ts                  # GET/POST/PUT/DELETE for templates
```

## 5. Implementation Notes

-   **No external services required.** The LLM call goes through OpenRouter (same API key already configured for all agents). No Docker, no Ollama, no separate backend.
-   **Two interaction modes.** The AI Writer tab provides a conversational experience where the agent analyses the job description, explains its choices, and iterates on feedback. The Quick Generate tab offers a one-click pipeline for users who just want the output.
-   **Agent reuses existing tools.** `getProfile` and `searchDocuments` are imported from the profile tools module — no duplication. Only `generateResume` and `listTemplates` are resume-specific.
-   **Prompt engineering is critical.** The prompt in `defaultPrompt.txt` instructs the LLM to return only valid JSON, use STAR-format achievements, and never fabricate information. The agent prompt in `resume-agent.md` adds conversational scaffolding on top.
-   **`generateObject` with Zod** ensures the LLM response is always structurally valid. If the model returns malformed JSON, the AI SDK handles retries and validation automatically.
-   **Template variables** are documented in the UI's Templates tab help text. Users can create templates for different styles (minimal, academic, detailed) using standard Handlebars syntax (`{{name}}`, `{{#each experience}}`, etc.).
-   **Memory persistence.** The resume agent uses Mastra Memory with thread ID `resume-writer`, so conversations persist across page reloads and browser sessions.
-   **Future enhancements:**
    -   Automatically trigger resume generation when an application moves from Backlog to In Progress.
    -   Wire `ResumeGenerationService` output into `ResumeService.saveResume()` for automatic version tracking.
    -   Add DOCX/PDF export (e.g. via Pandoc or a lightweight conversion library).
    -   Support per-template prompt overrides so different templates can use different LLM instructions.
    -   Let the agent directly save the generated resume to a specific application record.