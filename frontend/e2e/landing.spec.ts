import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";

const litSteps = (page: import("@playwright/test").Page) =>
  page.locator("[data-beam-step][data-lit]").count();

/** Scroll so the reading line (62% down the window) is `below` px under the centre of `selector`'s nth match. */
async function scrollTo(page: import("@playwright/test").Page, selector: string, n = 0, below = 20) {
  await page.evaluate(
    ([sel, i, by]) => {
      const box = (document.querySelectorAll(sel as string)[i as number] as HTMLElement).getBoundingClientRect();
      const centre = box.top + box.height / 2 + window.scrollY;
      window.scrollTo(0, centre + (by as number) - window.innerHeight * 0.62);
    },
    [selector, n, below],
  );
}

test("How it works lights up step by step as you scroll, and back again", async ({ page }) => {
  await new FakeApi().install(page);
  await page.goto("/");
  await page.locator("#how").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-beam-step]")).toHaveCount(5);
  // Three strands from each source, then a single path through the steps.
  await expect(page.locator("#how [data-lit-path]")).toHaveCount(7);

  // Two particles leave Hunter and Gmail; nothing is lit before they reach step 1.
  await scrollTo(page, '[data-source-block="hunter"]', 0, 160); // just below the source, on the way down
  await expect(page.locator('[data-particle="hunter"]')).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-particle="gmail"]')).toHaveCSS("opacity", "1");
  expect(await litSteps(page)).toBe(0);

  // Past step 3: the two have merged into one particle, and steps 1-3 are lit.
  await scrollTo(page, "[data-beam-dot]", 2);
  await expect(page.locator("[data-beam-step][data-lit]")).toHaveCount(3);
  await expect(page.locator('[data-particle="trunk"]')).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-particle="hunter"]')).toHaveCSS("opacity", "0");
  // The trunk is lit part of the way: drawn, but not all of it.
  const offset = await page.locator('[data-lit-path][data-main="trunk"]').evaluate((p) => parseFloat((p as SVGPathElement).style.strokeDashoffset));
  expect(offset).toBeGreaterThan(0);

  // Scrolling back up un-lights them.
  await scrollTo(page, "[data-beam-dot]", 0);
  await expect(page.locator("[data-beam-step][data-lit]")).toHaveCount(1);
});

test("the feature cards all appear together, then the trail zigzags through them once", async ({ page }) => {
  await new FakeApi().install(page);
  await page.goto("/");
  const cards = page.locator("[data-beam-card]");
  await expect(cards).toHaveCount(6);
  await cards.first().scrollIntoViewIfNeeded();
  // Shown together, not one by one as you scroll.
  await expect(page.locator("[data-shown]")).toHaveCount(1);
  // The particle lights them in zigzag order: top-left, top-right, middle-right, middle-left, ...
  const order: number[] = [];
  await expect
    .poll(async () => {
      const lit = await cards.evaluateAll((els) => els.map((e, i) => (e.hasAttribute("data-lit") ? i : -1)).filter((i) => i >= 0));
      for (const i of lit) if (!order.includes(i)) order.push(i);
      return lit.length;
    }, { timeout: 10_000, intervals: [50] })
    .toBe(6);
  expect(order).toEqual([0, 1, 3, 2, 4, 5]);
  await expect(page.locator("[data-particle]").last()).toHaveCSS("opacity", "0"); // done: the particle fades out
});

test("with reduced motion, everything is shown already lit", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await new FakeApi().install(page);
  await page.goto("/");
  await expect(page.locator("[data-beam-step][data-lit]")).toHaveCount(5);
  await expect(page.locator('[data-particle="trunk"]')).toHaveCSS("opacity", "0");
  await page.locator("[data-beam-card]").first().scrollIntoViewIfNeeded();
  await expect(page.locator("[data-beam-card][data-lit]")).toHaveCount(6); // lit straight away
  await context.close();
});

test("on a phone the cards stack plainly, without trails", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await new FakeApi().install(page);
  await page.goto("/");
  await page.locator("[data-beam-card]").first().scrollIntoViewIfNeeded();
  await expect(page.locator("[data-shown]")).toHaveCount(1); // the cards appear
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-beam-card][data-lit]")).toHaveCount(0); // but no trail
  await expect(page.locator("[data-beam-step]")).toHaveCount(5); // How it works still has its trail
  await context.close();
});

test("the hero shows the pitch and the three example cards, at every screen size", async ({ browser }) => {
  for (const width of [390, 768, 1024, 1280, 1772]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await new FakeApi().install(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Pop into their inbox" })).toBeVisible();
    await expect(page.getByText("Cold email, simplified")).toHaveCount(0);
    await expect(page.getByText(/Powered by/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Get started/ }).first()).toBeVisible();
    await expect(page.getByText("From cold email to")).toHaveCount(0);
    // Found (Hunter), sent (Gmail), times and Meet link (Calendar): the logo says where, so no status icons.
    const cards = page.locator("[data-hero-card]");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("[data-title]")).toHaveText(["Email found", "10 emails sent", "Times & Meet link sent"]);
    await expect(cards.locator("svg")).toHaveCount(0);
    // Each title fits inside its card.
    const overflow = await cards.evaluateAll((els) =>
      els.map((c) => c.querySelector("[data-title]")!.getBoundingClientRect().right - c.getBoundingClientRect().right),
    );
    expect(Math.max(...overflow)).toBeLessThanOrEqual(0);
    // Nothing pushes the page sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await context.close();
  }
});
