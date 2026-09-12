import { expect, test as base, type Page } from "@playwright/test";
import { schedulesByCourse, statusesByCourse } from "./fixtures/mock-data";

const FIXED_BROWSER_TIME = new Date("2026-09-07T05:30:00.000Z");

interface NetworkFixtures {
  unexpectedExternalRequests: string[];
}

const test = base.extend<NetworkFixtures>({
  unexpectedExternalRequests: [
    async ({ page }, provide) => {
      const requests: string[] = [];

      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
          await route.continue();
          return;
        }

        requests.push(route.request().url());
        await route.abort("blockedbyclient");
      });

      await provide(requests);
      expect(requests, "E2E runtime must not contact external infrastructure").toEqual([]);
    },
    { auto: true },
  ],
});

async function installApiMocks(page: Page) {
  for (const course of [1, 2] as const) {
    await page.route(new RegExp(`/api/schedule\\?course=${course}$`), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(schedulesByCourse[course]) });
    });
    await page.route(new RegExp(`/api/status\\?course=${course}$`), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statusesByCourse[course]) });
    });
  }
}

async function openSchedule(page: Page) {
  await installApiMocks(page);
  // setFixedTime freezes Date.now()/new Date(); application timers continue to run.
  await page.clock.setFixedTime(FIXED_BROWSER_TIME);
  await page.goto("/");
}

test("loads the default course and renders the selected group's lessons", async ({ page }) => {
  await openSchedule(page);

  const courseNavigation = page.getByRole("navigation", { name: "Anul de studii" });
  await expect(courseNavigation.getByRole("button", { name: "Anul I", exact: true })).toHaveAttribute("aria-pressed", "true");

  const groupSelect = page.getByRole("combobox", { name: "Grupa" });
  await expect(groupSelect).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alege grupa ta · Anul I" })).toBeVisible();
  await page.getByRole("button", { name: "FAF-261", exact: true }).click();

  await expect(groupSelect).toHaveValue("FAF-261");
  await expect(page.getByRole("heading", { name: "FAF-261", exact: true })).toBeVisible();

  const lecture = page.getByRole("article", { name: "Programarea Calculatoarelor, 08:00–09:30" });
  const seminar = page.getByRole("article", { name: "Programarea Calculatoarelor, 09:45–11:15" });
  const activity = page.getByRole("article", { name: "Activități Individuale/În Grup, 11:30–13:00" });
  await expect(lecture.getByText("Curs", { exact: true })).toBeVisible();
  await expect(seminar.getByText("Seminar", { exact: true })).toBeVisible();
  const activityLabels = activity.getByText("Activități Individuale/În Grup", { exact: true });
  await expect(activityLabels).toHaveCount(2);
  for (const label of await activityLabels.all()) await expect(label).toBeVisible();
});

test("switches courses without leaking the previous course payload", async ({ page }) => {
  await openSchedule(page);

  await page.getByRole("button", { name: "FAF-261", exact: true }).click();
  await expect(page.getByRole("heading", { name: "FAF-261", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Programarea Calculatoarelor, 08:00–09:30" })).toBeVisible();

  const courseNavigation = page.getByRole("navigation", { name: "Anul de studii" });
  await courseNavigation.getByRole("button", { name: "Anul II", exact: true }).click();
  await expect(courseNavigation.getByRole("button", { name: "Anul II", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Alege grupa ta · Anul II" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "FAF-261", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Programarea Calculatoarelor, 08:00–09:30" })).toHaveCount(0);

  const groupSelect = page.getByRole("combobox", { name: "Grupa" });
  await expect(groupSelect.getByRole("option", { name: "TI-251", exact: true })).toHaveCount(1);
  await expect(groupSelect.getByRole("option", { name: "SI-251", exact: true })).toHaveCount(1);
  await expect(groupSelect.getByRole("option", { name: "FAF-261", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "TI-251", exact: true }).click();
  await expect(groupSelect).toHaveValue("TI-251");
  await expect(page.getByRole("article", { name: "Rețele De Calculatoare, 08:00–09:30" })).toBeVisible();
});

test("switches between today, week and all-groups views", async ({ page }) => {
  await openSchedule(page);
  await page.getByRole("button", { name: "FAF-261", exact: true }).click();

  const viewNavigation = page.getByRole("navigation", { name: "Mod de afișare" });
  await expect(viewNavigation.getByRole("button", { name: "Azi", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "Ziua" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Luni", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Marți", exact: true })).toHaveCount(0);

  await viewNavigation.getByRole("button", { name: "Săptămâna", exact: true }).click();
  await expect(viewNavigation.getByRole("button", { name: "Săptămâna", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "Ziua" })).toHaveCount(0);
  for (const day of ["Luni", "Marți", "Miercuri", "Joi", "Vineri"]) {
    await expect(page.getByRole("region", { name: day, exact: true })).toBeVisible();
  }

  await viewNavigation.getByRole("button", { name: "Toate grupele", exact: true }).click();
  const allGroups = page.getByRole("region", { name: "Toate grupele" });
  await expect(allGroups).toBeVisible();
  await expect(allGroups.getByRole("table")).toBeVisible();
  await expect(allGroups.getByRole("columnheader", { name: "FAF-261", exact: true })).toBeVisible();
  await expect(allGroups.getByRole("columnheader", { name: "SI-261", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Luni", exact: true })).toHaveCount(0);
});

test("restores the selected course and group after reload", async ({ page }) => {
  await openSchedule(page);

  const courseNavigation = page.getByRole("navigation", { name: "Anul de studii" });
  await courseNavigation.getByRole("button", { name: "Anul II", exact: true }).click();
  await page.getByRole("button", { name: "TI-251", exact: true }).click();

  const groupSelect = page.getByRole("combobox", { name: "Grupa" });
  await expect(groupSelect).toHaveValue("TI-251");
  await expect(page.getByRole("article", { name: "Rețele De Calculatoare, 08:00–09:30" })).toBeVisible();

  await page.reload();

  await expect(courseNavigation.getByRole("button", { name: "Anul II", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(groupSelect).toHaveValue("TI-251");
  await expect(page.getByRole("heading", { name: "TI-251", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Rețele De Calculatoare, 08:00–09:30" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Alege grupa ta/ })).toHaveCount(0);
});
