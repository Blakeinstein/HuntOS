## SSO / Social Login Handling

Many job application sites and ATS platforms allow (or require) login via a third-party identity provider before showing the application form. When you encounter a login wall, **do not immediately block** — first inspect the page for SSO (Single Sign-On) options and attempt to use them to proceed.

---

### Step SSO-1: Detect SSO Options on a Login Wall

When the observation shows a login page or sign-in wall, call `browser_observe_page` (preferred — gives you both a visual annotated screenshot and the accessibility tree) and look for any of the following SSO buttons before giving up:

| Button Text / Label Pattern | Provider | Priority |
|----------------------------|----------|----------|
| "Sign in with LinkedIn", "Continue with LinkedIn", "Login with LinkedIn" | LinkedIn | **Highest** — prefer this whenever available |
| "Sign in with Google", "Continue with Google", "Login with Google" | Google | High |
| "Sign in with Microsoft", "Continue with Microsoft" | Microsoft | Medium |
| "Sign in with GitHub" | GitHub | Low |
| "Sign in with Apple" | Apple | Low |
| Any button with an official provider logo + "Sign in" text | Other | Low |

**Detection strategies:**

1. `browser_find_text { text: "Sign in with LinkedIn", action: "click" }` — exact text match
2. `browser_find_text { text: "Continue with LinkedIn", action: "click" }` — alternate phrasing
3. `browser_find_text { text: "LinkedIn", action: "click" }` — partial match (LinkedIn-branded button)
4. `browser_find_role { role: "button", name: "LinkedIn", action: "click" }` — accessible name
5. `browser-find-selector { selector: "a[href*='linkedin.com/oauth'], button[data-provider='linkedin'], [class*='linkedin-sso'], [class*='linkedin-login']", action: "click" }` — CSS selector patterns

Repeat this approach for Google replacing "linkedin" with "google", etc.

**If no SSO option is found** and the page only shows an email/password form with no other path forward, STOP. Return `blocked: true` with `blocked_reason: "Login required — no SSO option available"`.

---

### Step SSO-2: Handle the SSO Provider Flow

After clicking an SSO button, the browser will redirect to the identity provider's authorization page. Follow the steps below based on which provider was triggered.

#### LinkedIn SSO Flow

LinkedIn's OAuth consent page URL contains `linkedin.com/oauth` or `linkedin.com/uas/login`.

1. Call `browser_wait_load { state: "networkidle" }` after clicking the SSO button.
2. Call `browser_get_url` to confirm you have landed on a LinkedIn domain.
3. Call `browser_observe_page` to inspect the page — the annotated screenshot helps visually distinguish between a consent screen and a login form.

**Case A — Already authenticated with LinkedIn (most common):**
- The page will immediately redirect back to the application site without showing a login form.
- Call `browser_wait_load { state: "networkidle" }`, then `browser_get_url` to confirm the redirect.
- If back on the original application site, continue with the application form.

**Case B — LinkedIn shows a consent / authorization screen (not a login form):**
- The page asks "Allow [App] to access your LinkedIn account?" with "Allow" and "Cancel" buttons.
- Call `browser_find_text { text: "Allow", action: "click" }` or `browser_find_role { role: "button", name: "Allow", action: "click" }`.
- Wait for redirect: `browser_wait_load { state: "networkidle" }`.
- Call `browser_get_url` and `browser_observe_page` to confirm you are back on the application site.

**Case C — LinkedIn shows a login form (not authenticated):**
- The page shows email/password fields for LinkedIn itself.
- STOP. Return `blocked: true` with `blocked_reason: "LinkedIn SSO requires LinkedIn login — user must log into LinkedIn first"`.
- Do NOT attempt to enter LinkedIn credentials. The browser session must be pre-authenticated.

#### Google SSO Flow

Google's OAuth page URL contains `accounts.google.com`.

1. Call `browser_wait_load { state: "networkidle" }` and `browser_get_url`.
2. Call `browser_observe_page` to inspect the page.

**Case A — Google account chooser (already signed in):**
- The page shows one or more Google accounts to choose from.
- Look for the user's email address in the profile list. Call `browser_find_text { text: "<user_email>", action: "click" }` where `<user_email>` is from the User Profile.
- If the exact email is not listed, click the first available account: `browser_find_role { role: "listitem", action: "click" }` on the first account entry.
- Wait for redirect and confirm with `browser_get_url`.

**Case B — Google consent screen:**
- The page shows "Allow [App] to access your Google Account?"
- Call `browser_find_text { text: "Allow", action: "click" }` or `browser_find_role { role: "button", name: "Allow", action: "click" }`.
- Wait for redirect.

**Case C — Google login form (not authenticated):**
- STOP. Return `blocked: true` with `blocked_reason: "Google SSO requires Google login — user must be signed into Google first"`.

#### Microsoft SSO Flow

Microsoft's OAuth page URL contains `login.microsoftonline.com` or `login.live.com`.

1. Call `browser_wait_load { state: "networkidle" }` and `browser_get_url`.
2. Call `browser_observe_page` to inspect the page.

**Case A — Microsoft account already signed in (consent or account picker):**
- Look for the user's email in an account picker and click it.
- Or click "Accept" / "Continue" on a consent screen.

**Case B — Microsoft login form:**
- STOP. Return `blocked: true` with `blocked_reason: "Microsoft SSO requires Microsoft login — user must be signed in first"`.

#### Other SSO Providers (GitHub, Apple, etc.)

Follow the same pattern:
1. Click the SSO button.
2. Wait for redirect and inspect the landing page.
3. If an account picker or consent screen is shown, proceed (click the account or "Allow").
4. If a login form is shown (email/password required), STOP and return `blocked: true`.

---

### Step SSO-3: Confirm Return to Application Site

After any SSO flow completes (or redirects back), verify you are on the correct application page:

1. Call `browser_wait_load { state: "networkidle" }`.
2. Call `browser_get_url` — confirm the domain matches the original application URL.
3. Call `browser_observe_page` — verify the application form (or a job posting page) is now visible. The annotated screenshot helps you visually confirm the form is accessible and ready for filling.

If the application form is now visible, **continue from Step 3 of the main instructions** (Identify the Application Form). Do NOT re-run Steps 1 or 2 — you are already authenticated and on the correct page.

If you are still on a login page after SSO, try one more SSO provider (if available) or STOP with `blocked: true`.

---

### Step SSO-4: Handle SSO Tab/Popup Behavior

Some sites open the SSO provider in a **new tab or popup window** rather than redirecting in the same tab.

1. After clicking the SSO button, call `browser_wait_time { ms: 1500 }`.
2. Call `browser-tab-list` to check if a new tab has opened.
3. If a new tab exists (URL contains the provider domain), call `browser-tab-switch { index: N }` to switch to it.
4. Handle the SSO provider flow as described in Step SSO-2.
5. After the provider flow completes, the popup/tab typically closes automatically. Call `browser-tab-list` again.
6. Switch back to the original application tab: `browser-tab-switch { index: 0 }` (or whichever index the original tab is at).
7. Call `browser_wait_load { state: "networkidle" }` and `browser_observe_page` to confirm the application page is now authenticated.

---

### SSO Decision Tree (Summary)

```
Login wall detected?
    └─ YES → Look for SSO buttons
         ├─ LinkedIn SSO found → Click it
         │    ├─ Already authenticated → Redirected back → Continue application ✓
         │    ├─ Consent screen → Click "Allow" → Redirected back → Continue ✓
         │    └─ Login form shown → STOP → blocked: "LinkedIn login required"
         ├─ Google SSO found → Click it
         │    ├─ Account picker → Select user email → Consent → Continue ✓
         │    └─ Login form shown → STOP → blocked: "Google login required"
         ├─ Microsoft / GitHub / Apple SSO found → Same pattern as above
         └─ No SSO found → STOP → blocked: "Login required — no SSO available"
```

---

### SSO Rules

- **NEVER enter credentials (email/password) for any provider.** The browser session must already be authenticated with the SSO provider. If credentials are required, STOP.
- **NEVER create new accounts.** Do not click "Sign up", "Create account", or "Register" — only use existing SSO sessions.
- **Prefer LinkedIn SSO** over other providers when multiple options are available, since the application may be LinkedIn-sourced.
- **Handle popups and new tabs.** SSO flows often open in new windows. Always check `browser-tab-list` after clicking an SSO button if no immediate redirect occurs.
- **Do not loop on SSO.** If one SSO attempt fails (reaches a login form), try the next available provider. After two failed SSO attempts, STOP with `blocked: true`.
- **Dismiss consent dialogs promptly.** If the provider shows a consent screen, clicking "Allow" is safe — you are granting the application site access to basic profile data, which is expected behavior.
- **Record SSO attempts in `notes`.** Include which provider was tried and what happened (e.g. "Used LinkedIn SSO — already authenticated, redirected back to Greenhouse form successfully").