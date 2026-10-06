from app.rendering import EMAIL, enrich, placeholders, render


class TestPlaceholders:
    def test_in_order_of_first_appearance_lowercased_and_deduplicated(self):
        assert placeholders("Hi {{First_Name}} at {{ company }}", "{{company}} {{role}} {{first_name}}") == [
            "first_name",
            "company",
            "role",
        ]

    def test_ignores_invalid_names(self):
        assert placeholders("{{1abc}} {{}} {{a-b}} {single}") == []


class TestEnrich:
    def test_splits_full_name_into_first_and_last(self):
        out = enrich({"full_name": "Jane Q Doe", "email": "J@X.com"}, None)
        assert out["first_name"] == "Jane"
        assert out["last_name"] == "Doe"
        assert out["email"] == "j@x.com"

    def test_name_is_an_alias_for_full_name(self):
        out = enrich({"name": "Jane Doe"}, None)
        assert (out["first_name"], out["last_name"]) == ("Jane", "Doe")

    def test_single_word_name_has_no_last_name(self):
        out = enrich({"full_name": "Cher"}, None)
        assert out["first_name"] == "Cher"
        assert "last_name" not in out

    def test_keeps_given_first_and_last_names(self):
        out = enrich({"full_name": "Jane Doe", "first_name": "Janie", "last_name": "D."}, None)
        assert (out["first_name"], out["last_name"]) == ("Janie", "D.")

    def test_builds_full_name_from_first_and_last(self):
        assert enrich({"first_name": "Jane", "last_name": "Doe"}, None)["full_name"] == "Jane Doe"
        assert enrich({"first_name": "Jane"}, None)["full_name"] == "Jane"

    def test_normalises_keys_and_values(self):
        out = enrich({" Role ": "  Engineer ", "Notes": None}, None)
        assert out == {"role": "Engineer", "notes": ""}

    def test_adds_company_unless_the_row_has_one(self):
        assert enrich({}, " Stripe ")["company"] == "Stripe"
        assert enrich({"company": "Acme"}, "Stripe")["company"] == "Acme"
        assert "company" not in enrich({}, None)


class TestRender:
    def test_fills_values_case_insensitively(self):
        assert render("Hi {{First_Name}}, {{ company }}!", {"first_name": "Jane", "company": "Stripe"}) == (
            "Hi Jane, Stripe!",
            [],
        )

    def test_leaves_missing_or_empty_placeholders_and_reports_them(self):
        text, missing = render("{{a}} {{b}} {{a}}", {"b": ""})
        assert text == "{{a}} {{b}} {{a}}"
        assert missing == ["a", "b", "a"]


def test_email_pattern():
    assert EMAIL.match("jane@stripe.com")
    for bad in ("jane", "jane@stripe", "jane doe@stripe.com", "@stripe.com", "a@b@c.com"):
        assert not EMAIL.match(bad), bad
