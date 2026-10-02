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

The free plan has 50 credits a month, about one per email found. Find people shows how many you have left.

## Using it

1. **Company:** type the company name. It becomes `{{company}}`.
2. **Recipients:** open the recipients table. Each column is a variable (`full_name` and `email` to start; `email` is required). Add a column with **+ variable** and remove one with its ×.
3. **Fill the table:** one row per person.
   - Enter moves to the same column in the next row, adding a row if needed.
   - You can paste rows copied from a spreadsheet into a cell; they fill the table from that cell.
   - Blank rows are ignored, and rows with a missing or invalid email are flagged.
4. **Template:** write the subject and body. Click a variable in the dark toolbar to insert `{{variable}}` at the cursor. Valid placeholders show in red; ones that don't match a variable get a wavy underline.
   - If you have a `full_name` variable, `{{first_name}}` and `{{last_name}}` are filled in automatically.
5. **Send:** you get a per-person preview first. Then emails go out one at a time, about 30 seconds apart (adjust with the clock icon). You can stop a batch partway through.

Your draft is saved in the browser, so a refresh doesn't lose it. Use the template icon to save and load templates.

### Finding people

Click **Find people** next to Recipients:

1. **Search:** type a company name or domain. You can filter by department and seniority and choose how many people to fetch.
2. **Pick people:** each result shows their title, Hunter's confidence in the email, and whether you've already emailed them. People already emailed start unticked.
3. **Add them:** ticked people go into the recipients table. A `role` column is added from their job titles, and Company is filled in if it's empty.
4. **Missing someone?** Use **Look them up** with their name or LinkedIn URL to find a single person's email.

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
