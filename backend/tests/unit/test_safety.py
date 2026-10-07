"""Guards for outside data used in links, email headers and Gmail searches."""

import pytest

from app import safety


@pytest.mark.parametrize(
    "address",
    ["jane@stripe.com", "jane.doe+popsicle@mail.stripe.co.uk", "o'brien@x.ie", "a_b-c%d@x-y.io", "J@X.COM"],
)
def test_real_addresses_are_accepted(address):
    assert safety.is_email(address)


@pytest.mark.parametrize(
    "address",
    [
        "a,b@x.com",  # a To: header would read this as two recipients
        "a@x.com,b@y.com",
        "x@y.com)OR(label:inbox",  # would change a Gmail search
        "{a@x.com}",
        "a b@x.com",
        '"a"@x.com',
        "<a@x.com>",
        "a@x.com\nBcc: b@y.com",
        "a@@x.com",
        "a@x",
        "a@-x.com",
        "",
    ],
)
def test_tricky_addresses_are_refused(address):
    assert not safety.is_email(address)


@pytest.mark.parametrize(
    "value, expected",
    [
        ("https://linkedin.com/in/jane", "https://linkedin.com/in/jane"),
        ("http://example.com", "http://example.com"),
        ("  https://linkedin.com/in/jane ", "https://linkedin.com/in/jane"),
        ("linkedin.com/in/jane", "https://linkedin.com/in/jane"),  # as people paste it
        ("javascript:alert(document.cookie)", None),
        ("JavaScript:alert(1)", None),
        ("data:text/html,<script>alert(1)</script>", None),
        ("vbscript:msgbox", None),
        ("java\tscript:alert(1)", None),
        ("https://x.com/\nhttps://y.com", None),
        ("//evil.example", None),
        ("/\\evil.example", None),
        ("https://", None),
        ("https://x.com/" + "a" * 600, None),
        ("", None),
        (None, None),
    ],
)
def test_only_web_links_are_kept(value, expected):
    assert safety.safe_url(value) == expected


def test_link_fields():
    assert safety.link_field(None) is None
    assert safety.link_field("  ") is None
    assert safety.link_field("linkedin.com/in/jane") == "https://linkedin.com/in/jane"
    with pytest.raises(ValueError, match="https://"):
        safety.link_field("javascript:alert(1)")


def test_line_breaks():
    assert safety.has_line_break("Hi\nBcc: x@y.com") and safety.has_line_break("a\rb")
    assert not safety.has_line_break("Quick question")
