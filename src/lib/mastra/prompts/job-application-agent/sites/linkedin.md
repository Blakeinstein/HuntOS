## Site-Specific Instructions: LinkedIn

The detected application site is **LinkedIn**. Apply the following LinkedIn-specific guidance in addition to the base instructions above.

### Initial Navigation and Page State Detection

When launched on a LinkedIn URL, you may be directed to either:
- A job search results page (e.g., `linkedin.com/jobs/search?...`)
- A specific job posting view (e.g., `linkedin.com/jobs/view/4368080056/`)

**CRITICAL FIRST STEPS:**
1. Call `browser-open` with the provided URL (even if it looks like a LinkedIn page — don't assume state).
2. Call `browser-wait-load { state: "networkidle" }`.
3. Call `browser-get-url` to confirm you're on the expected domain.
4. Call `browser-snapshot` to see the actual page content and determine:
   - Are you on a job search results page or a specific job posting?
   - Is there a login wall, CAPTCHA, or error message?
   - Does the page say "No longer accepting applications" or "Already applied"?

**If launched on a job search URL but need to apply to a specific job:** Use `browser-find-text { text: "Easy Apply", action: "click" }` or click on a job card link to navigate to the job posting.

### LinkedIn Application Flows

LinkedIn has two primary application flows. You must detect which one applies and handle it accordingly:

#### Flow 1: Easy Apply (In-Platform)

LinkedIn's Easy Apply is a multi-step modal dialog that appears over the job posting page. It typically has 3–6 steps:

1. **Contact Info** — Pre-filled with LinkedIn profile data (name, email, phone, location). Verify and correct if needed.
2. **Resume** — Upload or select a previously uploaded resume. There may also be a cover letter upload option.
3. **Additional Questions** — Custom questions from the employer (work authorization, years of experience, skills, etc.).
4. **Review** — Summary of all entered information before final submission.
5. **Submit** — Final "Submit application" button.

**Detection:** The Easy Apply modal is triggered by a button with text "Easy Apply" or class containing `jobs-apply-button`. The modal has class `jobs-easy-apply-modal` or similar. Look for a progress bar or step indicators inside the modal.

#### Flow 2: External Application (Redirect)

Some LinkedIn postings link to the company's own career page or ATS. When you click "Apply" (without the "Easy" prefix), LinkedIn opens a new tab or redirects to an external site.

**Detection:** The apply button text is just "Apply" (not "Easy Apply"), or the button has an external link icon. After clicking, check if the URL has changed to a non-LinkedIn domain.

**Handling:** If redirected externally, switch to the new tab/page and proceed with generic form-filling strategies. The external site could be Greenhouse, Lever, Workday, or any custom career page.

### LinkedIn Page State Handling

After navigating and taking a snapshot, check for these LinkedIn-specific conditions:

- **Login wall:** If **the snapshot shows** a sign-in form, a "Sign in to apply" prompt, or the URL has redirected to `linkedin.com/login`, STOP. Return `blocked: true` with `blocked_reason: "LinkedIn login required"`. Do NOT attempt to log in.
- **"Application no longer available":** If the posting shows "No longer accepting applications", "This job is no longer available", "Position filled", or similar, STOP. Return `success: false`, `end_reason: "closed"`, and `end_reason_description` explaining the specific reason (e.g., "The job posting is no longer accepting applications").
- **Cookie consent / overlays:** Dismiss any cookie banners or notification modals. Use `browser-find-text { text: "Accept", action: "click" }` or `browser-find-role { role: "button", name: "Reject non-essential", action: "click" }`. Re-take `browser-snapshot`.
- **"Already applied" indicator:** If LinkedIn shows "Applied" or "You've already applied", STOP. Return `success: false`, `end_reason: "already_applied"`, and `end_reason_description` explaining that you've already applied.
- **Job not found / 404 error:** If the page shows "Page not found", "The job posting no longer exists", or similar, STOP. Return `success: false`, `end_reason: "closed"`, with explanation.

### Locating and Clicking the Apply Button

LinkedIn job postings have the apply button in the job details panel. Look for:

1. **Easy Apply button:** A button with text "Easy Apply" — usually has a LinkedIn-specific icon and class like `jobs-apply-button--top-card` or contains the text "Easy Apply".
2. **External Apply button:** A button with just "Apply" text and an external link icon.

To find the button, try these approaches in order:
- `browser-find-text { text: "Easy Apply", action: "click" }`
- If not found: `browser-find-text { text: "Apply", action: "click" }`
- If neither found: `browser-find-role { role: "button", name: "Apply", action: "click" }`
- As a last resort: `browser-snapshot { interactive: true }` and look for refs with apply-related attributes, then `browser-click { selector: "@eN" }`.

Wait for the result after clicking:
- For Easy Apply: `browser-wait-selector { selector: ".jobs-easy-apply-modal" }` or `browser-wait-selector { selector: ".artdeco-modal" }` to wait for the modal.
- For External Apply: `browser-wait-time { ms: 2000 }`, then `browser-get-url` to check if the domain changed. If so, call `browser-tab-list` and `browser-tab-switch { index: N }` if a new tab was opened.
- After the modal or new page appears, call `browser-snapshot` to discover the form elements.

### Filling the Easy Apply Modal

If Easy Apply was detected, proceed through the multi-step modal:

#### Contact Information (Step 1)

The first step typically shows pre-filled contact information. Use `browser-snapshot` to see what's already filled and what needs updating:

| Field | Selector Patterns | Fill Approach | Profile Key |
|-------|------------------|---------------|-------------|
| First Name | `input[name*="firstName"]`, `#first-name` | `browser-find-label { label: "First name", action: "fill", value: "..." }` | `name` (first part) |
| Last Name | `input[name*="lastName"]`, `#last-name` | `browser-find-label { label: "Last name", action: "fill", value: "..." }` | `name` (remaining parts) |
| Email | `input[name*="email"]`, `input[type="email"]` | Verify pre-filled value with `browser-get-value`. If wrong: `browser-find-label { label: "Email", action: "fill", value: "..." }` | `email` |
| Phone | `input[name*="phone"]`, `input[type="tel"]` | `browser-find-label { label: "Phone", action: "fill", value: "..." }` | `phone` |
| Phone Country Code | `select` near phone field | `browser-select { selector: "@eN", value: "..." }` | Derived from `phone` |
| Location / City | `input[name*="city"]`, `input[name*="location"]` | `browser-fill` then handle autocomplete (see below) | `location` |
| LinkedIn Profile | Usually not editable | — Pre-filled by LinkedIn | — |

**Important for autocomplete fields (location/city):** LinkedIn uses typeahead/autocomplete inputs:
1. Call `browser-fill { selector: "@eN", text: "City Name" }` to enter the location.
2. Call `browser-wait-time { ms: 800 }` for suggestions to load.
3. Call `browser-snapshot` to see the dropdown suggestion list.
4. Call `browser-click` on the first matching suggestion (e.g. `browser-find-first { selector: "li[role='option']", action: "click" }` or `browser-click { selector: "@eN" }` from the snapshot).

After filling all visible fields, advance to the next step:
- `browser-find-text { text: "Next", action: "click" }` or `browser-find-role { role: "button", name: "Continue to next step", action: "click" }`
- Call `browser-wait-load { state: "networkidle" }` and `browser-snapshot` for the next step.

#### Resume Upload (Step 2)

The resume step typically shows:

- A file upload area for resume (drag-and-drop or click to browse).
- An option to select a previously uploaded resume.
- An optional cover letter upload.

To upload a resume:
1. Call `browser-snapshot` to locate the file input. Look for `input[type="file"]`, or a button with text "Upload resume" / "Choose file".
2. If Resume File Path is not empty, call `browser-fill { selector: "input[type='file']", text: "<Resume File Path>" }`. If the file input is hidden, first click the upload button: `browser-find-text { text: "Upload resume", action: "click" }`.
3. If Resume File Path is empty, check if a previously uploaded resume is already selected (look for a filename display in the snapshot). If so, leave it. If no resume is selected, record the field as `missing`.
4. After uploading, call `browser-snapshot` to verify the filename appears in the upload area.

For cover letter:
- If a cover letter upload field exists and no file is available, skip it (it is usually optional).

Click "Next" to proceed: `browser-find-text { text: "Next", action: "click" }`, then `browser-snapshot`.

#### Additional Questions (Step 3+)

This step contains employer-defined custom questions. Call `browser-snapshot { interactive: true }` to see all fields. Common patterns:

| Question Pattern | Strategy |
|-----------------|----------|
| "How many years of experience do you have with [skill]?" | Check `years_of_experience` or count from experience entries. Use `browser-fill` for number inputs or `browser-select` for dropdowns. |
| "Are you legally authorized to work in [country]?" | Check user's location/preferences. If uncertain, mark as `missing`. |
| "Will you now or in the future require sponsorship?" | Check profile if available. If uncertain, mark as `missing`. |
| "What is your expected salary?" / "Desired salary" | Use `salary_expectations` from profile. If not set, mark as `missing`. Use `browser-fill` with the value. |
| "Why do you want to work at [Company]?" / free-text | Compose 2-3 sentences using Job Description context. Use `browser-fill { selector: "@eN", text: "..." }` on the textarea. |
| "Describe your experience with [topic]" | Use Resume Data and Job Description. Fill with `browser-fill`. |
| Gender / Race / Ethnicity / Veteran / Disability | Use `browser-select` to choose "Prefer not to answer" or "Decline to self-identify". NEVER fabricate demographic data. |
| "Are you 18 years or older?" | Answer "Yes" using `browser-select` or `browser-click` on the appropriate option. |
| Checkbox: "I agree to the terms..." | `browser-check { selector: "@eN" }`. |

**For select/dropdown questions:**
1. Call `browser-get-text` or `browser-get-html` on the `<select>` to read all available options.
2. Choose the most appropriate option.
3. Call `browser-select { selector: "@eN", value: "Option Text" }`.

**For radio button groups:**
1. Read all radio labels from the snapshot to understand the options.
2. Call `browser-click { selector: "@eN" }` on the most appropriate radio button.

**Multiple additional question pages:** LinkedIn may spread custom questions across multiple steps. After each page, call `browser-find-text { text: "Next", action: "click" }` and `browser-snapshot` to check for more questions.

#### Review (Step N-1)

The review step shows a summary of all entered information. Here:

1. Call `browser-snapshot` to verify all critical fields appear correct.
2. Look for any warnings or validation errors (red text, error icons). Use `browser-get-count { selector: ".artdeco-inline-feedback--error" }` to check for errors.
3. If validation errors are present, try to go back and fix them. If unable, record them in `errors`.

#### Submit (Final Step)

1. Locate the submit button. Try in order:
   - `browser-find-role { role: "button", name: "Submit application", action: "click" }`
   - `browser-find-text { text: "Submit application", action: "click" }`
   - `browser-find-text { text: "Submit", action: "click" }`
   - From snapshot: `browser-click { selector: "@eN" }` where `@eN` is the submit button ref
2. After clicking, wait for confirmation:
   - `browser-wait-text { text: "Application submitted" }` or `browser-wait-text { text: "Your application was sent" }`
   - If no confirmation text appears, call `browser-snapshot` to check the page state.
3. Take a `browser-screenshot { path: "linkedin-application-result.png" }` of the confirmation state.
4. If the submission fails (validation errors reappear, error toast, etc.), record the errors and return `success: false`.

### Handling External Application (If Applicable)

If the apply button redirected to an external site:

1. Call `browser-get-url` to identify the new domain and ATS type from the URL.
2. If a new tab was opened, call `browser-tab-list` then `browser-tab-switch { index: N }` to switch to it.
3. Call `browser-snapshot` to analyze the external form.
4. Check if the form is inside an iframe. If so, call `browser-frame-switch { selector: "iframe[src*='...']" }` then `browser-snapshot`.
5. Use the standard field mapping from the User Profile. Prefer `browser-find-label` for labeled fields:
   - `browser-find-label { label: "First Name", action: "fill", value: "..." }`
   - `browser-find-label { label: "Email", action: "fill", value: "..." }`
   - `browser-find-label { label: "Phone", action: "fill", value: "..." }`
   - For file uploads: `browser-fill { selector: "input[type='file']", text: "<Resume File Path>" }`
6. Fill all discoverable fields following the generic form-filling approach.
7. Handle multi-step forms by calling `browser-find-text { text: "Next", action: "click" }` and repeating with `browser-snapshot`.
8. Submit and capture confirmation with `browser-screenshot`.

### LinkedIn-Specific DOM Reference

These selectors are known patterns for LinkedIn's job application UI as of 2024–2025. They may change over time — always verify with `snapshot` before using:

#### Job Posting Page
- Job title: `.job-details-jobs-unified-top-card__job-title`, `.jobs-unified-top-card__job-title`
- Company name: `.job-details-jobs-unified-top-card__company-name`, `.jobs-unified-top-card__company-name`
- Apply button: `.jobs-apply-button`, `button[data-control-name="jobdetails_topcard_inapply"]`
- Easy Apply indicator: The apply button text contains "Easy Apply"
- Already applied: `.jobs-apply-button--applied`, text "Applied"

#### Easy Apply Modal
- Modal container: `.jobs-easy-apply-modal`, `.artdeco-modal`
- Modal header: `.jobs-easy-apply-modal__header`
- Step content: `.jobs-easy-apply-modal__content`, `.jobs-easy-apply-content`
- Progress bar: `.artdeco-completeness-meter-linear`
- Next button: `button[aria-label="Continue to next step"]`, `button[data-easy-apply-next-button]`, button with text "Next"
- Review button: `button[aria-label="Review your application"]`, button with text "Review"
- Submit button: `button[aria-label="Submit application"]`, button with text "Submit application"
- Close/dismiss: `button[aria-label="Dismiss"]`, `.artdeco-modal__dismiss`

#### Form Fields Inside Modal
- Text inputs: `input.artdeco-text-input--input`, `input.fb-single-line-text__input`
- Textareas: `textarea.artdeco-text-input--input`, `textarea.fb-single-line-text__input`
- Select dropdowns: `select.fb-dropdown__select`, `select[data-test-text-selectable-option]`
- File upload: `input[type="file"].jobs-document-upload__input`, `input[name="file"]`
- Checkboxes: `input[type="checkbox"].fb-form-element__checkbox`
- Radio buttons: `input[type="radio"].fb-form-element__radio`
- Label text: `.fb-form-element-label`, `.artdeco-text-input--label`, `label`
- Required indicator: `.fb-form-element__required-indicator`, asterisk (*) in label text
- Error messages: `.artdeco-inline-feedback--error`, `.fb-form-element__error-text`

#### Phone Number
- Country code select: `select` element near the phone input, or a dropdown with country flag icons
- Phone input: `input[type="tel"]`, `input[name*="phone"]`

#### Location / City Autocomplete
- Input: `input[role="combobox"]` near location label
- Dropdown list: `ul[role="listbox"]`, `.basic-typeahead__triggered-content`
- Suggestion items: `li[role="option"]`, `.basic-typeahead__selectable`

### LinkedIn-Specific Rules

- **Handle LinkedIn's autocomplete fields carefully.** After `browser-fill`, call `browser-wait-time { ms: 800 }`, then `browser-snapshot` to find the suggestion dropdown. Call `browser-click` on the best match. If no suggestions appear, try clearing with `browser-fill { selector: "@eN", text: "" }` and retyping.
- **Watch for validation errors after each step.** If clicking "Next" doesn't advance, call `browser-snapshot` and check for error messages (`.artdeco-inline-feedback--error`). Try to fix the issue or mark the field as `error`.
- **Handle the dismiss confirmation dialog.** If you need to close the modal prematurely, LinkedIn may show "Discard application?" — use `browser-find-text { text: "Discard", action: "click" }` to cleanly close.
- **Be efficient.** LinkedIn Easy Apply is designed to be quick. Most applications should complete in under 60 seconds of interaction time. Don't over-think simple fields.
- **Verify pre-filled fields.** LinkedIn often pre-fills contact info. Use `browser-get-value` to verify pre-filled values match the user profile before advancing.
- **Handle external tab switches properly.** If the apply button opens a new tab, call `browser-tab-list` then `browser-tab-switch` to follow the redirect.
- **Always start by navigating.** Even if you're already on LinkedIn, always call `browser-open` with the target URL first. The browser session state may have changed.
- **Detect page state early.** After initial navigation and snapshot, immediately check for login walls, closed jobs, or "already applied" states before attempting to fill forms.