import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, apiError } from "@/test/server";
import EmptyResultHelp from "./EmptyResultHelp";

const props = { company: "stripe.com", organization: "Stripe", filterLabel: "matching “engineer” in the GTA", retryCost: "Up to 1 credit" };

describe("EmptyResultHelp", () => {
  it("explains that the filters left everyone out and offers retries", async () => {
    const calls = api("get", "/api/people-search/count", {
      total: 1520,
      by_department: { sales: 20, it: 300, hr: 40, legal: 5 },
      by_seniority: {},
    });
    const onAnywhere = vi.fn();
    const onWithoutTitle = vi.fn();
    render(<EmptyResultHelp {...props} onAnywhere={onAnywhere} onWithoutTitle={onWithoutTitle} />);

    expect(screen.getByText(/Checking how many people Hunter has at Stripe/)).toBeInTheDocument();
    expect(await screen.findByText("1,520 people")).toBeInTheDocument();
    expect(screen.getByText("(300 in Engineering/IT, 40 in HR/Recruiting, 20 in Sales)")).toBeInTheDocument();
    expect(screen.getByText(/but none matching “engineer” in the GTA/)).toBeInTheDocument();
    expect(calls[0].url.searchParams.get("query")).toBe("stripe.com");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Search anywhere/ }));
    await user.click(screen.getByRole("button", { name: /Remove the job title/ }));
    expect(onAnywhere).toHaveBeenCalled();
    expect(onWithoutTitle).toHaveBeenCalled();
    expect(screen.getByText("Up to 1 credit, free if still no one")).toBeInTheDocument();
  });

  it("without retries or a filter label or departments", async () => {
    api("get", "/api/people-search/count", { total: 3, by_department: {}, by_seniority: {} });
    render(<EmptyResultHelp {...props} organization={null} filterLabel="" />);
    expect(await screen.findByText(/but none for this search/)).toBeInTheDocument();
    expect(screen.getByText(/at stripe\.com/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says Hunter has no one when the company is empty", async () => {
    api("get", "/api/people-search/count", { total: 0, by_department: {}, by_seniority: {} });
    render(<EmptyResultHelp {...props} />);
    expect(await screen.findByText(/Hunter has no people for Stripe yet/)).toBeInTheDocument();
  });

  it("says the same when the count can't be loaded", async () => {
    apiError("get", "/api/people-search/count", 502);
    render(<EmptyResultHelp {...props} />);
    expect(await screen.findByText(/Hunter has no people for Stripe yet/)).toBeInTheDocument();
  });
});
