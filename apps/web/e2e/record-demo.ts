// Records the README demo: a fact question answered with a citation, a viewing request handed off, then the
// German example.
// Not a test (Playwright only runs *.spec.ts). Start the desk with a real model first, so the reply is the
// model's and the page shows no demo banner:
//
//   pnpm dev                                    # with ANTHROPIC_API_KEY or the Bedrock settings in .env
//   pnpm exec tsx apps/web/e2e/record-demo.ts   # writes apps/web/test-results/demo/0000.png, 0001.png, ...
//
// Frames are lossless screenshots, not a video: a video's compression blurs the text, and a blurred frame also
// makes a larger GIF than a clean one. One frame every 375 ms, played at 8 per second, is three times the real
// speed, which is why the pauses below are long. Convert with ffmpeg (one palette for the whole clip):
//
//   ffmpeg -framerate 8 -i apps/web/test-results/demo/%04d.png -vf "split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docs/assets/demo.gif
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "@playwright/test";

const url = process.env.DESK_URL ?? "http://localhost:5173";
// Just wider than the 1100 px breakpoint, so all three panes stay side by side with the text as large as possible.
const size = { width: 1200, height: 760 };
const dir = "apps/web/test-results/demo";
const FRAME_MS = 375;

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
// Twice the pixels, so the GIF stays sharp on high-density screens and when shown at full size.
const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
await page.goto(url);
if (await page.getByText("Demo model, no API key").isVisible()) {
  console.warn("The desk runs the demo model; the recording will show its banner. Put a key in .env for the real one.");
}

// Capture runs alongside the script below until `recording` is cleared.
let recording = true;
let frames = 0;
const capture = (async () => {
  let next = Date.now();
  while (recording) {
    await page.screenshot({ path: `${dir}/${String(frames++).padStart(4, "0")}.png` });
    next += FRAME_MS;
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
  }
})();

const replies = page.getByTestId("reply");
const pause = (ms: number) => page.waitForTimeout(ms);

await pause(2500);
await page.getByRole("button", { name: "A fact question" }).click();
await replies.nth(0).waitFor({ timeout: 90_000 });
await pause(7000);
// Open the first citation chip, so the viewer sees where the answer came from.
const chip = page.getByRole("button", { name: /HH-1001, sentence/ }).first();
if (await chip.isVisible()) {
  await chip.click();
  await pause(6000);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
}
await pause(1500);

await page.getByRole("button", { name: "A viewing request" }).click();
await replies.nth(1).waitFor({ timeout: 90_000 });
await page.locator(".ticket").first().waitFor({ timeout: 10_000 });
await pause(8000);

// German, as a new conversation so it stands on its own: the reply comes in German, answers pets and heating
// from the record, and hands the viewing on. Shown from its first line, then scrolled to its end.
await page.getByRole("button", { name: "New conversation" }).click();
await pause(1500);
await page.getByRole("button", { name: "Auf Deutsch" }).click();
const german = replies.nth(0);
await german.waitFor({ timeout: 90_000 });
await pause(1200); // let the page's own smooth scroll to the bottom finish first
await german.evaluate((el) => el.scrollIntoView({ block: "start" }));
await pause(9000);
await german.evaluate((el) => el.scrollIntoView({ block: "end", behavior: "smooth" }));
await pause(8000);

recording = false;
await capture;
// The desk renders **bold** and nothing else, so a Markdown heading from the model would show as written.
const text = (await replies.allTextContents()).join("\n");
if (/^#{1,3} /m.test(text)) console.warn("A reply contains a Markdown heading, which the desk shows as written. Record again.");
await browser.close();
console.log(`${frames} frames in ${dir}`);
