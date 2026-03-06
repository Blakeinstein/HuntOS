## Site-Specific Instructions: LinkedIn

The detected application site is **LinkedIn**. Apply the following LinkedIn-specific guidance in addition to the base instructions above.

### Initial Navigation and Page State Detection

When launched on a LinkedIn URL, you may be directed to either:
- A job search results page (e.g., `linkedin.com/jobs/search?...`)
- A specific job posting view (e.g., `linkedin.com/jobs/view/4368080056/`)

**CRITICAL FIRST STEPS:**
1. Call `browser_open` with the provided URL (even if it looks like a LinkedIn page — don't assume state).
2. Call `browser_wait_load` with `state: "networkidle"`.
3. Call `browser_get_url` to confirm you're on the expected domain.
4. Call `browser_observe_page` to see both the visual layout (annotated screenshot with numbered element labels) and the accessibility tree. Use the combined view to determine:
   - Are you on a job search results page or a specific job posting?
   - Is there a login wall, CAPTCHA, or error message?
   - Does the page say "No longer accepting applications" or "Already applied"?
   - Where is the "Easy Apply" or "Apply" button located visually?

**If launched on a job search URL but need to apply to a specific job:** Use `browser_find_text { text: "Easy Apply", action: "click" }` or click on a job card link to navigate to the job posting.

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

- **Login wall:** If **the observation shows** a sign-in form, a "Sign in to apply" prompt, or the URL has redirected to `linkedin.com/login`, STOP. Return `blocked: true` with `blocked_reason: "LinkedIn login required"`. The browser session must already be authenticated with LinkedIn for Easy Apply to work — do NOT attempt to enter credentials.
- **"Application no longer available":** If the posting shows "No longer accepting applications", "This job is no longer available", "Position filled", or similar, STOP. Return `success: false`, `end_reason: "closed"`, and `end_reason_description` explaining the specific reason (e.g., "The job posting is no longer accepting applications").
- **Cookie consent / overlays:** Dismiss any cookie banners or notification modals. Use `browser_find_text { text: "Accept", action: "click" }` or `browser_find_role { role: "button", name: "Reject non-essential", action: "click" }`. Re-observe with `browser_observe_page`.
- **"Already applied" indicator:** If LinkedIn shows "Applied" or "You've already applied", STOP. Return `success: false`, `end_reason: "already_applied"`, and `end_reason_description` explaining that you've already applied.
- **Job not found / 404 error:** If the page shows "Page not found", "The job posting no longer exists", or similar, STOP. Return `success: false`, `end_reason: "closed"`, with explanation.

### LinkedIn as an SSO Provider on External Sites

When the **Detected Site is NOT LinkedIn** but the application page shows a LinkedIn SSO button (e.g. "Apply with LinkedIn", "Sign in with LinkedIn", "Continue with LinkedIn"), this is a separate scenario from the LinkedIn Easy Apply flow above. In this case you are using LinkedIn as an identity provider to authenticate with a third-party ATS (Greenhouse, Lever, Workday, SmartRecruiters, etc.).

Follow this flow:

1. **Click the LinkedIn SSO button.** Use one of these in order:
   - `browser_find_text { text: "Apply with LinkedIn", action: "click" }`
   - `browser_find_text { text: "Sign in with LinkedIn", action: "click" }`
   - `browser_find_text { text: "Continue with LinkedIn", action: "click" }`
   - `browser_find_text { text: "LinkedIn", action: "click" }` (branded button fallback)

2. **Check for a new tab or popup.** Call `browser_wait_time { ms: 1500 }` then `browser-tab-list`. If a new tab has opened on `linkedin.com`, call `browser-tab-switch { index: N }` to focus it.

3. **Handle the LinkedIn OAuth page.** Call `browser_wait_load { state: "networkidle" }`, `browser_get_url`, and `browser_observe_page`.

   - **Already authenticated → immediate redirect:** `browser_get_url` shows the ATS domain (not LinkedIn). ✅ Proceed to step 5.
   - **LinkedIn authorization/consent screen** ("Allow [App] to access your LinkedIn account?"):
     - Call `browser_find_text { text: "Allow", action: "click" }` or `browser_find_role { role: "button", name: "Allow", action: "click" }`.
     - Call `browser_wait_load { state: "networkidle" }`. ✅ Proceed to step 4.
   - **LinkedIn login form (email + password):**
     - STOP. Return `blocked: true` with `blocked_reason: "LinkedIn SSO requires LinkedIn login — browser session not authenticated with LinkedIn"`.
     - Do NOT enter any credentials.

4. **If a popup was used:** After consent, the popup typically closes. Call `browser-tab-list` and `browser-tab-switch` back to the original application tab (usually index 0).

5. **Confirm the application page is now accessible:**
   - `browser_wait_load { state: "networkidle" }`
   - `browser_get_url` — confirm you are on the ATS domain.
   - `browser_observe_page` — verify the application form is now visible (use the annotated screenshot to visually confirm the form layout).
   - If still on a login page, STOP with `blocked: true` and `blocked_reason: "LinkedIn SSO failed — still on login page after OAuth flow"`.

6. **Continue with the application form** from Step 3 of the main instructions. Record in `notes`: `"Used LinkedIn SSO to authenticate with [ATS name] — succeeded"`.

**LinkedIn OAuth DOM Reference (for the consent screen):**
- Authorization page URL pattern: `linkedin.com/oauth/v2/authorization`, `linkedin.com/uas/oauth2/authorization`
- "Allow" button: `button[name="authorize"]`, `input[value="Allow"]`, or button with text "Allow"
- "Cancel" / "Deny" button: avoid these — only click "Allow"
- App name displayed on consent page: `.oauth-application-name`, `h1`, or similar heading

### Locating and Clicking the Apply Button

LinkedIn job postings have the apply button in the job details panel. Look for:

1. **Easy Apply button:** A button with text "Easy Apply" — usually has a LinkedIn-specific icon and class like `jobs-apply-button--top-card` or contains the text "Easy Apply".
2. **External Apply button:** A button with just "Apply" text and an external link icon.

To find the button, try these approaches in order:
- `browser_find_text { text: "Easy Apply", action: "click" }`
- If not found: `browser_find_text { text: "Apply", action: "click" }`
- If neither found: `browser_find_role { role: "button", name: "Apply", action: "click" }`
- As a last resort: `browser_observe_page` to get both the visual layout and accessibility tree — use the annotated screenshot to visually locate the apply button and the snapshot refs to click it.

Wait for the result after clicking:
- For Easy Apply: `browser_wait_selector { selector: ".jobs-easy-apply-modal" }` or `browser_wait_selector { selector: ".artdeco-modal" }` to wait for the modal.
- For External Apply: `browser_wait_time { ms: 2000 }`, then `browser_get_url` to check if the domain changed. If so, call `browser-tab-list` and `browser-tab-switch { index: N }` if a new tab was opened.
- After the modal or new page appears, call `browser_observe_page` to see the form elements both visually and in the accessibility tree. The annotated screenshot is especially useful for LinkedIn's modal forms where the visual layout helps identify grouped fields, progress steps, and button positions.

### Filling the Easy Apply Modal

If Easy Apply was detected, proceed through the multi-step modal:

#### Contact Information (Step 1)

The first step typically shows pre-filled contact information. Use `browser_observe_page` to see what's already filled and what needs updating — the annotated screenshot makes it easy to visually verify pre-filled values:

| Field | Selector Patterns | Fill Approach | Profile Key |
|-------|------------------|---------------|-------------|
| First Name | `input[name*="firstName"]`, `#first-name` | `browser_find_label { label: "First name", action: "fill", value: "..." }` | `name` (first part) |
| Last Name | `input[name*="lastName"]`, `#last-name` | `browser_find_label { label: "Last name", action: "fill", value: "..." }` | `name` (remaining parts) |
| Email | `input[name*="email"]`, `input[type="email"]` | Verify pre-filled value with `browser_get_value`. If wrong: `browser_find_label { label: "Email", action: "fill", value: "..." }` | `email` |
| Phone | `input[name*="phone"]`, `input[type="tel"]` | `browser_find_label { label: "Phone", action: "fill", value: "..." }` | `phone` |
| Phone Country Code | `select` near phone field | `browser_select { selector: "@eN", value: "..." }` | Derived from `phone` |
| Location / City | `input[name*="city"]`, `input[name*="location"]` | `browser_fill` then handle autocomplete (see below) | `location` |
| LinkedIn Profile | Usually not editable | — Pre-filled by LinkedIn | — |

**Important for autocomplete fields (location/city):** LinkedIn uses typeahead/autocomplete inputs:
1. Call `browser_fill { selector: "@eN", text: "City Name" }` to enter the location.
2. Call `browser_wait_time { ms: 800 }` for suggestions to load.
3. Call `browser_snapshot` to see the dropdown suggestion list.
4. Call `browser_click` on the first matching suggestion (e.g. `browser_find_first { selector: "li[role='option']", action: "click" }` or `browser_click { selector: "@eN" }` from the snapshot).

After filling all visible fields, advance to the next step:
- `browser_find_text { text: "Next", action: "click" }` or `browser_find_role { role: "button", name: "Continue to next step", action: "click" }`
- Call `browser_wait_load { state: "networkidle" }` and `browser_observe_page` for the next step — the annotated screenshot helps visually confirm you've advanced to a new form step.

#### Resume Upload (Step 2)

The resume step typically shows:

- A file upload area for resume (drag-and-drop or click to browse).
- An option to select a previously uploaded resume.
- An optional cover letter upload.

To upload a resume:
1. Call `browser_observe_page` to locate the file upload element — the annotated screenshot makes it easy to visually identify the upload zone. Look for `input[type="file"]`, an "Upload resume" button, a "Choose file" button, or a drag-and-drop zone.
2. If Resume File Path is not empty:
   - Use `browser_upload { selector: "@eN", files: "<Resume File Path>" }` where `@eN` is the ref of the upload button, drop zone, or `input[type="file"]` element found in the snapshot.
   - **NEVER use `browser_click` on an upload button** — this opens a native OS file picker the agent cannot interact with.
   - **NEVER use `browser_fill` for file uploads.**
   - If the snapshot ref is for the visible "Upload resume" button (not the hidden file input), `browser_upload` handles it correctly regardless.
3. If Resume File Path is empty, check if a previously uploaded resume is already selected (look for a filename display in the snapshot). If so, leave it. If no resume is selected, record the field as `missing`.
4. After uploading, call `browser_observe_page` to visually verify the filename appears in the upload area confirming success.

For cover letter:
- If a cover letter upload field exists and no file is available, skip it (it is usually optional).

Click "Next" to proceed: `browser_find_text { text: "Next", action: "click" }`, then `browser_observe_page` to see the next step.

#### Additional Questions (Step 3+)

This step contains employer-defined custom questions. Call `browser_observe_page` to see all fields — the annotated screenshot is especially helpful for identifying radio button groups, dropdowns, and checkbox clusters that can be ambiguous in the accessibility tree alone. Common patterns:

| Question Pattern | Strategy |
|-----------------|----------|
| "How many years of experience do you have with [skill]?" | Check `years_of_experience` or count from experience entries. Use `browser_fill` for number inputs. For dropdowns, determine the type first (see dropdown handling below). |
| "Are you legally authorized to work in [country]?" | Check user's location/preferences. If uncertain, mark as `missing`. |
| "Will you now or in the future require sponsorship?" | Check profile if available. If uncertain, mark as `missing`. |
| "What is your expected salary?" / "Desired salary" | Use `salary_expectations` from profile. If not set, mark as `missing`. Use `browser_fill` with the value. |
| "Why do you want to work at [Company]?" / free-text | Compose 2-3 sentences using Job Description context. Use `browser_fill { selector: "@eN", text: "..." }` on the textarea. |
| "Describe your experience with [topic]" | Use Resume Data and Job Description. Fill with `browser_fill`. |
| Gender / Race / Ethnicity / Veteran / Disability | Choose "Prefer not to answer" or "Decline to self-identify". Use the correct dropdown interaction method (see below). NEVER fabricate demographic data. |
| "Are you 18 years or older?" | Answer "Yes" using the correct dropdown or radio interaction method (see below). |
| Checkbox: "I agree to the terms..." | `browser_check { selector: "@eN" }`. |

**For select/dropdown questions — CRITICAL: LinkedIn uses BOTH native `<select>` elements AND custom JS dropdowns. You MUST identify which type you're dealing with before interacting:**

**Step 1: Identify the dropdown type from the screenshot + snapshot:**
- Look at the **annotated screenshot**: Native `<select>` elements appear as plain, browser-styled dropdowns with a small triangle. Custom dropdowns appear as styled buttons/divs with custom chevrons, rounded corners, or branded styling.
- Look at the **accessibility snapshot**: Native selects show `<select>` with `<option>` children. Custom dropdowns show `<div>`, `<button>`, or `<span>` with `role="listbox"`, `role="combobox"`, `aria-haspopup="listbox"`, or `aria-expanded`.

**Step 2a: If it IS a native `<select>` (has `<option>` children in snapshot):**
1. `browser_get_html { selector: "@eN" }` — read all `<option>` elements and their `value` attributes.
2. Choose the most appropriate option.
3. `browser_select { selector: "@eN", value: "option_value" }` — use the `value` attribute, NOT the display text (unless they match).
4. `browser_screenshot_annotated` — verify the selected option is displayed.

**Step 2b: If it is a CUSTOM/JS dropdown (no `<option>` children, uses `role="listbox"` or similar):**
1. `browser_click { selector: "@eN" }` — click the dropdown trigger to open it.
2. `browser_wait_time { ms: 500 }` — wait for the options panel to appear.
3. `browser_snapshot` — get fresh @e refs for the now-visible option items (look for `role="option"` elements).
4. `browser_screenshot_annotated` — SEE the open dropdown with all options labeled. Visually confirm which option you want.
5. `browser_click { selector: "@eM" }` — click the desired option from the list.
6. `browser_screenshot_annotated` — verify the dropdown now shows the correct selected value.

**Step 2c: If unsure, try `browser_select` first. If it FAILS, the element is a custom dropdown — immediately switch to the click-to-open pattern (Step 2b). Do NOT retry `browser_select` on a custom dropdown.**

**Common LinkedIn custom dropdowns:** Years of experience selects, education level, "Yes"/"No" answer dropdowns on custom questions. These typically use `select.fb-dropdown__select` (which IS a native select) but some employer-configured questions use custom React components that look identical in the screenshot but are NOT native selects.

**Tip:** LinkedIn's `select.fb-dropdown__select` selectors ARE native `<select>` elements — use `browser_select` for these. But if you see a dropdown-like element without `<option>` children in the snapshot, it's custom — use click-to-open.

**For radio button groups:**
1. Call `browser_snapshot` and read all radio option labels and their refs (e.g. `@e10 Yes`, `@e11 No`).
2. Choose the most appropriate option based on the user profile. If the information is not available, pick the most neutral/reasonable option (e.g. "No", "Prefer not to answer", "Decline to self-identify").
3. Call `browser_click { selector: "@eN" }` directly on the radio `input` ref — NOT on its label.
4. Call `browser_snapshot` to confirm the radio is now checked. If it is not checked, try `browser_click` on the label ref associated with the desired option.
5. **NEVER use `browser_fill` or `browser_check` on a radio button.** Radio buttons must always be activated with `browser_click`.

**Multiple additional question pages:** LinkedIn may spread custom questions across multiple steps. After each page, call `browser_find_text { text: "Next", action: "click" }` and `browser_observe_page` to check for more questions — use the annotated screenshot to quickly see the new set of fields.

**If "Next" does not advance the form (stuck on a step):**
1. Call `browser_snapshot` immediately — look for red error text, required field indicators (`*`), or `.artdeco-inline-feedback--error` messages.
2. Call `browser_get_count { selector: ".artdeco-inline-feedback--error" }` to count validation errors.
3. For each error, identify the offending field from the snapshot and fix it:
   - Native `<select>` dropdown: `browser_select { selector: "@eN", value: "..." }`
   - Custom JS dropdown: `browser_click` to open → `browser_snapshot` → `browser_click` on the correct option
   - Radio group: `browser_click { selector: "@eN" }` on the correct option
   - Text input: `browser_fill { selector: "@eN", text: "..." }`
4. Take a fresh `browser_snapshot` and retry "Next".
5. If the same validation error persists after 2 fix attempts, record it in `errors`, mark the field as `error`, and try advancing anyway. Do NOT loop indefinitely on a single step.

#### Review (Step N-1)

The review step shows a summary of all entered information. Here:

1. Call `browser_observe_page` to verify all critical fields appear correct — the annotated screenshot gives you a visual confirmation of the review summary.
2. Look for any warnings or validation errors (red text, error icons). Use `browser_get_count { selector: ".artdeco-inline-feedback--error" }` to check for errors.
3. If validation errors are present, try to go back and fix them. If unable, record them in `errors`.

#### Submit (Final Step)

1. Locate the submit button. Try in order:
   - `browser_find_role { role: "button", name: "Submit application", action: "click" }`
   - `browser_find_text { text: "Submit application", action: "click" }`
   - `browser_find_text { text: "Submit", action: "click" }`
   - From snapshot: `browser_click { selector: "@eN" }` where `@eN` is the submit button ref
2. After clicking, wait for confirmation:
   - `browser_wait_text { text: "Application submitted" }` or `browser_wait_text { text: "Your application was sent" }`
   - If no confirmation text appears, call `browser_snapshot` to check the page state.
3. Take a `browser_screenshot { path: "<Screenshot Directory>/linkedin-application-result.png" }` of the confirmation state.
4. If the submission fails (validation errors reappear, error toast, etc.), record the errors and return `success: false`.

### Handling External Application (If Applicable)

If the apply button redirected to an external site:

1. Call `browser_get_url` to identify the new domain and ATS type from the URL.
2. If a new tab was opened, call `browser-tab-list` then `browser-tab-switch { index: N }` to switch to it.
3. Call `browser_observe_page` to analyze the external form — the annotated screenshot helps you quickly understand an unfamiliar form layout.
4. Check if the form is inside an iframe. If so, call `browser-frame-switch { selector: "iframe[src*='...']" }` then `browser_snapshot`.
5. Use the standard field mapping from the User Profile. Prefer `browser_find_label` for labeled fields:
   - `browser_find_label { label: "First Name", action: "fill", value: "..." }`
   - `browser_find_label { label: "Email", action: "fill", value: "..." }`
   - `browser_find_label { label: "Phone", action: "fill", value: "..." }`
   - For file uploads: `browser_fill { selector: "input[type='file']", text: "<Resume File Path>" }`
6. Fill all discoverable fields following the generic form-filling approach.
7. Handle multi-step forms by calling `browser_find_text { text: "Next", action: "click" }` and repeating with `browser_observe_page`.
8. Submit and capture confirmation with `browser_screenshot`.

### LinkedIn-Specific DOM Reference

These selectors are known patterns for LinkedIn's job application UI as of 2024–2025. They may change over time — always verify with `browser_observe_page` or `browser_snapshot` before using:

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
- Native select dropdowns: `select.fb-dropdown__select`, `select[data-test-text-selectable-option]` — use `browser_select` for these
- Custom JS dropdowns: `div[role="listbox"]`, `button[aria-haspopup="listbox"]`, `div.fb-dropdown` (without a child `<select>`) — use click-to-open + click-option for these
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

- **Handle LinkedIn's autocomplete fields carefully.** After `browser_fill`, call `browser_wait_time { ms: 800 }`, then `browser_snapshot` to find the suggestion dropdown. Call `browser_click` on the best match. If no suggestions appear, try clearing with `browser_fill { selector: "@eN", text: "" }` and retyping.
- **Watch for validation errors after each step.** If clicking "Next" doesn't advance, call `browser_snapshot` and check for error messages (`.artdeco-inline-feedback--error`). Use `browser_get_count { selector: ".artdeco-inline-feedback--error" }` to enumerate errors. Fix each errored field (radios → `browser_click`, native selects → `browser_select`, custom dropdowns → click-to-open + click-option, text → `browser_fill`). Retry "Next" once. If still stuck after 2 attempts, record in `errors` and move on — never loop indefinitely.
- **Dropdown errors are the most common cause of "Next" not advancing.** If a dropdown field shows a validation error, first determine if it's a native `<select>` or a custom dropdown (check the snapshot for `<option>` children). If you used `browser_select` and the error persists, the element is likely a custom dropdown — switch to the click-to-open pattern immediately.
- **Handle the dismiss confirmation dialog.** If you need to close the modal prematurely, LinkedIn may show "Discard application?" — use `browser_find_text { text: "Discard", action: "click" }` to cleanly close.
- **Be efficient.** LinkedIn Easy Apply is designed to be quick. Most applications should complete in under 60 seconds of interaction time. Don't over-think simple fields.
- **Verify pre-filled fields.** LinkedIn often pre-fills contact info. Use `browser_get_value` to verify pre-filled values match the user profile before advancing.
- **Handle external tab switches properly.** If the apply button opens a new tab, call `browser-tab-list` then `browser-tab-switch` to follow the redirect.
- **Always start by navigating.** Even if you're already on LinkedIn, always call `browser_open` with the target URL first. The browser session state may have changed.
- **Use best-fit answers when profile data is unavailable.** If a required field has no matching profile data, choose the most neutral or reasonable available option rather than leaving it blank or stopping. Record the choice in the `fields` array with `status: "best_fit"` and explain what was chosen in `error_reason`.
- **File uploads: always use `browser_upload`.** Never `browser_click` or `browser_fill` on any upload button or file input. `browser_upload { selector: "@eN", files: "/absolute/path/to/resume.pdf" }` sets the file directly without opening any dialog.
- **Detect page state early.** After initial navigation and observation, immediately check for login walls, closed jobs, or "already applied" states before attempting to fill forms.
- **Use `browser_observe_page` at every major transition.** After clicking "Next", after SSO redirect, after modal open, and after external redirect — always observe the page to get both visual and structural views. The annotated screenshot is especially valuable for LinkedIn's modal-based Easy Apply flow where visual context helps identify progress steps, grouped fields, and button positions.