# Auto Job Application — README

This repository contains the Auto Job Application SvelteKit app and the Mastra agent configuration used by the project.

This README explains how to set up the project, manage model providers, and how to switch models per-agent using environment variables. The project has been adapted to support multiple model providers using a provider factory so you can mix-and-match providers via provider-prefixed model strings.

---

## Prerequisites

- bun (recommended) — this project expects `bun` as the package manager/runner.
- Node-compatible OS (Linux / macOS)
- Chrome (for browser automation tooling / CDP) if you want browser-driven agents

---

## Quickstart

1. Clone the repository.

2. Install dependencies:
```bash
bun install
```

3. Copy the example environment file and edit it:
```bash
cp .env.example .env
# then edit `.env` and fill the API keys, model strings, and base URLs you need
```

4. Start development server:
```bash
bun run dev
```

5. (Optional) If you intend to use the browser automation tools (agent-browser), launch Chrome with remote debugging:
```bash
# example helper script present in package.json (use bun to run)
bun run browser
# Then connect the agent-browser / CDP client:
bun run cdp
```

6. Build for production:
```bash
bun run build
# preview:
bun run preview
```

---

## Environment / Model configuration

All model and provider configuration is placed in environment variables. The repository includes `.env.example`. Copy it to `.env` and provide appropriate keys/URLs.

Key files:
- `./.env.example` — example env file with comments
- `./.env` — your actual runtime env (DO NOT commit)

Important env variables (high level):
- `DEFAULT_MODEL` — fallback provider-qualified model string used when no agent override is provided
- Per-agent model overrides:
  - `PROFILE_AGENT_MODEL`
  - `RESUME_AGENT_MODEL`
  - `JOB_APPLICATION_AGENT_MODEL`
  - `JOB_BOARD_AGENT_MODEL`
  - (Optional) `JOB_BOARD_LINKEDIN_MODEL`, `JOB_BOARD_GREENHOUSE_MODEL`, `JOB_BOARD_GENERIC_MODEL`

Provider API keys / base URLs (examples):
- OpenRouter:
  - `OPENROUTER_API_KEY` (required if using `openrouter/...`)
  - `OPENROUTER_BASE_URL` (optional)
- OpenAI:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL` (optional)
- LMStudio:
  - `LMSTUDIO_API_KEY` (mostly optional; LMStudio often runs locally)
  - `LMSTUDIO_BASE_URL` (optional — e.g. `http://127.0.0.1:1234/v1`)
- GitHub Models:
  - `GITHUB_TOKEN`
  - `GITHUB_MODELS_BASE_URL` (optional)
- Ollama:
  - `OLLAMA_BASE_URL` (optional; default local `http://localhost:11434/api`)
- Z.AI / Zhipu AI:
  - `ZAI_API_KEY` (optional)
  - `ZAI_BASE_URL` (optional; default `https://open.bigmodel.cn/api/paas/v4/`)

Notes on `Z.AI` fallback:
- If `ZAI_API_KEY` is set, `z-ai/...` model strings are called directly at the Z.AI API (or `ZAI_BASE_URL`).
- If `ZAI_API_KEY` is NOT set, `z-ai/...` model strings are routed through OpenRouter (so `OPENROUTER_API_KEY` becomes necessary for those models).

---

## Model string format

Model strings use the format:
```
<provider>/<model-path>
```

Examples:
- `openrouter/qwen/qwen3-30b-a3b-instruct-2507`
- `openai/gpt-4o`
- `lmstudio/qwen/qwen3-30b-a3b-2507`
- `github-models/ai21-labs/ai21-jamba-1.5-large`
- `ollama/phi3`
- `z-ai/glm-4.7-flash`

A provider-prefixed string tells the internal factory which provider to use. The provider factory is implemented at:
- `src/lib/mastra/providers/registry.ts`

It returns a Mastra-compatible model configuration for the Mastra agents.

---

## Where to change agent model choices

Each agent reads its model from an environment variable (so you can swap providers without code edits). Example agent files:

- `src/lib/mastra/agents/profile-agent.ts` — reads `PROFILE_AGENT_MODEL`
- `src/lib/mastra/agents/resume-agent.ts` — reads `RESUME_AGENT_MODEL`
- `src/lib/mastra/agents/job-application-agent/agent.ts` — reads `JOB_APPLICATION_AGENT_MODEL`
- `src/lib/mastra/agents/job-board-agent/*` — orchestrator and specific board agents read from `JOB_BOARD_AGENT_MODEL` and optional per-board overrides

You can set them directly in your `.env`:
```env
PROFILE_AGENT_MODEL=openrouter/qwen/qwen3-30b-a3b-instruct-2507
RESUME_AGENT_MODEL=lmstudio/qwen/qwen3-30b-a3b-2507
JOB_APPLICATION_AGENT_MODEL=openai/gpt-4o
```

---

## Provider implementations included

This project supports and contains wiring for the following providers (the provider factory will resolve and instantiate them depending on your model strings and env vars):

- OpenRouter (`@openrouter/ai-sdk-provider`)
- OpenAI (`@ai-sdk/openai`) — used for `openai/` models and as an OpenAI-compatible client for some other flows
- LMStudio (via OpenAI-compatible client when `LMSTUDIO_BASE_URL` is provided, otherwise uses the model-router string)
- GitHub Models (via model-router string or OpenAI-compatible client when a custom `GITHUB_MODELS_BASE_URL` is set)
- Ollama (`ollama-ai-provider-v2`) — for local Ollama servers
- Z.AI / Zhipu AI — supports direct `ZAI_API_KEY` usage or fallback to OpenRouter

If you need to add or change providers, see:
- `src/lib/mastra/providers/registry.ts`

---

## Local-only providers (notes)

- LMStudio and Ollama are commonly run locally. If you run them locally, set the respective base URL in `.env` to point at your local server (for example, `LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1` or `OLLAMA_BASE_URL=http://localhost:11434/api`).
- For Ollama, the project uses the `ollama-ai-provider-v2` community provider. If you prefer a different Ollama provider, you can replace the provider initialization in `registry.ts`.

---

## Helpful scripts (package.json)

Use `bun run <script>` to run the scripts defined in `package.json`:

- `bun run dev` — starts Vite development server
- `bun run build` — builds production
- `bun run preview` — previews the production build
- `bun run browser` — runs Chrome with remote debugging (helper for CDP)
- `bun run cdp` — connect CDP client (script present)
- `bun run studio` — start Mastra studio (if configured)

---

## Code locations

- Mastra configuration and agent wiring:
  - `src/lib/mastra/index.ts`
  - `src/lib/mastra/agents/` (agents)
  - `src/lib/mastra/providers/registry.ts` (provider factory)
- Prompts:
  - `src/lib/mastra/prompts/` (Markdown prompts used by agents)
- Tools:
  - `src/lib/mastra/tools/`

---

## Troubleshooting

- If you see errors about missing API keys, make sure you copied `.env.example` to `.env` and provided the right keys (for OpenRouter, OpenAI, GitHub, etc.).
- If a provider can't be reached, try configuring the base URL in `.env` (e.g. `OPENROUTER_BASE_URL`, `LMSTUDIO_BASE_URL`, `GITHUB_MODELS_BASE_URL`, `OLLAMA_BASE_URL`).
- The `z-ai` provider will call OpenRouter if `ZAI_API_KEY` is not present. Make sure `OPENROUTER_API_KEY` is set if you rely on that fallback.

---

If you want help picking good models for each agent role (fast vs. instruction-following vs. tool-reliability), tell me which providers you have access to and I can recommend model strings and configuration tips.