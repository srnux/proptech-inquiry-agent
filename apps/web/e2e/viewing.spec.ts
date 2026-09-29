import { expect, test } from "@playwright/test";

test("the viewing example gets a reply, a trace and a ticket in the queue", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Demo model, no API key")).toBeVisible();
  await expect(page.getByText("No tickets yet.")).toBeVisible();

  await page.getByRole("button", { name: "A viewing request" }).click();

  const reply = page.getByTestId("reply");
  await expect(reply).toContainText("colleague will get back to you");
  await expect(reply).not.toContainText("confirmed");

  const step = page.locator(".step", { hasText: "Hand off to a person" });
  await expect(step).toContainText("viewing_request");
  await step.locator("summary").click();
  await expect(step.locator("pre").first()).toContainText('"contactEmail": "jana.becker@example.com"');

  const ticket = page.locator(".ticket");
  await expect(ticket).toHaveCount(1);
  await expect(ticket).toContainText("Viewing request");
  await expect(ticket).toContainText("HH-1001");
  await expect(ticket).toContainText("jana.becker@example.com");
});

test("a citation chip opens the cited passage", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "A fact question" }).click();
  await page.getByRole("button", { name: /HH-1001, sentence/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Listing HH-1001");
  await expect(dialog.locator("mark")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("a follow-up is sent with the conversation, and New conversation starts without it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "A fact question" }).click();
  await expect(page.getByTestId("reply")).toHaveCount(1);

  await page.getByLabel("Your inquiry").fill("And what is the deposit?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("reply").nth(1)).toContainText("Deposit is three months' cold rent");
  await page.locator(".step").first().locator("summary").click();
  await expect(page.locator(".step pre").first()).toContainText('"listingId": "HH-1001"');

  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByTestId("reply")).toHaveCount(0);
  await page.getByLabel("Your inquiry").fill("And what is the deposit?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator(".step").first().locator("summary").click();
  await expect(page.locator(".step pre").first()).not.toContainText("listingId");
});
