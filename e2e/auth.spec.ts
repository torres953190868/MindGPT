import { expect, test } from "@playwright/test";

test.describe("authentication pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("branchmind-language", "en");
    });
  });

  test("validates sign-in input before submitting", async ({ page }) => {
    await page.goto("/auth/sign-in?next=/projects");

    await page.getByTestId("auth-submit-button").click();
    await expect(page.getByTestId("auth-error")).toHaveText("Account name is required.");

    await page.getByTestId("auth-account-name-input").fill("learner");
    await page.getByTestId("auth-password-input").fill("short");
    await page.getByTestId("auth-submit-button").click();
    await expect(page.getByTestId("auth-error")).toHaveText(
      "Password must be at least 8 characters.",
    );
  });

  test("signs in and returns to the requested page", async ({ page }) => {
    await page.route("**/api/auth/sign-in", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, next: "/projects?welcome=1" }),
      });
    });
    // The form refreshes the session after sign-in; mock it so the flow does
    // not depend on dev-server compile latency for the real route.
    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          user: {
            id: "user_e2e_sign_in",
            email: "learner@example.com",
            accountName: "learner@example.com",
          },
        }),
      });
    });

    await page.goto("/auth/sign-in?next=/projects%3Fwelcome%3D1");
    await page.getByTestId("auth-account-name-input").fill("learner@example.com");
    await page.getByTestId("auth-password-input").fill("correct horse battery");
    const [signInResponse] = await Promise.all([
      page.waitForResponse("**/api/auth/sign-in"),
      page.getByTestId("auth-submit-button").click(),
    ]);
    expect(signInResponse.ok()).toBe(true);

    // Navigation waits on client refresh; allow for dev-server compile time.
    await expect(page).toHaveURL(/\/projects\?welcome=1$/, { timeout: 30_000 });
  });

  test("creates an account and returns to the requested page", async ({ page }) => {
    await page.route("**/api/auth/sign-up", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, accountName: "new-learner", next: "/projects" }),
      });
    });
    // Same as the sign-in test: keep the session refresh hermetic.
    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          user: { id: "user_e2e_sign_up", email: null, accountName: "new-learner" },
        }),
      });
    });

    await page.goto("/auth/sign-up?next=/projects");
    await expect(page.getByTestId("auth-submit-button")).toHaveText("Create account");
    await expect(page.getByTestId("google-sign-in-button")).toBeVisible();
    await page.getByTestId("auth-account-name-input").fill("new-learner");
    await page.getByTestId("auth-password-input").fill("correct horse battery");
    await page.getByTestId("auth-confirm-password-input").fill("correct horse battery");
    const [signUpResponse] = await Promise.all([
      page.waitForResponse("**/api/auth/sign-up"),
      page.getByTestId("auth-submit-button").click(),
    ]);
    expect(signUpResponse.ok()).toBe(true);

    await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  });
});
