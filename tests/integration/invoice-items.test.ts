/**
 * Integration tests for invoice item extraction.
 *
 * Regression test for the qty-attribution bug observed on UK order
 * 202-8508835-7037919 — a single purchasedItems container held three items
 * (Forcep, Petkin × 2, Wahl Rake) but only one od-item-view-qty badge.
 * The previous positional-index lookup wrongly assigned qty=2 to Forcep and
 * left Petkin at qty=1.
 */

import { chromium, Browser, Page } from "playwright";
import { readFileSync } from "fs";
import { join } from "path";
import { extractItemsFromDataComponents } from "../../src/amazon/extractors/invoice";

describe("invoice item extraction (integration)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      console.log("Playwright browser not available, skipping integration tests");
    }
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  beforeEach(async () => {
    if (browser) page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) await page.close();
  });

  describe("UK order 202-8508835-7037919 — multi-item shipment with one qty badge", () => {
    it("attributes quantities to the correct items", async () => {
      if (!browser) return;

      const fixtureHtml = readFileSync(
        join(__dirname, "fixtures/invoice-202-8508835-7037919.html"),
        "utf-8",
      );
      await page.setContent(fixtureHtml);

      const items = await extractItemsFromDataComponents(page, "GBP");

      // Expected: 7 items across 5 shipment containers (1+3+1+1+1).
      expect(items.length).toBe(7);

      const byName = (needle: string) =>
        items.find((it) => it.name.toLowerCase().includes(needle.toLowerCase()));

      const petkin = byName("Petkin");
      const forcep = byName("Forcep");
      const wahlRake = byName("Wahl Double Row Rake");

      expect(petkin).toBeDefined();
      expect(forcep).toBeDefined();
      expect(wahlRake).toBeDefined();

      // The bug: Petkin × 2 badge was being attributed to Forcep (the
      // preceding title in the same container) and Petkin defaulted to 1.
      expect(petkin!.quantity).toBe(2);
      expect(forcep!.quantity).toBe(1);
      expect(wahlRake!.quantity).toBe(1);

      // The other four single-item containers should all be qty 1.
      const singletons = items.filter(
        (it) => ![petkin, forcep, wahlRake].includes(it),
      );
      expect(singletons.length).toBe(4);
      for (const it of singletons) expect(it.quantity).toBe(1);
    });
  });
});
