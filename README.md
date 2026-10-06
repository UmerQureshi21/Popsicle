# Popsicle

<img src="frontend/public/cold-emailer-logo.png" alt="Popsicle logo" width="96">

Write one email template, paste in a list of people, and send each person a personalized copy from your Gmail. Sent emails, contacts and companies are stored in Postgres, so the app knows who you've already emailed.

| Part | Stack | Location |
|---|---|---|
| UI | Next.js 16 (App Router, Tailwind 4) | `frontend/` |
| API | FastAPI + SQLAlchemy 2 | `backend/` |
| Database | Postgres 14, port 5442 | `~/Desktop/personal-projects/psqlConnections/cold-emailer-5442` |
| Old CLI version | Python script | `cli/` |

## Running it

```sh
./dev.sh
```

This starts Postgres if it isn't running, then the API on :8000 and the UI on http://localhost:3000 (landing page; the app itself is at `/compose`).

To start Postgres yourself instead, follow the same steps as your other clusters:

```sh
cd ~/Desktop/personal-projects/psqlConnections/cold-emailer-5442
pg_ctl -D ./pgdata -o "-p 5442" -l logfile start
psql -p 5442 -d cold_emailer
```

### First-time setup

```sh
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ../frontend && npm install
```

Tables are created automatically when the API starts.

### Connecting Gmail (once)

1. Go to https://console.cloud.google.com/ and create a project.
2. Go to **APIs & Services → Library**, then enable the **Gmail API** and the **Google Calendar API** (the Inbox tab uses Calendar to make Google Meet links).
3. Go to **OAuth consent screen**, choose **External**, and add your Gmail address under **Test users**.
4. Go to **Credentials → Create credentials → OAuth client ID**:
   - **Type:** Web application
   - **Authorized redirect URI:** `http://localhost:8000/api/gmail/callback`
5. Download the JSON and save it as `backend/credentials.json`.
6. In the app, click **Connect Gmail** in the compose card.

When connecting, tick every box on Google's screen:
- **Send email on your behalf:** needed to send batches.
- **Read your email:** lets the Inbox tab show replies. Popsicle only reads mail to and from people you've emailed.
- **See and edit events on your calendars:** lets the Inbox tab create Google Meet links.

Connected before the Inbox existed? The Inbox tab shows a **Reconnect Gmail** button. Click it once to grant the two new permissions.

While the Google app is in "Testing" mode, Google expires the login after 7 days. When that happens, click Connect Gmail again.

### Connecting Hunter.io (once, for Find people)

1. Copy your API key from https://hunter.io/api-keys.
2. Add it to `backend/.env` (create the file if it doesn't exist; git ignores it):
   ```
   HUNTER_API_KEY=your-key
   ```
3. Restart `./dev.sh`.

The free plan has 50 credits a month. Per [Hunter's credit rules](https://help.hunter.io/en/articles/1911617-how-do-credits-work-in-hunter):

- **Company search:** 1 credit per 10 people found, so up to 10 people costs 1 credit and up to 25 costs up to 3.
- **Nothing found:** free.
- **Repeating a search** in the same month: free.
- **Looking up one person:** 1 credit, only if their email is found.

Your remaining credits show in the top nav and update after every search.

### Accounts and login

Popsicle is invite-only. Accounts are created from the terminal, never from the website. From the `backend/` folder:

```sh
.venv/bin/python -m app.manage create-user you@example.com   # asks for a password (typed twice, not shown)
.venv/bin/python -m app.manage list-users
.venv/bin/python -m app.manage set-password you@example.com
.venv/bin/python -m app.manage delete-user someone@example.com
.venv/bin/python -m app.manage invite friend@example.com     # optional: they choose their own password via Sign up
```

- **Locally**, anyone can use the app without logging in (`AUTH_REQUIRED=false`, the default). The login page still works if you want to try it.
- **When deployed**, set `AUTH_REQUIRED=true` in `backend/.env`. Every page and API call then requires logging in, so only accounts you've created can get in. Serve the site over https and also set `COOKIE_SECURE=true`.
- **Sign up** never creates an account. It only lets an *invited* email choose a password; anyone else is told Popsicle is invite-only.
- **Security:** passwords are stored hashed (scrypt). Sessions last 30 days in a cookie that JavaScript can't read. Five wrong passwords lock that email out for 15 minutes.

## Using it

1. **Company:** type the company name. It becomes `{{company}}`.
2. **Recipients:** open the recipients table. Each column is a variable (`full_name` and `email` to start; `email` is required). Add a column with **+ variable** and remove one with its ×.
3. **Fill the table:** one row per person.
   - Cells wrap their text and grow taller, so a whole paragraph is readable at once.
   - Enter moves to the same column in the next row, adding a row if needed. Shift+Enter starts a new line inside a cell.
   - You can paste rows copied from a spreadsheet into a cell; they fill the table from that cell. Pasted text with line breaks but no tabs, such as a paragraph, stays in that one cell.
   - Blank rows are ignored, and rows with a missing or invalid email are flagged.
4. **Template:** write the subject and body. Click a variable in the dark toolbar to insert `{{variable}}` at the cursor. Valid placeholders show in red; ones that don't match a variable get a wavy underline.
   - If you have a `full_name` variable, `{{first_name}}` and `{{last_name}}` are filled in automatically.
5. **Send:** you get a per-person preview first. Then emails go out one at a time, about 30 seconds apart (adjust with the clock icon). You can stop a batch partway through.
6. **Or schedule it:** **Schedule** on the review screen sends the batch later instead. Pick **Tomorrow 9:00 AM**, next Tuesday or Thursday at 9:00 AM, or any time up to 60 days ahead, in your own timezone. Morning emails get read and answered more.
   - A scheduled batch shows **scheduled** on the Sent page with the time it sends. Open it to **Send now** or **Cancel**.
   - It sends by itself even if the page is closed, and after a backend restart, as long as the backend is running at that time. The daily limit still applies.

Your draft is saved in the browser, so a refresh doesn't lose it.

### Saving templates

The bar at the top of the email editor shows which template you're working on. A red dot marks unsaved changes ("Edited" for a saved template, "Not saved" for a new draft).

- **Save draft:** names an untitled draft (e.g. "Learning more about the industry") and saves it to the database.
- **Save:** updates the saved template you're editing. **Save as new** keeps the original and saves your version under a new name.
- **Switch:** the dropdown lists your saved templates. Pick one to load it, or choose **New blank draft** to start fresh. Each template can be deleted from the dropdown.
- **Unsaved changes:** if switching would lose your edits, Popsicle asks whether to save them first, discard them, or keep editing.

A template stores the subject and body. Loading one adds any variables it uses as columns in the recipients table, without removing yours.

### Finding people

Open the **Find people** tab:

1. **Companies:** start typing a name and pick the company from the suggestions (logo, domain, and how many people Hunter has, biggest first). Picking one searches that exact domain, so "Harvey" means harvey.ai and not harvey.net. You can also type a name or domain and press Enter, or paste several at once.
2. **Job title:** defaults to `software engineer`, at any seniority. Separate several titles with commas.
3. **Location:** defaults to **Greater Toronto Area**: people based in Toronto or the surrounding Peel, York, Halton and Durham cities. You can also choose anywhere in Canada, or anywhere. This filters on where each person lives and works, not the company's HQ.
4. **People per company:** choose how many to fetch, then click **Search**.
5. **Pick people:** results appear per company. Each person shows their title, Hunter's confidence in the email, and whether you've already emailed them; people already emailed start unticked.
6. **Email them:** click **Email N people** on a company. Compose opens with those people as recipients, the company filled in, and a `role` column from their job titles.

There's also a quicker **Find people** button inside Compose that searches one company and adds people to the current batch. Its **Look them up** section finds a single person's email from their name or LinkedIn URL.

Results are saved for 30 days, so repeating a search costs nothing. Use **refresh** on saved results to search Hunter again.

If a company search finds no one, Popsicle checks (for free) how many people Hunter has there in total and tells you whether the filters are the reason. It then offers one-click **Search anywhere** or **Remove the job title** retries.

### Your target companies

The **Companies** tab is your list of companies to reach, with each one's logo (from Hunter, free).

- **Add companies:** type a name and pick it from the suggestions, or paste a whole list (one per line or comma-separated). Names and domains both work. Hunter's free company suggestions fill in the domain for an exact name match, or the name for a domain. Companies already on the list are skipped.
- **Missing logos:** a company with no domain shows a placeholder. **Find N missing logos** asks Hunter (free) for the domains of up to 30 at a time. Names Hunter doesn't recognise exactly are left for you to fill in, so a wrong company is never guessed.
- **Status:** each company is **Not started**, **Emailed**, **Replied** or **Not a fit**. It moves to Emailed by itself when the first email to it is sent; change it from the card any time. The filters at the top show how many are in each.
- **Find people at several companies:** tick companies (e.g. under **Not started**) and click **Find people at N companies**. Find people opens with them filled in, keeping your job title and location.
- **Contacts:** click a company's name to see everyone you have there.

### Inbox: replies and Google Meet

The **Inbox** tab lists everyone you've emailed. Open someone to see the whole conversation with them, your emails and their replies, in order.

- **Replies:** Popsicle checks Gmail for new replies when you open the tab, and when you click the refresh icon. It reads only mail to or from people you've emailed, and only downloads conversations that changed since the last check. Quoted earlier messages are hidden so each reply is easy to read.
- **Filters:** **Replied** or **No reply yet**, plus search by name, email or company. A red dot marks people who replied.
- **Company status:** when someone replies, their company moves to **Replied** on the Companies tab, unless you set its status yourself.
- **Send Meet link:** pick a date, time and length (in your timezone), and edit the email if you like. `{{meet_link}}` becomes the link. Popsicle creates a Google Calendar event with a Google Meet link, then emails it as a reply in your conversation. By default they also get a Google Calendar invite; untick that to send only the email. Meetings show at the top of the conversation with the link, a copy button and a link to the calendar event.
- **Replying in your own words:** use **Reply in Gmail** at the bottom of a conversation.

### Looking up one person

The **Look up** tab finds a single person's email. Either paste their **LinkedIn profile URL** on its own (Hunter works out who they are and where they work), or enter their **full name plus their company or website domain**.

- **Works beyond Hunter's lists:** it works out the company's email pattern, so it finds people at companies Hunter has no people for. A website domain like `tiny-startup.io` is the most reliable input.
- **Results:** the email, Hunter's confidence, whether it's verified, and their title if known.
- **What you can do with a result:** **Copy** it, **Email them** (Compose opens with just them), or **Add to batch** (they join the recipients you're already writing to).
- **Cost:** 1 credit if an email is found. It's free if not, or if you've looked them up before.

Recent lookups stay on the page so you can come back to them.

## Testing

None of the tests reach Hunter or Gmail: Hunter calls and sends are faked, so no credits are spent and no email goes out. Each suite fails if coverage drops below 90%. GitHub Actions runs all of them on every push (`.github/workflows/test.yml`).

**Backend** (pytest). The tests use a `cold_emailer_test` database on the 5442 cluster, which they create at the start and drop at the end, so your real data is never touched. Postgres must be running.

```sh
cd backend
.venv/bin/pip install -r requirements-dev.txt   # once
.venv/bin/pytest
```

To use another server, set `TEST_DATABASE_URL`. Its database name must end in `_test`.

**Old CLI:** `cd cli && ../backend/.venv/bin/pytest`

**Frontend** (Vitest and React Testing Library). The backend is faked at the network level.

```sh
cd frontend
npm test                # watch mode
npm run test:coverage   # one run, with the coverage report
```

**End-to-end** (Playwright). Real browser runs of logging in, Find people, Look up and sending. The app is built into `frontend/.next-e2e` and talks to a fake API inside the browser, so it can run while `./dev.sh` is up.

```sh
cd frontend
npx playwright install chromium   # once
npm run test:e2e
```

### Protecting your Gmail account

Gmail flags accounts that suddenly send a lot, or whose emails bounce, and starts putting their mail in spam. Popsicle guards against both.

**Daily send limit**

- **The limit:** at most **40 emails per rolling 24 hours** by default, and always at least **20 seconds** between emails. Each batch's own randomised spacing comes on top of that.
- **When a batch reaches the limit,** it shows **waiting for daily limit** and carries on by itself once there's room again, even after a restart. You can still stop it.
- **Before you send,** the review screen tells you how many emails go out now and when the rest will follow.
- **To check or change the limit,** use the **Sending safety** card on the Sent page. 30–50 a day is a safe range for cold email.

**Checking addresses exist**

- **Verify N** on the review screen checks unchecked recipients with Hunter's Email Verifier. It uses your monthly Hunter verifications, and the screen shows how many you have left.
- **Each recipient gets a badge:**
  - **verified**
  - **risky:** the company accepts any address, or Hunter couldn't tell. Risky addresses are still sent.
  - **doesn't exist:** skipped automatically, so they never bounce.
- **Results are kept for 30 days,** so checking the same address again is free.

## Data model

```
companies 1─* contacts 1─* emails *─1 campaigns *─* attachments
                                       campaigns *─1 templates
gmail_accounts (the connected sender)
hunter_lookups (cached Hunter.io responses)
users, auth_sessions (invite-only accounts and their login sessions)
sending_settings (daily limit and minimum gap), email_verifications (Hunter verdicts, kept 30 days)
conversation_messages, mail_threads (Gmail conversations with people emailed), meetings (Google Meet calls set up)
```

- **campaigns:** one batch, e.g. "Stripe, 10 people". It keeps a copy of the exact subject and body used, so editing a template later doesn't change history.
- **emails:** one row per person per batch. It stores the rendered text, the variable values used, the status (`pending/sent/failed/skipped/cancelled`) and the Gmail message ID.
- **companies:** unique by name, with a `status` (`not_started/emailed/replied/not_interested`) for the target list.
- **contacts:** unique by email address. They're created or updated from the recipients table (`full_name`, `role`/`title` and `linkedin` are picked up automatically).
- **Already emailed:** someone counts as already emailed if any email to their address has status `sent`. They're skipped by default; you can change this with the person-check icon.

The schema is created with `create_all`. Columns added later (like `campaigns.scheduled_for` and `companies.status`) are added at startup by `app/migrations.py`, which never touches existing data. Switch to Alembic if migrations get more involved.

API docs are at http://localhost:8000/docs.
