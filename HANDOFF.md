# Popsicle: handoff for the next agent

Read this before changing anything. It covers what Popsicle is, the rules the owner (Umer) set, how features have been built so far (the process, tests and checks), how each part works, the gotchas that have already bitten, and what's planned next. `README.md` is the user-facing manual; this file is the engineering one.

---

## 1. What Popsicle is

A personal cold-email tool. Umer (a CS student in Toronto) uses it to reach engineers at target companies and turn replies into coffee chats:

1. **Find people** at a company (Hunter.io): by company, job titles and location (default: the Greater Toronto Area).
2. **Compose** one templated email with `{{variables}}` and send a personal copy to each person **from his own Gmail**, spaced out, never to anyone twice, optionally scheduled.
3. **Inbox**: syncs every Gmail thread with the people emailed and shows who replied.
4. **Send Meet link**: creates a Google Calendar event with a Meet link and replies in the thread.
5. **Companies**: a target list with statuses (not started / emailed / replied / not a fit).

Single user today, built to be deployed (Vercel + Railway planned, see §9).

---

## 2. Ground rules (non-negotiable)

These come straight from the owner. Breaking them has caused real problems before.

1. **Never send anything through his real Gmail or Google account.** No emails, no batches, no Meet links, no calendar invites, no test sends. Never POST to the live backend's send/campaign/meeting endpoints (`localhost:8000`) and never click a real send button on `localhost:3000`. Read-only checks (GET requests, read-only SQL) are fine. All sending is tested with fakes (§6). The recipients are real recruiting contacts.
2. **Never spend Hunter credits in tests.** He's on the free plan (50 credits/month). Tests fake `hunter._request`. Don't run live Hunter searches yourself either.
3. **Every feature ships with tests**, and every suite stays at **90%+ coverage** (enforced): backend pytest, frontend Vitest + Testing Library, and Playwright end-to-end when a user flow changes. Run them before committing.
4. **Git workflow**:
   - Work on a **feature branch** off an up-to-date `main`.
   - **Commit and push after every incremental step** (e.g. backend, then frontend, then e2e/docs). He wants granular commits on his GitHub profile.
   - When done: wait for CI to pass, merge into `main` with `--no-ff`, push `main`, and confirm `main`'s CI passes.
   - End commit messages with the co-author line your tooling specifies.
5. **Use the GitHub CLI (`gh`)** for Actions runs and logs (`gh run list`, `gh run watch <id> --exit-status`, `gh run view <id> --log-failed`), not curl against the GitHub API. He's logged in.
6. **Secrets**: never print, log or commit `backend/.env` (has `HUNTER_API_KEY`) or `backend/credentials.json` (Google OAuth client). Both are gitignored. When you need to know what's in `.env`, list the setting *names* only (e.g. `sed -E 's/=.*//' backend/.env`).
7. **The real database** (`cold_emailer` on port 5442) holds his real contacts and history: read-only queries only. Tests use `cold_emailer_test` (guarded, §6).
8. **Don't restart his dev servers** or do anything outward-facing (deploys, sending, sharing) without asking. Ask before deleting or overwriting anything you didn't create.
9. **Public pages use made-up names** (the landing page shows "Alex, Priya, Daniel"), never his real contacts.

---

## 3. Stack and layout

| Part | Tech |
|---|---|
| Backend | Python 3.14, FastAPI, SQLAlchemy 2, psycopg 3, Postgres 14, pinned in `backend/requirements*.txt` |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4, lucide-react, TypeScript |
| Tests | pytest + pytest-cov; Vitest + Testing Library + MSW; Playwright (Chromium) |
| CI | `.github/workflows/test.yml`: backend + CLI pytest, frontend lint, `npm run typecheck`, Vitest with coverage, Playwright |
| External | Gmail API, Google Calendar API (Meet), Hunter.io API |

```
backend/app/
  main.py            app, middleware (frontend-only gate, Origin check), routers, startup (create_all, migrations, sweeper)
  config.py          settings + safety rules (is_local, fail-closed when deployed)
  models.py          all tables
  migrations.py      COLUMNS list: adds columns to existing tables at startup (no Alembic yet)
  schemas.py         Pydantic request/response models
  campaigns.py       preview, create, and the background sender (claims, leases, sweeper)
  sending.py         daily limit: quota() and the locked reserve()
  rendering.py       {{placeholder}} filling
  gmail.py           OAuth (scopes, OAuthState in DB), credentials, send()
  secrets_box.py     Fernet encryption of the stored Gmail login
  hunter.py          Hunter client, 30-day cache (HunterLookup)
  verification.py    Email Verifier (parallel, cached 30 days)
  targets.py         company list: bulk add, fill domains
  conversations.py   Gmail sync (claimed on the account row), message parsing
  meetings.py        Calendar event + Meet link + threaded reply
  safety.py          strict email regex, safe_url, line-break checks
  auth.py            passwords, sessions, throttling, trusted devices, proxy secret
  manage.py          CLI: create-user / invite / set-password / list-users / delete-user
  routers/           auth, campaigns, conversations, misc (templates, attachments, gmail, stats),
                     people (companies, contacts), people_search (Hunter), sending_limits
backend/tests/       conftest.py, factories.py, fake_gmail.py, api/, unit/
frontend/src/
  app/               pages: / (landing), compose, find, lookup, sent, conversations (Inbox),
                     contacts, companies, login; layout.tsx; globals.css (palette)
  components/        ui.tsx (Button, Modal, Popover, StatusBadge…), Select.tsx (custom dropdown),
                     Nav.tsx, Theme.tsx, compose/, find/, lookup/, conversations/, landing/
  lib/               api.ts (fetch wrapper + types), credits, schedule, meet, roles, locations,
                     chips, people (handoff to Compose), pieces, safeUrl, theme(Script)
  proxy.ts           Next 16 "proxy" (was middleware): adds the shared secret to /api calls
  test/              MSW server (api()/apiError()), fixtures, navigation mock, setup
frontend/e2e/        Playwright specs + fake-api.ts
cli/                 the original command-line sender (has its own tests)
dev.sh               starts Postgres (5442), backend (8000, --reload) and frontend (3000)
```

---

## 4. Running it locally

- `./dev.sh` from the repo root starts everything. Landing: http://localhost:3000. App: http://localhost:3000/compose. API docs: http://localhost:8000/docs (local only).
- **Postgres**: cluster in `~/Desktop/personal-projects/psqlConnections/cold-emailer-5442`, port **5442**, database `cold_emailer`, UTF-8. Read-only check: `psql -p 5442 -h localhost -d cold_emailer -Atc "SELECT …"`.
- **Backend venv**: `backend/.venv/bin/python`. The backend runs with `--reload`, so it restarts on file changes and runs `migrations.run()` on startup. New tables come from `create_all`; new *columns* must be added to `migrations.COLUMNS`.
- **Locally, login is off.** The app counts as local only when the backend address, frontend address and database are all on localhost (§7.9).

---

## 5. How features have been built (follow this process)

1. **Understand the ask.** He writes quickly and informally. Restate what you'll build in a few lines. If a decision is genuinely his (design choice, cost trade-off), ask; otherwise pick the sensible default and say so.
2. **Read before writing.** `grep` for the relevant code, read the module and its tests, and match their style: comment density, naming, plain-English docstrings that explain *why*.
   - **Next.js 16** differs from older versions. Read the bundled docs in `frontend/node_modules/next/dist/docs/` before using a Next API (e.g. `proxy.ts` replaced `middleware.ts`; `LayoutProps` comes from `next typegen`).
   - For **Hunter or Google behaviour**, check their docs (WebFetch) and, where possible, the real account's behaviour via read-only data, not memory. Hunter's pricing page and its actual billing differ (§7.3).
3. **Branch**: `git checkout main && git pull origin main && git checkout -b <feature>`.
4. **Backend step**:
   - Model and migration column if needed.
   - Logic in a service module, not in the router.
   - Schemas with validation (`Field` limits, `field_validator`).
   - Router endpoint.
   - Tests: unit for logic, API for routes.
   - Run `cd backend && .venv/bin/python -m pytest -q -p no:cacheprovider`, then **commit and push**.
5. **Frontend step**:
   - Types in `lib/api.ts`.
   - Pure helpers in `lib/` with their own unit tests.
   - Components.
   - Vitest tests with MSW.
   - Run `npm run typecheck`, `npx eslint src e2e`, `npx vitest run --coverage`, then **commit and push**.
6. **E2E step**: when a user flow changes, add or extend a Playwright spec with `FakeApi`, then run `CI= npx playwright test`. Commit and push.
7. **Look at it.** For UI work, take screenshots and actually look at them (desktop ~1280–1772 wide, tablet 768/1024, phone 390). Use a *temporary* Playwright spec against the e2e build with `FakeApi` (fake data), e.g. `e2e/zz-shot.spec.ts`, and delete it afterwards. See §6.3. Check both themes if the change touches colours.
8. **Docs**: update `README.md` (user-facing) when behaviour changes. Update this file when you learn a gotcha.
9. **Ship**: push, then watch CI:
   ```
   ID=$(gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId')
   gh run watch $ID --exit-status --interval 20
   ```
   When it's green: `git checkout main && git pull origin main && git merge --no-ff <branch> && git push origin main`. Then watch `main`'s run the same way.
10. **Report** in plain language: what changed, what he'll see, test counts, anything he must do (e.g. restart the dev server, reconnect Gmail), and open questions.

**Before claiming something works**, verify it (a test, a screenshot, a read-only query). If something failed or was skipped, say so.

---

## 6. Testing in detail

### 6.1 Backend (`backend/tests`)
- **`conftest.py`** sets env vars *before* importing the app:
  - `DATABASE_URL` points to `cold_emailer_test`, and an assertion refuses any database whose name doesn't end in `_test`.
  - `BACKEND_URL=http://localhost:8000` and `FRONTEND_URL=http://localhost:3000`, so tests run as "local".
  - `AUTH_REQUIRED=false`, plus a fake `HUNTER_API_KEY`.
  - The test database is created and dropped by the session; every table is truncated before each test, and in-memory state (campaign sets, auth failures) is cleared.
- **Fixtures**:
  - `db` (a session) and `client` (TestClient; the background sweeper is disabled).
  - `started`: records `campaigns.start` calls instead of starting threads.
  - `settings(...)`: change a setting for one test.
- **Fakes**:
  - Hunter: monkeypatch `hunter._request` (see the `hunter_api` fixture in `tests/api/test_people_search.py`, or `stripe` in `tests/api/test_new_people.py`).
  - Gmail: `outbox` fixture in `tests/unit/test_campaign_run.py`, which patches `gmail.load_credentials`, `gmail_service` and `send`, plus `_wait` so nothing sleeps. Also `tests/fake_gmail.py` (threads.list/get).
  - Calendar: `FakeCalendar` in `tests/unit/test_meetings.py`.
- **`tests/factories.py`**: `company`, `contact`, `campaign(db, [(address, status)…])`, `sent_email`, `attachment`, `template`, `user`.
- Coverage is enforced in `pyproject.toml` (`--cov-fail-under=90`); the backend sits at ~99–100%.
- **Concurrency bugs**: reproduce with real threads and a `threading.Barrier` (see `TestDailyLimitAcrossBatches`), write the failing test first, then fix.

### 6.2 Frontend unit/component (`frontend/src/**/*.test.ts(x)`)
- **MSW**:
  - Answer routes with `api("get", "/api/x", body)` or `apiError("post", "/api/x", 409, "message")`. Both return the list of calls made, so you can assert on request bodies.
  - **Unhandled requests fail the test** (`onUnhandledRequest: "error"`), so mock everything a component fetches.
  - `quietDefaults()` covers the common ones.
- **Mocks and fixtures**: `next/navigation` is mocked (`src/test/navigation.ts`: set `navigation.pathname`, assert `navigation.router.push`). Fixtures are in `src/test/fixtures.ts`.
- **jsdom limits**:
  - No `SVGPathElement.getTotalLength`, so landing beam code guards for it.
  - No real layout.
  - Use `fireEvent.change` for date/datetime inputs.
- **Coverage excludes** the display-only landing (`src/components/landing/**`, `src/app/page.tsx`) and `layout.tsx`, but the beam geometry in `landing/beams.ts` still has unit tests.
- **Lint (React 19 rules)**:
  - No synchronous `setState` in an effect body.
  - No reading refs during render.
  - No reassigning variables after render.
  - Use the `useSyncExternalStore` "mounted" pattern for pages that read `localStorage`.

### 6.3 End-to-end (`frontend/e2e`)
- **Setup**: `playwright.config.ts` builds the app into `.next-e2e` with `NEXT_PUBLIC_API_URL=http://api.e2e.test` and serves it on port 3100.
- **`FakeApi`** (`e2e/fake-api.ts`) answers that fake host inside the browser, so **nothing reaches the real backend, Gmail or Hunter**.
  - `new FakeApi({ "POST /api/x": body | (body, url) => body }).install(page)`, then `api.called("POST /api/x")`.
  - Unknown routes return 599 so missing mocks are obvious.
  - It blocks `/_next/image` (no internet). For screenshots, call `page.unroute("**/_next/image**")` so the app's own images load.
- **Commands**: run with `CI= npx playwright test` locally. A single file: `CI= npx playwright test e2e/landing.spec.ts`.
- `page.evaluate` runs in the browser: pass Node values as arguments, don't reference outer variables.
- For flakiness, run a new spec 3× in a row.

### 6.4 All suites (what CI runs)
```
cd backend && .venv/bin/python -m pytest -q -p no:cacheprovider
cd cli && ../backend/.venv/bin/python -m pytest -q
cd frontend && npm run lint && npm run typecheck && npx vitest run --coverage && CI= npx playwright test
```

---

## 7. How each part works (and its gotchas)

### 7.1 Compose and sending (`campaigns.py`, `sending.py`, `rendering.py`)
- **Placeholders**:
  - `{{name}}` placeholders are filled in **one pass**, so a value containing `{{email}}` isn't filled again.
  - `full_name` also fills `first_name` and `last_name`.
- **Preview**:
  - Each row gets a status: ready, invalid, already_sent, or undeliverable (verified as nonexistent).
  - Rows are invalid when:
    - the address isn't an ordinary email (`safety.is_email`: no commas, quotes or brackets)
    - a placeholder has no value
    - the subject contains a line break
- **Sending**: one background thread per batch (`start` → `_run`).
- **One sender per batch (claims)**:
  - A batch is claimed in the database (`campaigns.worker_id`, `lease_until`). The sender renews the claim every 15 s, and stops if it loses it or the batch is cancelled anywhere.
  - The **sweeper** (every 30 s) marks batches whose process died as `interrupted`, and restarts `waiting`/`scheduled` batches whose claim lapsed.
  - This makes redeploys (old and new process overlapping) safe. Don't reintroduce in-memory-only state for anything that must survive a restart.
- **At-most-once sends**:
  - `emails.attempted_at` is set just before handing an email to Gmail.
  - Still `pending` with `attempted_at` set means the server died mid-send, so on the next run it's marked **failed: "may have gone out, check Gmail's Sent folder"**, never resent.
  - Retry clears `attempted_at`.
- **Daily limit**:
  - Default 40 per rolling 24 h, and at least 20 s between emails in a batch (`sending_settings`).
  - `sending.reserve()` checks the limit and marks the email as being sent **in one transaction holding a row lock** (`SELECT … FOR UPDATE` on settings).
  - In-flight emails and **Meet link emails** count toward the limit.
  - Over the limit, the batch shows `waiting` and carries on by itself.
- **Scheduling**:
  - `scheduled_for` must have a timezone, be in the future, and be at most 60 days ahead.
  - The sender waits in ≤30 s steps, so "Send now" from another process is noticed.
  - Quick picks: tomorrow / next Tue / next Thu at 9:00 AM local.

### 7.2 Find people and Look up (`hunter.py`, `routers/people_search.py`, `components/find`)
- **Hunter client**:
  - `hunter._request` / `_send`. Domain Search uses **POST with a JSON body** for the location filter (`{"location": {"include": [{city, country}]}}`).
  - The GTA is a list of cities in `frontend/src/lib/locations.ts`.
- **Cache**: responses are cached 30 days in `hunter_lookups` by the exact parameters, so repeating a search is free. `refresh` bypasses it.
- **Credits** (verified against his account):
  - Hunter's pricing page says "1 credit = 1 email found", but his account was actually charged **1 credit per search page that returns 1–10 emails** (50 emails found cost 10 credits).
  - Popsicle's estimates (`lib/credits.ts` `searchCost`) assume the per-page rate.
  - If Hunter starts charging per email, update `searchCost`. The nav credit counter reads live from Hunter, so it'll show the truth either way.
  - Email Finder: 1 credit when found.
  - Verifier: separate monthly verifications allowance.
  - Free: `domains-suggestion` (autocomplete, fill domains), `email-count`, `account`, and logos (`https://logos.hunter.io/<domain>`, allowed in `next.config.ts` `images.remotePatterns`).
- **`job_titles`**: Hunter matches whole words and common word forms ("engineer" finds "Engineering").
  - Role presets live in `frontend/src/lib/roles.ts`. Default: **Software & data** (~40 titles). Others: Recruiting, Engineering leaders, Product, Design.
  - Don't add bare "developer" or "engineer" to presets; they'd match business-development and sales roles.
  - An old saved "software engineer" is upgraded to the default.
- **Get new people** (`POST /api/people-search/company/new`):
  - Walks results 10 per page from the top, skipping people already emailed (and, with `hide_seen`, anyone in `seen_people`).
  - Stops at `want`, or after 10 pages per click.
  - Saved pages are free, so usually only one new page costs a credit.
  - Every search records who was shown in `seen_people`.
- **Already emailed**:
  - Someone counts as emailed if any `emails` row to their address has status `sent`.
  - Their row is shown with a red flag and starts unticked.
- **Handoff to Compose**: `lib/people.ts` (`saveHandoff`/`readHandoff`, via localStorage).

### 7.3 Gmail and Google (`gmail.py`, `secrets_box.py`)
- **Scopes**: send, `gmail.readonly` (Inbox) and `calendar.events` (Meet).
  - Granted scopes are stored in `gmail_accounts.scopes`.
  - Older accounts are treated as send-only.
  - `GET /api/gmail/status` returns `can_read` and `can_meet`.
  - The UI shows "Reconnect Gmail" when a permission is missing.
- **Connecting**:
  - The in-progress sign-in (state, PKCE `code_verifier`, return page) is stored in **`oauth_states`** (15-minute expiry, single use), not in memory, so it survives restarts and works on any process.
  - The callback URL is rebuilt from `BACKEND_URL`, because behind a proxy `request.url` is the internal http address.
- **Stored token**: the Gmail login is encrypted with Fernet when `TOKEN_ENCRYPTION_KEY` is set (always when deployed). A login saved before encryption is encrypted on first use.
- **Plain-http sign-in**: `OAUTHLIB_INSECURE_TRANSPORT` is set **only** when local.
- **Weekly reconnect**: while the Google Cloud app is in "Testing" mode, the login expires every 7 days, so he reconnects weekly. Publishing it may need Google verification because of the Gmail read scope.
- **Errors**: `gmail.is_auth_error` catches 401s and insufficient-scope 403s. A batch pauses as `interrupted` with a reconnect message.

### 7.4 Inbox / conversations (`conversations.py`, `routers/conversations.py`, `components/conversations`)
- **Sync**: `POST /api/conversations/sync` claims a sync on the Gmail account row (`sync_started_at`; stale after 10 min), runs it **in a background thread**, and returns immediately. The page polls `GET /api/conversations/sync`.
- **Searching Gmail**:
  - People are searched a few addresses at a time.
  - Only well-formed addresses go into the search, each in quotes (to block query injection).
  - Only threads whose Gmail `historyId` changed are downloaded (`mail_threads`).
- **Message bodies**:
  - Prefer text/plain; HTML is converted with Python's `HTMLParser` (single pass, ReDoS-safe).
  - Capped at 200 000 characters.
  - Quoted earlier messages are stripped when displayed.
- **Company status**: a reply moves the company to `replied`, unless he set the status himself.
- **No double start**: the frontend shares one in-flight check (React dev mode runs effects twice).

### 7.5 Meet invites (`meetings.py`, `MeetScheduler.tsx`)
- **Creating the call**: a Calendar event with `conferenceData.createRequest` (hangoutsMeet), optionally inviting the person (`sendUpdates=all`). It polls briefly if the link isn't ready yet.
- **The email**: a reply in the latest thread with them (`threadId`, plus `In-Reply-To`/`References` set to the last Message-ID), so the subject is "Re: …". The modal's "Title" is the **calendar event title**, not the email subject.
- **On failure**: if the email fails, the event is deleted.
- **Record and limit**: the meeting is recorded in `meetings` and counts toward the daily limit.
- **Setup**: needs the **Google Calendar API enabled** in his Cloud project; otherwise there's a clear error with a link.

### 7.6 Companies (`targets.py`, `app/companies/page.tsx`)
- **Statuses**: `not_started`, `emailed`, `replied`, `not_interested`. A company moves to emailed on its first send and to replied on a reply, unless set by hand.
- **Paste a list**: sent in pieces of 25. A domain gets Hunter's name for it; a name gets a domain only on an exact match (no guessing).
- **Find missing logos**: 10 per request, with an `after_id` cursor so unknown names aren't retried forever.
- **Select companies → Find people**: pre-fills Find people (`presetCompanies`).

### 7.7 Long requests
Every request must finish quickly, because it goes through Vercel's proxy (§9). Long jobs are either background jobs (Gmail sync) or sent in pieces by the page (`lib/pieces.ts`):
- Verify: 10 addresses per request (5 checked in parallel on the backend).
- Pasted companies: 25 per request.
- Find missing logos: 10 per request.

Keep that pattern for anything new that might take long.

### 7.8 Frontend conventions
- **Palette**: tokens in `src/app/globals.css`, each with one job:

  | Token | Job |
  |---|---|
  | `paper` | Surfaces: cards, inputs, nav, modals |
  | `cloud` | Page background, subtle fills, borders |
  | `ink` | Main text (`ink/NN` for tints) |
  | `steel` | Secondary text |
  | `night` | Dark accents with white text: pills, dark cards, badges |
  | `crimson` / `scarlet` | Brand reds |

  - **Use `bg-paper`, never `bg-white`, for surfaces.** `text-white` is fine on coloured or night backgrounds.
  - Low-opacity `white/5–15` is for tints on dark.
- **Dark mode**:
  - `data-theme="dark"` on `<html>` swaps the token values; use the `dark:` variant if needed.
  - The toggle (`components/Theme.tsx`) is in the screen's top-right corner on ≥1280px and inside the nav bar below that.
  - The choice is stored in localStorage and applied before paint by a fixed inline script (`lib/themeScript.ts`), the only `dangerouslySetInnerHTML` in the app.
  - The **landing page is always dark** (`FIXED_THEME` in `themeScript.ts`).
  - The root layout is a server component, so server-safe theme constants live in `themeScript.ts` (no React imports).
- **Components**:
  - Use the custom `Select` (no native `<select>`), plus `Modal`, `Popover` and `Button` from `ui.tsx`.
  - lucide-react has **no brand icons** (draw the GitHub mark as SVG; LinkedIn uses a generic icon).
- **Links from data must go through `safeHref()`** (`lib/safeUrl.ts`): http(s) only.
- **Credits**: call `creditsChanged()` after anything that may spend Hunter credits, so the nav counter refreshes.
- **Mobile**: tabs move to a bottom bar (7 tabs: Compose, Find, Look up, Sent, Inbox, People, Firms).

### 7.9 Auth, security and deploy rules (`config.py`, `auth.py`, `main.py`, `proxy.ts`)
- **Local vs deployed**: **local** means `BACKEND_URL`, `FRONTEND_URL` *and* the database are all on localhost. Anything else is "deployed", and the backend **refuses to start** unless:
  - login is on (`AUTH_REQUIRED` can't be false)
  - `TOKEN_ENCRYPTION_KEY` is set and valid
  - `PROXY_SECRET` is at least 32 characters
  - `BACKEND_URL` and `FRONTEND_URL` aren't localhost

  Also, when deployed: the cookie is https-only, the API docs are hidden, and plain-http OAuth is off.
- **One site**:
  - The frontend forwards `/api/*` to the backend (`BACKEND_ORIGIN` in `next.config.ts` rewrites), so cookies are first-party (Safari-safe).
  - `src/proxy.ts` adds `x-popsicle-proxy: PROXY_SECRET` and the visitor's IP. When deployed, the backend rejects anything without the secret (403 "Use Popsicle through its website"), except `/api/health`.
  - The client IP is believed only from that header.
- **Logins**:
  - Accounts are created with `python -m app.manage create-user <email>` (invite-only; sign-up only works for invited emails without a password).
  - Throttling: 5 wrong passwords per visitor per 15 minutes, and 20 per account, except from a **trusted device** (`popsicle_device` cookie, table `trusted_devices`).
- **Other**:
  - State-changing requests whose `Origin` isn't the frontend get a 403.
  - `SameSite` is `lax` or `strict` only.
  - Security headers come from `next.config.ts`: no framing, nosniff, `strict-origin-when-cross-origin`, and a CSP with `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`.
- **Injection**:
  - Queries use parameters only.
  - No eval, no pickle, no shell commands.
  - Outbound calls go only to Hunter's fixed address.
  - Reply text is always rendered as text.
  - There's no AI feature, so prompt injection doesn't apply. If you add one, treat replies, profiles and Hunter data as untrusted input.

### 7.10 Landing page (`app/page.tsx`, `components/landing/*`)
- **Hero**:
  - The left side has the headline "**Pop** into their inbox" ("Pop" in crimson), "From cold email to coffee chat", the description, and Get started.
  - The right side is `HeroVisual`: a 7:5 canvas with one tilted popsicle, three email cards (Sent / Replied / Booked), dashed SVG arrows (viewBox 1000×714 matching the canvas), and the envelope.
  - Positions are percentages taken from his mockup. If you move something, keep the arrows' viewBox coordinates in sync.
- **How it works** (`HowItWorks.tsx`):
  - Scroll-driven light trails: Hunter and Gmail particles fan in, merge at step 1, and run down a trunk.
  - Progress follows a "reading line" 62% down the viewport.
  - Side strands bulge at most 0.75 × bow, so they stay behind the step circles.
- **Feature cards** (`FeatureBeams.tsx`):
  - All 6 appear together when the section comes into view.
  - Then a particle zigzags through them once (~4 s): row 1 left→right, down the right column, row 2 right→left, and so on.
- **Shared code**: `landing/beams.ts` (pure geometry, unit-tested). Both trails show everything lit under reduced motion.
- **Removed on purpose**: the Hunter badge and the "Cold email, simplified" eyebrow. Don't add them back.

---

## 8. Gotchas that have already bitten

- **Stale dev server after mass class renames.** Rewriting files in place (e.g. `perl -pi`) can leave the running `next dev` with a stale Tailwind class list, so new classes have no CSS. A fresh build is fine. Fix: he restarts the frontend dev server (ask him); don't kill it yourself.
- **`next build` with a custom `NEXT_DIST_DIR`** adds lines to `frontend/tsconfig.json` `include`. Revert that change; don't commit it.
- **npm lock file**: CI uses npm 11.19. Regenerate the lock with `npx -y npm@11.19.0 install --package-lock-only`, then verify with `npm ci` in a clean copy. The local npm (11.6) produced an incomplete lock that broke CI.
- **Python dependencies are pinned** in `backend/requirements.txt` to the tested versions (an unpinned Starlette broke CI). Upgrade deliberately, then run the tests.
- **`npm run typecheck`** runs `next typegen` first. Plain `tsc` fails in a clean checkout (`LayoutProps`).
- **zsh** doesn't word-split `$VAR` into arguments. Use `xargs` or arrays when passing file lists.
- **macOS** has no `timeout` command.
- **Prettier at default width** reformats unrelated lines. Avoid running it on whole files; if you must, use `--print-width 140` and check the diff.
- **React hydration resets `<html>` attributes** set before React starts. That's why the theme is re-applied by `ThemeSync` and the layout uses `suppressHydrationWarning`.
- **jsdom** has no SVG geometry or layout.
- **Background threads in tests**: patch `_wait`/sleep, and use `threading.Event`, not `SystemExit`, to stop loops.
- **FastAPI route order matters**: register `/sync` before `/{contact_id}`.
- **Running the backend tests while his backend is up** is fine: tests use the `_test` database and their own settings.
- **Earlier miscounts**: report exact test numbers from the actual run output.

---

## 9. Future goals and open items

1. **Deploy**:
   - **Plan:** Vercel for the frontend (free `*.vercel.app`) and Railway for the backend and Postgres (the backend must be always-on and run **one** process, because of the threads; see `README.md` → Deploying for every setting).
   - **Backend env:** `DATABASE_URL`, `FRONTEND_URL`, `BACKEND_URL` (both the Vercel address), `TOKEN_ENCRYPTION_KEY`, `PROXY_SECRET`, `HUNTER_API_KEY`, `GOOGLE_CLIENT_SECRETS`.
   - **Frontend env:** `BACKEND_ORIGIN`, `PROXY_SECRET`, and an empty `NEXT_PUBLIC_API_URL`.
   - **Also:** add the Vercel callback URL to the Google OAuth client, copy his local data across, and create his account with `manage.py`.
   - **Before deploying, check** whether Vercel's forwarding caps request bodies, which matters for attachments up to 20 MB.
2. **Scheduling links** (after deploy): a per-person tokenized booking page where the recipient picks a time from his free slots (Google Calendar free/busy, likely one more scope), with no login. On booking, create the Meet via the existing `meetings.schedule`.
3. **Multi-user** (only if others get accounts): scope all data and the Gmail connection per user; add invite tokens to sign-up.
4. **Small follow-ups he was offered but hasn't asked for yet**:
   - The role presets in Compose's quick Find people modal.
   - Rename the Meet modal's "Title" to "Calendar event title" and show the email subject.
   - Optionally make credit estimates assume the worst case (1 credit per email).
   - Persist login-attempt counts across restarts.
5. **Dark mode polish**: in dark mode the feature cards' dark/light checkerboard has low contrast.
6. **Migrations**: if schema changes get more involved, switch from `migrations.COLUMNS` to Alembic.

---

## 10. Working with Umer

- **How he writes:** quickly, with typos. Read for intent. He often sends a screenshot or a mockup; match it closely and show screenshots of the result.
- **What he values:** seeing it work in the actual app, plain-language explanations, honest status (what passed, what didn't, what he must do), and granular commits merged to `main`.
- **When he stops you mid-task:** stop and ask how he wants to proceed; don't retry the same action.
- **Before anything that touches the real Gmail, the real database (writes), deploys or money (Hunter credits beyond a normal search):** explain and ask first.
