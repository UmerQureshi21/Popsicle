import { expect, it } from "vitest";
import { textChip, textToChips } from "./chips";

it("textChip turns URLs and domains into a domain chip", () => {
  expect(textChip(" https://www.Stripe.com/jobs ")).toEqual({ query: "stripe.com", label: "stripe.com", domain: "stripe.com" });
  expect(textChip("harvey.ai")).toEqual({ query: "harvey.ai", label: "harvey.ai", domain: "harvey.ai" });
});

it("textChip keeps a company name as typed", () => {
  expect(textChip(" Harvey AI ")).toEqual({ query: "Harvey AI", label: "Harvey AI", domain: null });
});

it("textToChips splits pasted lists on new lines and commas", () => {
  expect(textToChips("Stripe, harvey.ai\n\n  Shopify ,").map((c) => c.query)).toEqual(["Stripe", "harvey.ai", "Shopify"]);
});
