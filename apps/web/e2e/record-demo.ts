// Records the README demo: a fact question answered with a citation, then a viewing request handed off.
// Not a test (Playwright only runs *.spec.ts). Start the desk with a real model first, so the reply is the
// model's and the page shows no demo banner:
//
//   pnpm dev                                    # with ANTHROPIC_API_KEY or the Bedrock settings in .env
//   pnpm exec tsx apps/web/e2e/record-demo.ts   # writes apps/web/test-results/demo/*.webm
//
// Then convert the video to docs/assets/demo.gif with ffmpeg (two-pass palette, twice the real speed):
//
//   ffmpeg -i <video>.webm -vf "setpts=PTS/2,fps=12,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" docs/assets/demo.gif
import { chromium } from "@playwright/test";

const url = process.env.DESK_URL ?? "http://localhost:5173";
const size = { width: 1280, height: 760 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  recordVideo: { dir: "apps/web/test-results/demo", size },
});
const page = await context.newPage();
await page.goto(url);
if (await page.getByText("Demo model, no API key").isVisible()) {
  console.warn("The desk runs the demo model; the recording will show its banner. Put a key in .env for the real one.");
}
const replies = page.getByTestId("reply");
const pause = (ms: number) => page.waitForTimeout(ms);

await pause(1200);
await page.getByRole("button", { name: "A fact question" }).click();
await replies.nth(0).waitFor({ timeout: 90_000 });
await pause(2500);
// Open the first citation chip, so the viewer sees where the answer came from.
const chip = page.getByRole("button", { name: /HH-1001, sentence/ }).first();
if (await chip.isVisible()) {
  await chip.click();
  await pause(2500);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
}
await pause(800);

await page.getByRole("button", { name: "A viewing request" }).click();
await replies.nth(1).waitFor({ timeout: 90_000 });
await page.locator(".ticket").first().waitFor({ timeout: 10_000 });
await pause(4000);

const video = page.video();
await context.close();
await browser.close();
console.log(`Video: ${await video?.path()}`);
