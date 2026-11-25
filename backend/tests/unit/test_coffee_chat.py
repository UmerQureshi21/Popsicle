"""Coffee chat sheets: the PDF made from About me and your notes on someone."""

import re

import pytest

from app import coffee_chat as cc
from tests import factories as f


@pytest.fixture
def readable(monkeypatch):
    """PDFs left uncompressed, so the text can be read back."""
    monkeypatch.setattr(cc, "COMPRESS", False)


def text_of(pdf: bytes) -> str:
    """Every piece of text drawn on the page, in order (fpdf writes them as (text) Tj)."""
    return "|".join(m.decode("latin-1") for m in re.findall(rb"\((.*?)\) ?Tj", pdf))


ABOUT = "Who I am:\n- 3rd year CS student at McMaster\n\nCurrent Projects:\n- Recipes: https://karahi-hub.vercel.app/"
NOTES = "Why I'm reaching out:\n- Scaling systems\n\nWhat I am curious about:\n- How does your team test things?"


class TestRender:
    def test_about_me_then_notes_with_headings_bullets_and_links(self, readable):
        pdf = cc.render(ABOUT, NOTES)
        assert pdf.startswith(b"%PDF")
        text = text_of(pdf)
        order = ["Who I am:", "3rd year CS student", "Current Projects:", "Recipes:", "https://karahi-hub.vercel.app/",
                 "Why I'm reaching out:", "Scaling systems", "What I am curious about:", "How does your team test things?"]
        positions = [text.index(t) for t in order]
        assert positions == sorted(positions)
        assert b"/URI (https://karahi-hub.vercel.app/)" in pdf
        assert b"Helvetica-Bold" in pdf

    def test_notes_without_a_heading_still_start_on_a_new_line(self, readable):
        text = text_of(cc.render(ABOUT, "- Ask about payments"))
        assert text.index("Recipes:") < text.index("Ask about payments")

    def test_a_link_doesnt_take_the_full_stop_after_it(self, readable):
        assert b"/URI (https://x.com/a)" in cc.render("", "See https://x.com/a. Thanks")

    def test_paragraphs_and_typed_punctuation(self, readable):
        text = text_of(cc.render("", "Hi Maggy — “thanks”… it’s café → 你\n\nNext paragraph"))
        assert "Hi Maggy - \"thanks\"... it's caf\xe9 -> ?" in text.replace("\\", "")
        assert "Next paragraph" in text

    def test_empty_and_long(self):
        assert cc.render("", "").startswith(b"%PDF")
        long = "\n".join(f"- Question {i}, " + "word " * 30 for i in range(80))
        assert len(re.findall(rb"/Type /Page(?!s)", cc.render(ABOUT, long))) >= 2  # carries on to a new page

    def test_compressed_by_default(self):
        assert b"Who I am" not in cc.render("Who I am:", "")


class TestNames:
    def test_first_name_from_what_we_know(self, db):
        assert cc.first_name(f.contact(db, email="a@x.com", first_name="Maggy", full_name="Maggy Pan")) == "Maggy"
        assert cc.first_name(f.contact(db, email="b@x.com", full_name="Tyron Smith")) == "Tyron"
        assert cc.first_name(f.contact(db, email="c.d@x.com")) == "c.d"

    def test_filename_is_safe(self, db):
        assert cc.filename(f.contact(db, email="a@x.com", first_name="Maggy")) == "Coffee_Chat_With_Maggy.pdf"
        assert cc.filename(f.contact(db, email="b@x.com", first_name='Jo"; x=y')) == "Coffee_Chat_With_Joxy.pdf"
        assert cc.filename(f.contact(db, email="c@x.com", first_name="你")) == "Coffee_Chat_With_You.pdf"


def test_profile_starts_empty_and_is_one_row(db):
    p = cc.get_profile(db)
    assert (p.id, p.about) == (1, "")
    p.about = "Who I am:"
    db.commit()
    assert cc.get_profile(db).about == "Who I am:"


def test_sheet_uses_about_me_and_their_notes(db, readable):
    cc.get_profile(db).about = "Who I am:\n- A student"
    maggy = f.contact(db, email="maggy@cibc.com", first_name="Maggy", notes="- Ask about payments")
    db.commit()
    sheet = cc.sheet(db, maggy)
    assert (sheet.filename, sheet.content_type, sheet.size_bytes) == ("Coffee_Chat_With_Maggy.pdf", "application/pdf", len(sheet.data))
    text = text_of(sheet.data)
    assert text.index("A student") < text.index("Ask about payments")
