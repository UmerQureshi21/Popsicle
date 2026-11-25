"""Coffee chat sheets: a one-page PDF to send someone before a call, made from "About me"
(the same for everyone) and your notes on that person (why you're reaching out, your questions).

Notes are plain text with a little structure, so they're quick to type:
  a line ending in ":"   a bold heading        ("What I am curious about:")
  a line starting "-"    a bullet              ("- How did your day-to-day change?")
  anything else          a paragraph
Web addresses become links. The PDF is plain black text with bold headings, like a document
written in Google Docs.
"""

import re

from fpdf import FPDF
from sqlalchemy.orm import Session

from .models import Attachment, Contact, Profile

MAX_TEXT = 20_000  # About me, and each person's notes

FONT = "Helvetica"
SIZE = 11
LINE = 5.5  # mm between lines of text
INDENT = 9  # mm from the margin to a bullet's text
COMPRESS = True  # tests turn it off to read the text back
URL = re.compile(r"https?://[^\s<>\"]+[^\s<>\".,;:!?)\]]")

# Helvetica (built into every PDF reader, so nothing to embed) only has Latin-1 characters.
# Typed punctuation outside it gets its plain equivalent; anything else becomes "?".
PLAIN = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-",
    "−": "-", "…": "...", "•": "-", "·": "-", " ": " ", "→": "->", "←": "<-",
})


def get_profile(db: Session) -> Profile:
    p = db.get(Profile, 1)
    if p is None:
        p = Profile(id=1, about="")
        db.add(p)
        db.commit()
    return p


def first_name(contact: Contact) -> str:
    return contact.first_name or (contact.full_name or "").split(" ")[0] or contact.email.split("@")[0]


def filename(contact: Contact) -> str:
    """Coffee_Chat_With_Maggy.pdf: only letters, digits, - and _, so it's safe in any header."""
    name = re.sub(r"[^A-Za-z0-9_-]+", "", first_name(contact).translate(PLAIN))
    return f"Coffee_Chat_With_{name or 'You'}.pdf"


def _plain(text: str) -> str:
    return text.translate(PLAIN).encode("latin-1", "replace").decode("latin-1")


def _write_text(pdf: FPDF, text: str) -> None:
    """Write a line of text, wrapping at the right margin, with any web addresses as links."""
    at = 0
    for m in URL.finditer(text):
        if m.start() > at:
            pdf.write(LINE, text[at : m.start()])
        pdf.set_text_color(17, 85, 204)
        pdf.set_font(FONT, "U", SIZE)
        pdf.write(LINE, m.group(), link=m.group())
        pdf.set_text_color(0, 0, 0)
        pdf.set_font(FONT, "", SIZE)
        at = m.end()
    if at < len(text):
        pdf.write(LINE, text[at:])
    pdf.ln(LINE)


def _write(pdf: FPDF, text: str) -> None:
    margin = pdf.l_margin
    gap = False  # a blank line since the last thing written
    for raw in _plain(text).splitlines():
        line = raw.strip()
        if not line:
            gap = True
            continue
        if line.endswith(":") and not line.startswith(("-", "*")):
            pdf.ln(LINE * (1 if pdf.get_y() > pdf.t_margin else 0))
            pdf.set_font(FONT, "B", SIZE)
            pdf.multi_cell(0, LINE, line, new_x="LMARGIN", new_y="NEXT")
            pdf.set_font(FONT, "", SIZE)
        elif line.startswith(("-", "*")):
            if gap:
                pdf.ln(LINE / 2)
            pdf.set_x(margin + 3)
            pdf.write(LINE, "-")
            pdf.set_left_margin(margin + INDENT)
            pdf.set_x(margin + INDENT)
            _write_text(pdf, line.lstrip("-* ").strip())
            pdf.set_left_margin(margin)
        else:
            if gap:
                pdf.ln(LINE / 2)
            _write_text(pdf, line)
        gap = False


def render(about: str, notes: str) -> bytes:
    """The sheet as PDF bytes: About me first, then your notes on this person."""
    pdf = FPDF(format="Letter")
    pdf.set_compression(COMPRESS)
    pdf.set_margins(25, 25, 25)
    pdf.set_auto_page_break(True, margin=20)
    pdf.add_page()
    pdf.set_font(FONT, "", SIZE)
    pdf.set_text_color(0, 0, 0)
    _write(pdf, about)
    if about.strip() and notes.strip() and not notes.strip().splitlines()[0].rstrip().endswith(":"):
        pdf.ln(LINE)  # a heading leaves its own gap
    _write(pdf, notes)
    return bytes(pdf.output())


def sheet(db: Session, contact: Contact) -> Attachment:
    """Their coffee chat sheet, as an attachment ready to send (not saved)."""
    data = render(get_profile(db).about, contact.notes or "")
    return Attachment(filename=filename(contact), content_type="application/pdf", size_bytes=len(data), data=data)
