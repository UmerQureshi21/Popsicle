"""Syncing conversations from Gmail (faked with tests.fake_gmail) and reading message text."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app import conversations as conv
from app.conversations import _wait as real_wait  # before the sync_waits fixture replaces it
from app.db import SessionLocal
from app.models import ConversationMessage, GmailAccount, MailThread
from tests import factories as f
from tests.fake_gmail import FakeGmail, b64, message

ME = "me@gmail.com"


def at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 10, day, hour, tzinfo=timezone.utc)


class TestMessageText:
    def test_plain_text_preferred(self):
        payload = {"mimeType": "multipart/alternative", "parts": [
            {"mimeType": "text/html", "body": {"data": b64("<p>Hi</p>")}},
            {"mimeType": "text/plain", "body": {"data": b64("Hi there\r\n")}},
        ]}
        assert conv.message_text(payload) == "Hi there"

    def test_nested_parts(self):
        payload = {"mimeType": "multipart/mixed", "parts": [
            {"mimeType": "multipart/alternative", "parts": [{"mimeType": "text/plain", "body": {"data": b64("Deep")}}]},
            {"mimeType": "application/pdf", "body": {"attachmentId": "x"}},
        ]}
        assert conv.message_text(payload) == "Deep"

    def test_html_only_becomes_text(self):
        markup = "<style>p{}</style><div>Sounds good &amp; see you<br>Tuesday</div><p>Douglas</p>"
        payload = {"mimeType": "text/html", "body": {"data": b64(markup)}}
        assert conv.message_text(payload) == "Sounds good & see you\nTuesday\nDouglas"

    def test_self_closing_breaks_and_hidden_blocks(self):
        markup = "Hi<br/>there<style>p{color:red}</style><script>alert('x')</script></h2><p>Next</p>"
        assert conv._html_to_text(markup) == "Hi\nthere\nNext"

    @pytest.mark.parametrize(
        "hostile",
        ["<script" * 20_000, "<" * 2_000_000, "<br>" * 100_000, "<a " * 100_000],
    )
    def test_hostile_html_from_a_stranger_is_quick(self, hostile):
        """These took 7-13+ seconds (growing with size) with the old regexes."""
        import time

        start = time.perf_counter()
        conv._html_to_text(hostile)
        assert time.perf_counter() - start < 1.0

    def test_huge_bodies_are_cut_short(self):
        assert len(conv._html_to_text("x" * (conv.MAX_BODY_CHARS * 3))) == conv.MAX_BODY_CHARS
        payload = {"mimeType": "text/plain", "body": {"data": b64("y" * (conv.MAX_BODY_CHARS + 10))}}
        assert len(conv.message_text(payload)) == conv.MAX_BODY_CHARS

    def test_no_body(self):
        assert conv.message_text({"mimeType": "multipart/mixed", "parts": []}) == ""


class TestStripQuoted:
    def test_gmail_quote_even_when_wrapped(self):
        text = "Coffee on Tuesday works!\n\nOn Mon, Oct 6, 2026 at 9:00 AM Umer Qureshi <\nme@gmail.com> wrote:\n> Hi Douglas"
        assert conv.strip_quoted(text) == "Coffee on Tuesday works!"

    def test_outlook_quotes(self):
        assert conv.strip_quoted("Sure.\n-----Original Message-----\nFrom: me") == "Sure."
        assert conv.strip_quoted("Sure.\nFrom: Umer <me@gmail.com>\nSent: Monday\nHi") == "Sure."

    def test_quoted_lines_dropped(self):
        assert conv.strip_quoted("> old\nNew\n>> older") == "New"

    def test_ordinary_text_kept(self):
        text = "On Tuesday I'm free.\nThanks for reaching out"
        assert conv.strip_quoted(text) == text


@pytest.fixture
def account(db):
    acct = GmailAccount(email=ME, token_json="{}")
    db.add(acct)
    db.commit()
    return acct


def emailed(db, address, name=None, company=None):
    contact = f.contact(db, email=address, full_name=name, company=company)
    f.sent_email(db, address, at(1), contact=contact)
    return contact


def stored(db):
    return [
        (m.contact_id, m.gmail_message_id, m.from_me, m.from_addr, m.body)
        for m in db.scalars(select(ConversationMessage).order_by(ConversationMessage.sent_at, ConversationMessage.id))
    ]


class TestSync:
    def test_copies_both_sides_of_each_conversation(self, db, account):
        harvey = f.company(db, name="Harvey", status="emailed")
        douglas = emailed(db, "douglas@harvey.ai", "Douglas Quan", company=harvey)
        f.contact(db, email="never@x.com")  # not emailed: not synced
        gmail = FakeGmail({
            "t1": [
                message("m1", f"Me <{ME}>", "Douglas Quan <douglas@harvey.ai>", "Hi Douglas", at=at(1), sent=True),
                message("m2", "Douglas Quan <Douglas@Harvey.ai>", ME, "Happy to chat!\n\nOn Wed wrote:\n> Hi", at=at(2)),
            ],
            "t2": [message("m3", "never@x.com", ME, "Spam")],
        })

        result = conv.sync(db, gmail, account)

        assert (result.threads_checked, result.threads_downloaded, result.new_messages) == (1, 1, 2)
        assert stored(db) == [
            (douglas.id, "m1", True, ME, "Hi Douglas"),
            (douglas.id, "m2", False, "douglas@harvey.ai", "Happy to chat!\n\nOn Wed wrote:\n> Hi"),
        ]
        m2 = db.scalars(select(ConversationMessage).where(ConversationMessage.gmail_message_id == "m2")).one()
        assert (m2.from_name, m2.rfc_message_id, m2.gmail_thread_id, m2.sent_at) == ("Douglas Quan", "<m2@mail.gmail.com>", "t1", at(2))
        assert gmail.searches == ['from:("douglas@harvey.ai") OR to:("douglas@harvey.ai") OR cc:("douglas@harvey.ai")']
        db.refresh(harvey)
        assert harvey.status == "replied"

    def test_a_message_from_my_address_counts_as_mine_without_the_sent_label(self, db, account):
        emailed(db, "jane@stripe.com")
        conv.sync(db, FakeGmail({"t1": [message("m1", ME, "jane@stripe.com")]}), account)
        assert stored(db)[0][2] is True

    def test_unsent_drafts_are_skipped(self, db, account):
        jane = emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [
            message("m1", ME, "jane@stripe.com", "Hi Jane", sent=True),
            message("m2", ME, "jane@stripe.com", "Following up...", at=at(3), draft=True),
        ]})
        assert conv.sync(db, gmail, account).new_messages == 1
        assert stored(db) == [(jane.id, "m1", True, ME, "Hi Jane")]

    def test_a_draft_copied_before_drafts_were_skipped_is_removed_by_checking_labels_only(self, db, account):
        jane = emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [
            message("m1", ME, "jane@stripe.com", "Hi Jane", sent=True),
            message("m2", ME, "jane@stripe.com", "Following up...", at=at(3), draft=True),
        ]})
        # As an earlier version left it: the draft copied, the thread marked as synced.
        for mid, body, when in (("m1", "Hi Jane", at(1)), ("m2", "Following up...", at(3))):
            db.add(ConversationMessage(
                contact_id=jane.id, gmail_message_id=mid, gmail_thread_id="t1", from_me=True, from_addr=ME,
                to_addrs="jane@stripe.com", subject="Quick question", snippet="", body=body, sent_at=when,
            ))
        db.add(MailThread(gmail_thread_id="t1", history_id="1", skips_drafts=False))
        db.commit()

        result = conv.sync(db, gmail, account)

        assert (result.threads_downloaded, result.new_messages) == (0, 0)
        assert gmail.downloads == ["t1 (minimal)"]
        assert stored(db) == [(jane.id, "m1", True, ME, "Hi Jane")]
        assert db.get(MailThread, "t1").skips_drafts is True
        conv.sync(db, gmail, account)
        assert gmail.downloads == ["t1 (minimal)"]

    def test_a_changed_thread_synced_before_drafts_were_skipped_is_downloaded_in_full(self, db, account):
        emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", sent=True)]})
        db.add(MailThread(gmail_thread_id="t1", history_id="0", skips_drafts=False))
        db.commit()
        assert conv.sync(db, gmail, account).new_messages == 1
        assert db.get(MailThread, "t1").skips_drafts is True

    def test_a_message_gone_from_the_thread_is_removed(self, db, account):
        emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", sent=True), message("m2", ME, "jane@stripe.com", at=at(3))]})
        conv.sync(db, gmail, account)
        gmail.data["t1"]["messages"].pop()  # e.g. a draft that was deleted or sent
        gmail.add("t1")
        conv.sync(db, gmail, account)
        assert [r[1] for r in stored(db)] == ["m1"]

    def test_unchanged_threads_are_not_downloaded_again(self, db, account):
        emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", sent=True)]})
        conv.sync(db, gmail, account)
        assert conv.sync(db, gmail, account).threads_downloaded == 0

        gmail.add("t1", message("m2", "jane@stripe.com", ME, "Yes!", at=at(3)))
        result = conv.sync(db, gmail, account)
        assert (result.threads_downloaded, result.new_messages) == (1, 1)
        assert gmail.downloads == ["t1", "t1"]
        assert db.get(MailThread, "t1").history_id == "2"

    def test_a_status_you_set_isnt_overwritten_by_a_reply(self, db, account):
        meta = f.company(db, name="Meta", status="not_interested")
        emailed(db, "sam@meta.com", company=meta)
        conv.sync(db, FakeGmail({"t1": [message("m1", "sam@meta.com", ME, "No thanks")]}), account)
        db.refresh(meta)
        assert meta.status == "not_interested"

    def test_a_not_started_company_becomes_replied(self, db, account):
        acme = f.company(db, name="Acme")
        emailed(db, "ann@acme.com", company=acme)
        conv.sync(db, FakeGmail({"t1": [message("m1", "ann@acme.com", ME, "Hi")]}), account)
        db.refresh(acme)
        assert acme.status == "replied"

    def test_a_thread_with_two_people_is_shown_to_both(self, db, account):
        jane = emailed(db, "jane@stripe.com")
        sam = emailed(db, "sam@stripe.com")
        conv.sync(db, FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", cc="sam@stripe.com", sent=True)]}), account)
        assert sorted(r[0] for r in stored(db)) == sorted([jane.id, sam.id])

    def test_many_people_are_searched_a_few_at_a_time_and_threads_counted_once(self, db, account, monkeypatch):
        monkeypatch.setattr(conv, "ADDRESSES_PER_SEARCH", 1)
        emailed(db, "jane@stripe.com")
        emailed(db, "sam@stripe.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", cc="sam@stripe.com", sent=True)]})
        result = conv.sync(db, gmail, account)
        assert len(gmail.searches) == 2
        assert (result.threads_checked, result.new_messages) == (1, 2)

    def test_follows_pages_of_search_results_up_to_a_limit(self, db, account, monkeypatch):
        emailed(db, "jane@stripe.com")
        gmail = FakeGmail({f"t{i}": [message(f"m{i}", ME, "jane@stripe.com", sent=True)] for i in range(5)}, page_size=2)
        assert conv.sync(db, gmail, account).threads_checked == 5

        monkeypatch.setattr(conv, "MAX_THREADS_PER_SEARCH", 3)
        assert conv.sync(db, gmail, account).threads_checked == 3

    def test_syncing_one_person(self, db, account):
        jane = emailed(db, "jane@stripe.com")
        emailed(db, "sam@stripe.com")
        gmail = FakeGmail({
            "t1": [message("m1", ME, "jane@stripe.com", sent=True)],
            "t2": [message("m2", ME, "sam@stripe.com", sent=True)],
        })
        conv.sync(db, gmail, account, [jane.id])
        assert [r[1] for r in stored(db)] == ["m1"]
        # Not recorded as done, and the account's last full sync isn't changed.
        assert db.get(MailThread, "t1") is None
        assert account.synced_at is None
        assert conv.sync(db, gmail, account, [jane.id]).new_messages == 0



def rate_limited(status=429):
    from googleapiclient.errors import HttpError

    resp = type("Resp", (), {"status": status, "reason": "Too Many Requests"})()
    return HttpError(resp, b'{"error": {"message": "Quota exceeded for quota metric \'Total Query Cost\'"}}')


class TestPacing:
    def test_an_ordinary_sync_doesnt_wait(self, db, account, sync_waits):
        emailed(db, "jane@stripe.com")
        conv.sync(db, FakeGmail({f"t{i}": [message(f"m{i}", ME, "jane@stripe.com", sent=True)] for i in range(5)}), account)
        assert sync_waits == []

    def test_a_big_sync_slows_down_to_stay_under_gmails_limit(self, db, account, sync_waits):
        emailed(db, "jane@stripe.com")
        threads = 50
        conv.sync(db, FakeGmail({f"t{i}": [message(f"m{i}", ME, "jane@stripe.com", sent=True)] for i in range(threads)}), account)
        # The burst covers the search and 9 threads; the other 41 wait their turn.
        assert len(sync_waits) == threads - 9
        assert sync_waits[-1] == pytest.approx(conv.COST_THREAD * 60 / conv.UNITS_PER_MINUTE, rel=0.05)

    def test_no_minute_ever_goes_over_gmails_limit(self, monkeypatch):
        clock, spent = [0.0], []
        monkeypatch.setattr(conv, "_wait", lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        pace = conv.Pace(clock=lambda: clock[0])
        for i in range(500):
            cost = conv.COST_SEARCH if i % 10 == 0 else conv.COST_THREAD
            pace.spend(cost)
            spent.append((clock[0], cost))
            clock[0] += 0.05  # each request takes a moment
        busiest = max(sum(c for t, c in spent if start <= t < start + 60) for start, _ in spent)
        assert 5000 < busiest < 6000  # close to the limit, never over it

    def test_waiting_really_sleeps(self, monkeypatch):
        slept = []
        monkeypatch.setattr(conv.time, "sleep", slept.append)
        real_wait(1.5)
        assert slept == [1.5]

    def test_units_come_back_with_time(self, monkeypatch, sync_waits):
        clock = [0.0]
        pace = conv.Pace(clock=lambda: clock[0])
        pace.spend(conv.BURST_UNITS)
        clock[0] += 60 * conv.COST_THREAD / conv.UNITS_PER_MINUTE  # exactly enough for one thread
        pace.spend(conv.COST_THREAD)
        assert sync_waits == []
        pace.spend(conv.BURST_UNITS)  # more than ever builds up: waits for the rest
        assert sync_waits == [pytest.approx(conv.BURST_UNITS * 60 / conv.UNITS_PER_MINUTE)]

    @pytest.mark.parametrize("error", [rate_limited(429), rate_limited(403)])
    def test_when_gmail_says_slow_down_it_waits_and_tries_again(self, db, account, sync_waits, error):
        emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", sent=True)]})
        gmail.fail_next = [error, error]
        assert conv.sync(db, gmail, account).new_messages == 1
        assert [round(w) for w in sync_waits] in ([2, 4], [3, 4], [2, 5], [3, 5])

    def test_gives_up_after_a_few_tries(self, db, account, monkeypatch, sync_waits):
        monkeypatch.setattr(conv, "RATE_LIMIT_RETRIES", 2)
        emailed(db, "jane@stripe.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "jane@stripe.com", sent=True)]})
        gmail.fail_next = [rate_limited()] * 3
        with pytest.raises(Exception, match="Quota exceeded"):
            conv.sync(db, gmail, account)
        assert len(sync_waits) == 2

    def test_other_errors_arent_retried(self, db, account, sync_waits):
        from googleapiclient.errors import HttpError

        emailed(db, "jane@stripe.com")
        gmail = FakeGmail()
        gmail.fail_next = [HttpError(type("Resp", (), {"status": 500, "reason": "Oops"})(), b"Oops")]
        with pytest.raises(HttpError):
            conv.sync(db, gmail, account)
        assert sync_waits == []

    def test_progress_is_saved_as_it_goes_and_keeps_the_claim_fresh(self, db, account, monkeypatch):
        monkeypatch.setattr(conv, "ADDRESSES_PER_SEARCH", 2)
        for i in range(3):
            emailed(db, f"p{i}@x.com")
        gmail = FakeGmail({"t1": [message("m1", ME, "p0@x.com", sent=True)]})
        seen = []
        real_search = conv._search

        def search(service, pace, query):
            db.refresh(account)
            seen.append((account.sync_result or {}).get("people_checked"))
            return real_search(service, pace, query)

        monkeypatch.setattr(conv, "_search", search)
        conv.claim_sync(db, account)
        account.sync_started_at = conv.now() - conv.SYNC_STALE / 2
        db.commit()
        conv.sync(db, gmail, account)
        assert seen == [None, 2]
        assert account.sync_result["people_checked"] == account.sync_result["people_total"] == 3
        assert account.sync_started_at > conv.now() - conv.timedelta(seconds=30)


class TestSyncClaim:
    """One sync at a time, across every server process, claimed on the account's row."""

    def test_only_one_at_a_time(self, db, account):
        assert conv.claim_sync(db, account)
        assert conv.sync_running(account)
        with SessionLocal() as other:  # another process
            assert not conv.claim_sync(other, other.get(GmailAccount, account.id))

    def test_a_claim_left_by_a_dead_process_can_be_taken_over(self, db, account):
        account.sync_started_at = conv.now() - conv.SYNC_STALE - timedelta(seconds=1)
        db.commit()
        assert not conv.sync_running(account)
        assert conv.claim_sync(db, account)

    def test_finishing_records_how_it_went(self, db, account):
        conv.claim_sync(db, account)
        conv.finish_sync(db, account, conv.SyncResult(threads_checked=3, threads_downloaded=1, new_messages=2))
        assert not conv.sync_running(account)
        assert account.sync_result == {
            "threads_checked": 3, "threads_downloaded": 1, "new_messages": 2, "people_checked": 0, "people_total": 0, "error": None,
        }
        assert account.synced_at is not None

    def test_a_failure_is_recorded_without_moving_the_last_sync_time(self, db, account):
        conv.claim_sync(db, account)
        conv.finish_sync(db, account, None, "Gmail error: Backend Error")
        assert account.sync_result["error"] == "Gmail error: Backend Error"
        assert account.synced_at is None
        assert conv.claim_sync(db, account)  # free again


def test_people_emailed(db):
    jane = emailed(db, "Jane@Stripe.com")
    f.contact(db, email="never@x.com")
    assert conv.people_emailed(db) == {"jane@stripe.com": jane}
    assert conv.people_emailed(db, [jane.id + 100]) == {}

