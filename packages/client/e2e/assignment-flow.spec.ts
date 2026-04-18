import { expect, test, type Page } from "@playwright/test";

async function loginAsSeededUser(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("test");
  await page.getByLabel("Password").fill("12345678");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("owner can create a document and reach the main editing workspace", async ({ page }) => {
  await loginAsSeededUser(page);

  const title = `Bonus workspace ${Date.now()}`;
  await page.getByPlaceholder("Untitled strategy memo").fill(title);
  await page.getByRole("button", { name: "New document" }).click();

  await expect(page.getByDisplayValue(title)).toBeVisible();
  await expect(page.getByText("AI Writing Assistant")).toBeVisible();
  await expect(page.getByText("Live collaboration")).toBeVisible();
  await expect(page.getByText("Sharing")).toBeVisible();
  await expect(page.getByText("Version history")).toBeVisible();
});

test("owner can generate a guest link and open it as a Ghost guest", async ({ browser, page }) => {
  await loginAsSeededUser(page);

  const title = `Ghost link doc ${Date.now()}`;
  await page.getByPlaceholder("Untitled strategy memo").fill(title);
  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.getByDisplayValue(title)).toBeVisible();

  await page.getByRole("button", { name: "Create viewer link" }).click();
  const shareLinkText = await page.locator(".share-link-url").first().textContent();
  expect(shareLinkText).toBeTruthy();

  const guestPage = await browser.newPage();
  await guestPage.goto(shareLinkText!.trim());

  await expect(guestPage.getByText(/Opened as Ghost #1/i)).toBeVisible();
  await expect(guestPage.getByText("Sharing")).toBeVisible();
  await expect(
    guestPage.getByText(/Only the owner can manage people and links/i)
  ).toBeVisible();
});
