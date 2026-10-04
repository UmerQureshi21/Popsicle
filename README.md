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
2. Go to **APIs & Services → Library**, then enable the **Gmail API**.
3. Go to **OAuth consent screen**, choose **External**, and add your Gmail address under **Test users**.
4. Go to **Credentials → Create credentials → OAuth client ID**:
   - **Type:** Web application
   - **Authorized redirect URI:** `http://localhost:8000/api/gmail/callback`
5. Download the JSON and save it as `backend/credentials.json`.
6. In the app, click **Connect Gmail** in the compose card.

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

Your draft is saved in the browser, so a refresh doesn't lose it. Use the template icon to save and load templates.

### Finding people

Open the **Find people** tab:

1. **Companies:** list them one per line, by name or domain (`stripe.com` is the most accurate).
2. **Job title:** defaults to `software engineer`, at any seniority. Separate several titles with commas.
3. **Location:** defaults to **Greater Toronto Area**: people based in Toronto or the surrounding Peel, York, Halton and Durham cities. You can also choose anywhere in Canada, or anywhere. This filters on where each person lives and works, not the company's HQ.
4. **People per company:** choose how many to fetch, then click **Search**.
5. **Pick people:** results appear per company. Each person shows their title, Hunter's confidence in the email, and whether you've already emailed them; people already emailed start unticked.
6. **Email them:** click **Email N people** on a company. Compose opens with those people as recipients, the company filled in, and a `role` column from their job titles.

There's also a quicker **Find people** button inside Compose that searches one company and adds people to the current batch. Its **Look them up** section finds a single person's email from their name or LinkedIn URL.

Results are saved for 30 days, so repeating a search costs nothing. Use **refresh** on saved results to search Hunter again.

## Data model

```
companies 1─* contacts 1─* emails *─1 campaigns *─* attachments
                                       campaigns *─1 templates
gmail_accounts (the connected sender)
hunter_lookups (cached Hunter.io responses)
```

- **campaigns:** one batch, e.g. "Stripe, 10 people". It keeps a copy of the exact subject and body used, so editing a template later doesn't change history.
- **emails:** one row per person per batch. It stores the rendered text, the variable values used, the status (`pending/sent/failed/skipped/cancelled`) and the Gmail message ID.
- **contacts:** unique by email address. They're created or updated from the recipients table (`full_name`, `role`/`title` and `linkedin` are picked up automatically).
- **Already emailed:** someone counts as already emailed if any email to their address has status `sent`. They're skipped by default; you can change this with the person-check icon.

The schema is created with `create_all` for now. Switch to Alembic once there's data you need to migrate.

API docs are at http://localhost:8000/docs.
