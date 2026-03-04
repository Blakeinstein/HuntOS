## Output Format Instructions

Produce a single JSON object that strictly conforms to the following schema. All fields are required unless marked optional.

```json
{
  "name": "string — candidate's full name",
  "professional_profile": "string — 2–4 sentence professional summary tailored to the target role",
  "skills": ["string", "..."],
  "experience": [
    {
      "job_title": "string",
      "company": "string",
      "location": "string (optional, may be empty)",
      "start_date": "string — e.g. 'Jan 2020'",
      "end_date": "string — e.g. 'Mar 2023' or 'Present'",
      "achievements": ["string — STAR-format bullet", "..."]
    }
  ],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "location": "string (optional, may be empty)",
      "graduation_date": "string — e.g. '2022' or 'May 2022'"
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string (optional, may be empty)",
      "date": "string (optional, may be empty)"
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "technologies": ["string", "..."]
    }
  ],
  "additional_info": {
    "key": "value — any extra relevant details not captured above"
  }
}
```

### Field guidance

- **professional_profile** — open with the candidate's core title and years of experience, then name 2–3 strengths directly relevant to the job description, and close with a forward-looking statement about the value they bring to this specific role.
- **skills** — flat list of individual skills; order by relevance to the job description; include technologies, methodologies, and soft skills only when the profile substantiates them.
- **experience[].achievements** — each bullet must follow STAR format and begin with a strong action verb; prefer quantified outcomes ("reduced build time by 40%") over vague statements; 3–6 bullets per role is typical.
- **experience** — order most recent first; include only roles relevant to the target position.
- **certifications** — omit entirely (empty array) if none are present in the profile.
- **projects** — include only if the profile contains project detail; omit or leave empty if not.
- **additional_info** — use for languages spoken, publications, open-source contributions, or any other notable details that do not fit the structured sections above; omit (empty object) if nothing applies.

### What to omit

- Do not add a `resumeName`, `historyId`, or any metadata field.
- Do not wrap the object in a `data` key or any other envelope.
- Do not include markdown formatting inside string values.