/**
 * Capture the raw HTML of an Amazon invoice print page for use as a test fixture.
 *
 * Reuses the same persistent browser context as the MCP server, so an existing
 * signed-in session is used without re-auth. Make sure the MCP server is NOT
 * running when this is invoked (persistent contexts are exclusive per data dir).
 *
 * Usage:
 *   bun run scripts/capture-invoice-html.ts <orderId> [region]
 *
 * Default region is "uk". Output is written to
 * tests/integration/fixtures/invoice-<orderId>.html.
 */

import { chromium } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { getRegionByCode } from "../src/amazon/regions";
import { getInvoiceUrl } from "../src/amazon/extractors/invoice";

const BROWSER_DATA_DIR = join(
  homedir(),
  ".amazon-order-history-mcp",
  "browser-data",
);

async function main() {
  const orderId = process.argv[2];
  const region = process.argv[3] || "uk";

  if (!orderId) {
    console.error("Usage: bun run scripts/capture-invoice-html.ts <orderId> [region]");
    process.exit(1);
  }

  const regionConfig = getRegionByCode(region);
  if (!regionConfig) {
    console.error(`Unknown region: ${region}`);
    process.exit(1);
  }

  const invoiceUrl = getInvoiceUrl(orderId, regionConfig.domain);
  console.error(`Navigating to: ${invoiceUrl}`);

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const pages = context.pages();
  const page = pages[0] || (await context.newPage());

  await page.goto(invoiceUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

  const currentUrl = page.url();
  if (currentUrl.includes("signin") || currentUrl.includes("ap/signin")) {
    console.error(`ERROR: Redirected to sign-in. Run the MCP once interactively to refresh session.`);
    await context.close();
    process.exit(2);
  }
  if (currentUrl.includes("order-history") || currentUrl.includes("your-orders")) {
    console.error(`ERROR: Redirected to order history. Order ${orderId} may not exist in region ${region}.`);
    await context.close();
    process.exit(2);
  }

  await page
    .waitForSelector('[data-component="purchasedItems"], table, .a-box', {
      timeout: 5000,
    })
    .catch(() => {});

  const html = await page.content();

  const outDir = join(__dirname, "..", "tests", "integration", "fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `invoice-${orderId}.html`);
  writeFileSync(outPath, html, "utf8");

  console.error(`Wrote ${html.length} bytes to ${outPath}`);
  console.error(
    `\nIMPORTANT: scrub PII before committing. Captured page contains real:\n` +
      `  - recipient name + shipping address (data-component="shippingAddress" block)\n` +
      `  - payment-method card last 4 digits (rendered HTML + embedded SSR JSON)\n` +
      `  - amzn1.pm.wallet.* internal payment-method identifier\n` +
      `Replace each with dummy values before git add.`,
  );

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
