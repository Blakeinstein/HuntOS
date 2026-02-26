## Site-Specific Instructions: Greenhouse

The detected application site is **Greenhouse**. Apply the following Greenhouse-specific guidance in addition to the base instructions above.

### Greenhouse Application Form Overview

Greenhouse is one of the most common Applicant Tracking Systems. Its application forms follow a highly consistent, predictable structure that makes them well-suited for automated filling.

#### Key Characteristics

- **Single-page form:** Unlike LinkedIn Easy Apply, Greenhouse application forms are rendered as a single long page with all fields visible at once. There are NO multi-step modals or wizard flows.
- **Standard URL patterns:** `boards.greenhouse.io/{company}/jobs/{job_id}`, or custom-domain career pages that embed the Greenhouse form via iframe.
- **Consistent DOM structure:** Greenhouse uses stable CSS class naming conventions (`field`, `required`, `application-form`, etc.) that rarely change between companies.
- **Public access:** Greenhouse application forms almost never require login or account creation. They are publicly accessible.
- **Resume/cover letter upload:** Always present, usually as the first section after personal info.
- **Custom questions:** Employer-defined questions appear in a dedicated section after the standard fields.
- **EEOC / Demographic section:** Optional compliance section at the bottom for US-based roles.

### Greenhouse Page State Handling

After navigating and taking a snapshot, check for these Greenhouse-specific conditions:

- **Embedded iframe:** If the Greenhouse form is embedded in a company's custom career page via an `<iframe>`, call `browser-frame-switch` with `selector: "iframe#grnhse_iframe"` (or `"iframe[src*='greenhouse.io']"`, `"iframe[title*='Greenhouse']"`). Then call `browser-snapshot` to see the form fields inside the frame.
- **Cookie consent / overlays:** Dismiss any cookie banners or notification modals. Use `browser-find-text { text: "Accept", action: "click" }` or `browser-find-role { role: "button", name: "Close", action: "click" }`. Re-take `browser-snapshot`.
- **"No longer accepting applications":** If the page shows "This job is no longer accepting applications", "Position filled", "Job closed", or a similar closed-position message, STOP. Return `success: false`, `end_reason: "closed"`, and `end_reason_description` explaining the specific reason (e.g., "The job posting is no longer accepting applications").
- **404 or error page:** If the page shows a 404, "Job not found", or server error, STOP. Return `success: false`, `end_reason: "error"`, and `end_reason_description` explaining the issue.
- **Login/authentication wall:** Greenhouse forms are almost never gated behind login. If **the snapshot shows** a login form or authentication wall, STOP and return `blocked: true` with `blocked_reason: "Authentication required"`.
- **CAPTCHA:** If a CAPTCHA challenge is detected, STOP immediately. Return `blocked: true` with `blocked_reason: "CAPTCHA detected"`.

### Identifying the Application Form

Greenhouse application pages have a standard layout. The form is typically:

1. Preceded by the job title and description at the top of the page.
2. Wrapped in a `<form>` element, often with `id="application_form"` or `id="application"`.
3. Structured in sections: Personal Information → Resume/Cover Letter → Custom Questions → EEOC (optional) → Submit.

Locate the form element. If the form is not immediately visible:
- Call `browser-scroll { direction: "down", pixels: 500 }` — the form may be below a lengthy job description.
- Use `browser-find-text { text: "Apply for this job", action: "text" }` to locate the section.
- If an "Apply" button is needed to reveal the form, use `browser-find-role { role: "button", name: "Apply", action: "click" }`.

Take a `browser-snapshot` once you have the form in view.

### Filling Personal Information Fields

The personal info section typically appears first. Greenhouse uses consistent field naming. Use `browser-find-label` for efficient filling, or fall back to `browser-fill` with CSS selectors/snapshot refs:

| Field | Selector Patterns | Fill Approach | Profile Key |
|-------|------------------|---------------|-------------|
| First Name | `#first_name`, `input[name="job_application[first_name]"]` | `browser-find-label { label: "First Name", action: "fill", value: "..." }` | `name` (first part) |
| Last Name | `#last_name`, `input[name="job_application[last_name]"]` | `browser-find-label { label: "Last Name", action: "fill", value: "..." }` | `name` (remaining parts) |
| Email | `#email`, `input[name="job_application[email]"]` | `browser-find-label { label: "Email", action: "fill", value: "..." }` | `email` |
| Phone | `#phone`, `input[name="job_application[phone]"]` | `browser-find-label { label: "Phone", action: "fill", value: "..." }` | `phone` |
| Location | `#job_application_location` | `browser-fill { selector: "#job_application_location", text: "..." }` | `location` |
| LinkedIn URL | `input[name*="linkedin"]`, label containing "LinkedIn" | `browser-find-label { label: "LinkedIn", action: "fill", value: "..." }` | `linkedin_url` |
| Website / Portfolio | `input[name*="website"]` | `browser-find-label { label: "Website", action: "fill", value: "..." }` | `portfolio_url` |
| Current Company | `input[name*="current_company"]` | `browser-find-label { label: "Current Company", action: "fill", value: "..." }` | Most recent experience |
| Current Title | `input[name*="current_title"]` | `browser-find-label { label: "Current Title", action: "fill", value: "..." }` | Most recent experience or `job_titles` |

**Location autocomplete handling:** Greenhouse's location field often uses Google Places autocomplete. After filling:
1. Call `browser-fill { selector: "#job_application_location", text: "City, State" }`.
2. Call `browser-wait-time { ms: 1000 }` for the autocomplete dropdown to appear.
3. Call `browser-snapshot` to look for a suggestion list (`.pac-container`, `ul[role="listbox"]`).
4. Call `browser-click` on the first matching suggestion (e.g. `browser-find-first { selector: ".pac-item", action: "click" }`).
5. If no autocomplete appears, the value may have been accepted as-is — verify with `browser-get-value { selector: "#job_application_location" }`.

### Resume and Cover Letter Upload

The resume/cover letter section appears after personal information.

#### Resume Upload

1. Locate the resume upload area using `browser-snapshot`. Look for:
   - `input[type="file"]#resume`, `input[name="job_application[resume]"]`
   - A `<div>` with text "Attach" or "Drop" containing a hidden file input
   - A link/button with text "Attach Resume/CV" that reveals the file input
   - A wrapper with class `.field` containing label text "Resume/CV"
2. If a clickable "Attach" or "Choose file" link exists, click it first: `browser-find-text { text: "Attach", action: "click" }` to surface the file input.
3. If Resume File Path is not empty, call `browser-fill { selector: "input[type='file']#resume", text: "<Resume File Path>" }`.
4. If Resume File Path is empty, record the field as `missing` if resume upload is required.
5. After uploading, call `browser-snapshot` to verify the filename appears in the upload confirmation area (`.uploaded-filename` or similar).

#### Cover Letter

1. Check if a cover letter section exists in the snapshot — look for:
   - `input[type="file"]#cover_letter`, `input[name="job_application[cover_letter]"]`
   - A `<textarea>` with label "Cover Letter"
   - A wrapper with text "Cover Letter"
2. If it's a **file upload** and no cover letter file is available, skip it (almost always optional).
3. If it's a **text area**, use `browser-fill` on the textarea element. Generate a brief cover letter (3-4 paragraphs) using the Job Description and Resume Data:
   - Paragraph 1: Express interest in the specific role and company (use the company name from the page).
   - Paragraph 2: Highlight 2-3 relevant qualifications or experiences from the Resume Data that match the Job Description.
   - Paragraph 3: Mention alignment with the company's mission or values if evident from the Job Description.
   - Paragraph 4: Close with enthusiasm, availability, and a call to action.
   - Keep it under 300 words total.

### Filling Custom Questions

Greenhouse allows employers to add custom questions. These appear in a section after the resume upload area, typically wrapped in `div.field` or `div.custom-question` elements.

Scroll down to ensure all custom questions are visible, then handle each by type:

#### Text Input Questions
- Single-line text fields (`<input type="text">`).
- Use `browser-fill` with the snapshot ref and the appropriate answer from Job Description / User Profile.
- Common examples: "How did you hear about this role?", "What is your GitHub username?", "Please provide your portfolio URL."

#### Textarea Questions
- Multi-line text fields (`<textarea>`).
- These are open-ended questions — compose thoughtful answers (2-4 sentences) using Job Description and Resume Data.
- Use `browser-fill` with the textarea ref to set the content.
- Common examples: "Why are you interested in this role?", "Describe your experience with [technology]."

#### Select / Dropdown Questions
- `<select>` elements with predefined options.
- First read all options with `browser-get-text` or `browser-get-html` on the `<select>` element.
- Choose the most appropriate option based on the User Profile.
- Common examples: "Years of experience", "Highest education level", "Preferred work arrangement".
- Use `browser-select { selector: "@eN", value: "Option Text" }` with the matching option value.

#### Checkbox Questions
- `<input type="checkbox">` elements.
- Typically "I agree to..." terms checkboxes or multi-select preferences.
- For terms/conditions: `browser-check { selector: "@eN" }`.
- For preference checkboxes: Use `browser-check` on options that match the User Profile.

#### Radio Button Questions
- `<input type="radio">` groups.
- Read all option labels from the snapshot to understand the choices.
- Use `browser-click { selector: "@eN" }` on the most appropriate radio option.
- Common examples: "Are you authorized to work in [country]?", "Do you require sponsorship?"

#### Yes/No Questions
- May appear as radio buttons, a select dropdown, or checkboxes.
- "Are you legally authorized to work in [country]?" → Check user profile location. If uncertain, mark as `missing`.
- "Will you now or in the future require visa sponsorship?" → Check profile if available. If uncertain, mark as `missing`.
- "Are you 18 years of age or older?" → Answer "Yes" (reasonable assumption).
- "Have you previously worked at [company]?" → Check experience data. Default to "No" if not found.

#### Important Rules for Custom Questions
- **NEVER fabricate answers.** If the profile doesn't contain the information, mark the field as `missing`.
- **NEVER guess at quantitative answers** (years of experience with a specific technology) unless the Resume Data explicitly contains that information.
- **Keep free-text answers relevant** to the Job Description and concise.

### Handling EEOC / Demographic Section

US-based Greenhouse postings often include an Equal Employment Opportunity Commission (EEOC) section at the bottom. This may include:

- **Gender:** Select "Decline to self-identify" or "I don't wish to answer"
- **Race/Ethnicity:** Select "Decline to self-identify" or "I don't wish to answer"
- **Veteran Status:** Select "I don't wish to answer" or "I am not a veteran"
- **Disability Status:** Select "I don't wish to answer" or "I do not wish to answer"

For each, first read options then select the decline option:
- `browser-get-text { selector: "select#job_application_gender" }` → then `browser-select { selector: "select#job_application_gender", value: "Decline to self-identify" }`
- `browser-get-text { selector: "select#job_application_race" }` → then `browser-select { selector: "select#job_application_race", value: "Decline to self-identify" }`
- `browser-get-text { selector: "select#job_application_veteran_status" }` → then `browser-select` with the decline option
- `browser-get-text { selector: "select#job_application_disability_status" }` → then `browser-select` with the decline option

**Rules:**
- These fields are almost always optional. If a "Decline" or "Prefer not to answer" option exists, select it.
- **NEVER fabricate demographic data.** Do not select any specific gender, race, veteran status, or disability status.
- If the section appears but has no "Decline" option, leave the fields at their default value and move on.

### Pre-Submit Checks

Before submitting, scroll to the very bottom of the form:

1. Call `browser-scroll { direction: "down", pixels: 2000 }` to reach the bottom.
2. Call `browser-snapshot { interactive: true }` to check for any missed fields.
3. Verify all required fields (marked with `*` or `.required`) have been filled using `browser-get-value` on any suspect fields.
4. Confirm the submit button is visible with `browser-is-visible { selector: "input[type='submit']#submit_app" }`.

### Submitting the Application

1. Locate the submit button. Try these approaches in order:
   - `browser-click { selector: "input[type='submit']#submit_app" }`
   - `browser-find-role { role: "button", name: "Submit Application", action: "click" }`
   - `browser-find-text { text: "Submit Application", action: "click" }`
   - From snapshot: `browser-click { selector: "@eN" }` where `@eN` is the submit button ref
2. Before clicking, check for inline validation errors: `browser-get-count { selector: ".field_with_errors" }`. If count > 0, inspect and fix the affected fields.
3. If validation errors exist but are unfixable, record them and do NOT submit.
4. Click the submit button.
5. Wait for confirmation:
   - `browser-wait-text { text: "Thank you" }` or `browser-wait-text { text: "Application submitted" }`
   - Or `browser-wait-url { urlPattern: "**/confirmation" }`
   - If neither appears within a reasonable time, call `browser-snapshot` to check the page state.
6. Take a `browser-screenshot { path: "greenhouse-application-result.png" }` of the confirmation state.

### Handling Submission Failures

If submission fails:

1. Check for inline validation errors — use `browser-snapshot` and look for `.field_with_errors` classes. Use `browser-get-text { selector: ".field_with_errors" }` to read error messages.
2. Record all error messages in the `errors` array.
3. Try to fix errors by re-filling the highlighted fields with `browser-fill`.
4. If fixable, re-submit. If not, return `success: false` with the errors.
5. Common failure reasons:
   - Missing required fields (look for `.required` / `*` indicators)
   - Invalid email format
   - Resume file too large or wrong format
   - Location autocomplete not properly selected (verify with `browser-get-value`)

### Greenhouse-Specific DOM Reference

These selectors are known patterns for Greenhouse application forms. They are highly stable across companies but always verify with `snapshot` before using:

#### Page Structure
- Application form: `form#application_form`, `form#application`, `div.application-form`
- Job title: `h1.app-title`, `h1.heading`, `.job-title`
- Job description: `div#content`, `div.job-description`, `div#job_description`
- Application section: `div#application`, `div.application-page`

#### Personal Information Fields
- First name: `input#first_name`, `input[name="job_application[first_name]"]`
- Last name: `input#last_name`, `input[name="job_application[last_name]"]`
- Email: `input#email`, `input[name="job_application[email]"]`
- Phone: `input#phone`, `input[name="job_application[phone]"]`
- Location: `input#job_application_location`, `input[name="job_application[location]"]`

#### Resume / Cover Letter
- Resume file input: `input[type="file"]#resume`, `input[name="job_application[resume]"]`
- Resume attach link: `a.attach-resume`, a link with text "Attach" inside the resume field wrapper
- Cover letter file input: `input[type="file"]#cover_letter`, `input[name="job_application[cover_letter]"]`
- Cover letter textarea: `textarea#cover_letter_text`, `textarea[name="job_application[cover_letter_text]"]`
- Upload confirmation: `.uploaded-filename`, text showing the uploaded filename

#### Custom Questions
- Question wrapper: `div.field`, `div.custom-question`
- Text input: `input[type="text"]` inside a `.field` div
- Textarea: `textarea` inside a `.field` div
- Select: `select` inside a `.field` div
- Checkbox: `input[type="checkbox"]` inside a `.field` div
- Radio: `input[type="radio"]` inside a `.field` div
- Required indicator: `.required`, `*` in label text, `[aria-required="true"]`
- Field label: `label` element associated with the input
- Error state: `.field_with_errors`, `.error-message`

#### EEOC Section
- Gender: `select#job_application_gender`, `select[name="job_application[gender]"]`
- Race: `select#job_application_race`, `select[name="job_application[race]"]`
- Veteran status: `select#job_application_veteran_status`, `select[name="job_application[veteran_status]"]`
- Disability: `select#job_application_disability_status`, `select[name="job_application[disability_status]"]`
- EEOC section wrapper: `div#eeoc_fields`, `div.eeoc-section`, `fieldset` with legend containing "Equal Opportunity" or "Voluntary Self-Identification"

#### Submit
- Submit button: `input[type="submit"]#submit_app`, `input[value="Submit Application"]`
- Alternative submit: `button[type="submit"]`, button with text "Submit Application"

#### Confirmation Page
- Confirmation text: Text containing "Thank you", "Application submitted", "has been received"
- Confirmation URL: URL path contains `/confirmation` or `/thank-you`

#### Iframe Embedding
- Greenhouse iframe: `iframe#grnhse_iframe`, `iframe[src*="greenhouse.io"]`, `iframe[src*="grnh.se"]`
- After switching to iframe, the form selectors above apply normally inside the frame context

### Greenhouse-Specific Rules

- **Check for the Greenhouse iframe.** Many companies embed the Greenhouse form via an iframe. If `browser-snapshot` shows few interactive elements, look for `iframe#grnhse_iframe` or similar. Call `browser-frame-switch { selector: "iframe#grnhse_iframe" }` before interacting, otherwise all selectors will fail. Call `browser-frame-main` when done.
- **Scroll the full page before submitting.** Call `browser-scroll { direction: "down", pixels: 2000 }` and re-snapshot to ensure you haven't missed any fields below the fold.
- **Do NOT submit if required fields are missing.** Return `success: false` with `submitted: false` and a clear explanation. It is better to fail cleanly than to submit an incomplete application.
- **`form_pages_visited` should be 1** for Greenhouse. If you encounter a multi-page Greenhouse form (very rare), increment accordingly.
- **Verify after filling critical fields.** Call `browser-get-value` on name, email, and phone fields after filling to confirm values were set correctly.
- **Handle the location autocomplete carefully.** After `browser-fill`, call `browser-wait-time { ms: 1000 }`, then `browser-snapshot` to find the suggestion dropdown. Call `browser-click` on the best match. If autocomplete fails after 2 attempts, leave the typed value and note it in `notes`.
- **Greenhouse forms are public.** If login is required as observed in the actual page snapshot, something is unusual. Stop and report `blocked`.