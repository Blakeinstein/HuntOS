## Output Format Instructions

Produce a single JSON object that strictly conforms to the following schema. All fields are required unless marked optional.

```json
{
  "personal": {
    "name": "string — candidate's full name",
    "phone": "string (optional, may be empty)",
    "email": "string",
    "linkedin": "string (optional) — profile URL without the https:// prefix, e.g. 'linkedin.com/in/jane'",
    "site": "string (optional) — personal site or portfolio URL without the https:// prefix, e.g. 'github.com/jane'"
  },
  "education": [
    {
      "name": "string — institution name",
      "degree": "string — degree and field, e.g. 'Bachelor of Science in Computer Science'",
      "location": "string (optional, may be empty) — city, state",
      "date": "string — date range, e.g. 'Aug. 2018 - May 2022'"
    }
  ],
  "experience": [
    {
      "role": "string — job title",
      "name": "string — company or organisation name",
      "location": "string (optional, may be empty) — city, state, or 'Remote'",
      "date": "string — date range, e.g. 'Jan. 2021 - Present'",
      "points": ["string — STAR-format bullet point", "..."]
    }
  ],
  "projects": [
    {
      "name": "string — project name",
      "skills": "string — comma-separated technologies used, e.g. 'Python, Flask, React'",
      "date": "string — date range, e.g. 'Jun. 2020 - Present'",
      "points": ["string — bullet describing what the project does or achieved", "..."]
    }
  ],
  "skills": [
    {
      "category": "string — skill group label, e.g. 'Languages', 'Frameworks', 'Tools'",
      "skills": "string — comma-separated skills in this category, e.g. 'Python, TypeScript, Go'"
    }
  ]
}
```

### Field guidance

- **personal** — use only contact details present in the candidate profile; leave optional fields as empty strings if not available.
- **education** — order most recent first; use abbreviated month format for dates (e.g. "Aug.", "May") to keep entries compact.
- **experience** — order most recent first; include only roles relevant to the target position.
- **experience[].points** — each bullet must follow STAR format and begin with a strong action verb; prefer quantified outcomes ("reduced build time by 40%") over vague statements; aim for 3–6 bullets per role.
- **projects** — include only if the profile contains project detail; omit (empty array) if not.
- **projects[].skills** — a single comma-separated string, not an array.
- **skills** — group skills into logical categories (e.g. Languages, Frameworks, Cloud, Tools, Methodologies); order categories by relevance to the job description; each category's `skills` value is a single comma-separated string.

### What to omit

- Do not add a `resumeName`, `historyId`, or any metadata field.
- Do not wrap the object in a `data` key or any other envelope.
- Do not include markdown formatting inside string values.
- Do not use arrays for fields that specify a comma-separated string (e.g. `projects[].skills`, `skills[].skills`).