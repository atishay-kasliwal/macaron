import { expect, test } from "./fixtures.ts";

test("a user reaches the organisations from the menu, not on the overview", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/");
  await expect(page.getByText("Recent runs")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Repository" })).toHaveCount(0);
  await page.getByRole("link", { name: "Organisations" }).click();
  await expect(page).toHaveURL(/\/orgs$/);
  await expect(page.getByRole("heading", { name: "Organisations" })).toBeVisible();
});

test("the organisations show each repository ready or not, a fallback one, and an org without any", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/orgs");
  const ready = page.getByRole("row", { name: /open-macaron\/repo-0 / });
  await expect(ready.getByText("Ready", { exact: true })).toBeVisible();
  await expect(ready.getByRole("link", { name: "macaron-bot/x1y2z3-repo-0" })).toHaveAttribute("href", "https://github.com/macaron-bot/x1y2z3-repo-0");
  await expect(ready.getByText("Fallback", { exact: true })).toHaveCount(0);
  const waiting = page.getByRole("row", { name: /open-macaron\/sandbox-b/ });
  await expect(waiting.getByText("Not ready", { exact: true })).toBeVisible();
  await expect(waiting.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("row", { name: /open-macaron\/unlisted/ }).getByText("Fallback", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /empty-org/ }).getByText("No repository yet")).toBeVisible();
});

test("the organisations page by page with Load more, in one table", async ({ signIn }) => {
  const page = await signIn("defunkt");
  await page.goto("/orgs");
  await expect(page.getByRole("row")).toHaveCount(26);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("row")).toHaveCount(31);
  await expect(page.getByRole("columnheader", { name: "Repository" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("a failure to load the organisations is explained on their page", async ({ signIn, breakOrgs }) => {
  const page = await signIn("defunkt");
  await breakOrgs();
  await page.goto("/orgs");
  await expect(page.getByText("The organisations could not be loaded")).toBeVisible();
});
