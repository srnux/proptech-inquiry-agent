// Records the README demo: a fact question answered with a citation, a viewing request handed off, then the
// German example.
// Not a test (Playwright only runs *.spec.ts). Start the desk with a real model first, so the reply is the
// model's and the page shows no demo banner:
//
//   pnpm dev                                    # with ANTHROPIC_API_KEY or the Bedrock settings in .env
//   pnpm exec tsx apps/web/e2e/record-demo.ts   # writes apps/web/test-results/demo/*.webm
//
// The pauses are long because the GIF plays at three times the real speed. Convert with ffmpeg (every ninth
// frame of 24 fps played at 8 fps, one palette for the whole clip):
//
//   ffmpeg -i <video>.webm -vf "fps=24,select='not(mod(n,9))',setpts=N/8/TB,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=64[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" -vsync 0 docs/assets/demo.gif
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

const video = page.video();
await context.close();
await browser.close();
console.log(`Video: ${await video?.path()}`);
