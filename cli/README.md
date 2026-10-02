# cold-emailer

Send one templated email to many people through your Gmail account.

## One-time setup

1. **Install dependencies**
   ```sh
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Create Gmail API credentials** (about 5 minutes)
   1. Go to https://console.cloud.google.com/ and create a project (any name).
   2. Go to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
   3. Go to **APIs & Services → OAuth consent screen**. Choose **External**, fill in the app name and your email, and add your Gmail address under **Test users**.
   4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**, choose **Desktop app**, and download the JSON.
   5. Save that file in this folder as `credentials.json`.

   The first time you run with `--send`, a browser window opens so you can sign in. After that, the login is saved in `token.json`.

   > While the app is in "Testing" mode, Google expires the saved login after 7 days. When that happens, delete `token.json` and sign in again.

## Usage

1. Edit `template.txt`. The first line is the subject, then a blank line, then the body. Use `{placeholders}` for anything that changes per person.
2. Make a CSV for the company (see `contacts.example.csv`). It needs an `email` column. `full_name` is split into `{first_name}` and `{last_name}` automatically. Every other column becomes a placeholder too (`{role}`, `{team}`, …).
3. Preview (sends nothing):
   ```sh
   python send.py stripe.csv --var company=Stripe
   ```
4. Send:
   ```sh
   python send.py stripe.csv --var company=Stripe --attach resume.pdf --send
   ```

### Options

| Flag | What it does |
|---|---|
| `-t FILE` | Use a different template (default `template.txt`) |
| `--var key=value` | A value shared by everyone, like the company name. A CSV column with the same name overrides it. Can be repeated. |
| `--attach FILE` | Attach a file. Can be repeated. |
| `--delay N` | Average seconds between emails (default 30, randomized ±50%) |
| `--from "Name <you@gmail.com>"` | Set the display name on the From line |
| `--send` | Actually send. Without it, the emails are only printed. |
| `--resend` | Email people already listed in `sent_log.csv` |

### Safety

- If any placeholder has no value for any contact, the script stops before sending anything.
- Every sent email is logged to `sent_log.csv`. Anyone in that log is skipped next time, so re-running after a crash won't email people twice.
- Sent emails show up in your Gmail **Sent** folder like normal emails.
- To write a literal `{` or `}` in the template, type `{{` or `}}`.
