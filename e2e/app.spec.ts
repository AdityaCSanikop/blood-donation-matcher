import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD || "Demo@12345";
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true }).click();

test.describe.configure({ mode: "serial" });

test("visitors are sent to the sign-in page, and a wrong password is explained", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await shot(page, "01-sign-in");
  await signIn(page, "staff@lakeside.test", "not-the-password");
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("hospital staff: dashboard shows the urgency queue from the database", async ({ page }) => {
  await signIn(page, "staff@lakeside.test");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const queue = page.locator("section", { hasText: "Most urgent open requests" }).locator("ol > li");
  await expect(queue).toHaveCount(8);
  await expect(queue.first()).toContainText("Critical");
  await expect(queue.first()).toContainText("Ramesh Kumar");
  await expect(queue.last()).toContainText("Low");
  await expect(page.getByText("Not enough eligible donors right now for")).toBeVisible();
  await page.getByText("Network reports").click();
  await expect(page.locator("details").getByRole("row", { name: /Lakeside General Hospital/ })).toBeVisible();
  await shot(page, "02-dashboard");
});

test("hospital staff: search donors, see validation errors, register a donor", async ({ page }) => {
  await signIn(page, "staff@lakeside.test");
  await nav(page, "Donors");
  await expect(page.getByText("24 donors")).toBeVisible();

  await page.getByLabel("Search by name or city").fill("Meera");
  await expect(page.getByText("1 donor", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Meera Nair/ })).toBeVisible();
  await page.getByLabel("Search by name or city").fill("zzzzzz");
  await expect(page.getByText("No donors match")).toBeVisible();
  await page.getByLabel("Search by name or city").fill("");

  await page.getByRole("button", { name: "Register a donor" }).click();
  const form = page.locator("form");
  await form.getByLabel("Full name").fill("Esha Test");
  await form.getByLabel("Phone").fill("12ab");
  await page.getByRole("button", { name: "Register donor" }).click();
  await expect(page.getByText("Choose a valid blood group.", { exact: true })).toBeVisible();
  await expect(page.getByText("Phone must be 7–14 digits, optionally starting with +.")).toBeVisible();
  await shot(page, "03-donor-validation");

  await form.getByLabel("Blood group").selectOption("A+");
  await form.getByLabel("Phone").fill("9777000001");
  await form.getByLabel("City").fill("Bengaluru");
  await page.getByRole("button", { name: "Register donor" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Esha Test registered." })).toBeVisible();
  await expect(page.getByText("25 donors")).toBeVisible();
  await shot(page, "04-donors");
});

test("hospital staff: recipient -> request -> matching -> donations -> fulfilled", async ({ page }) => {
  await signIn(page, "staff@lakeside.test");

  await nav(page, "Recipients");
  await page.getByRole("button", { name: "Register a recipient" }).click();
  const form = page.locator("form");
  await form.getByLabel("Full name").fill("Nandini Test");
  await form.getByLabel("Blood group").selectOption("A+");
  await form.getByLabel("Age (optional)").fill("35");
  await page.getByRole("button", { name: "Register recipient" }).click();
  await expect(page.getByText("Nandini Test registered.")).toBeVisible();

  await nav(page, "Blood requests");
  await page.getByRole("button", { name: "Raise a blood request" }).click();
  await form.locator("[name=recipient_id]").selectOption({ label: "Nandini Test (A+)" });
  await form.getByLabel("Units required").fill("2");
  await form.locator("[name=urgency_level]").selectOption("Critical");
  await page.getByRole("button", { name: "Raise request" }).click();
  await expect(page.getByText(/Request #\d+ raised\./)).toBeVisible();
  await shot(page, "05-requests");

  await page.getByRole("row", { name: /Nandini Test/ }).getByRole("link", { name: "Find donors" }).click();
  await expect(page.getByRole("heading", { name: "A+ for Nandini Test" })).toBeVisible();
  const matches = page.locator("section", { hasText: "Matching donors" }).locator("tbody tr");
  await expect(matches.first()).toContainText("Exact match");
  await expect(matches.first()).toContainText("Same city");
  const eligibleOnly = await matches.count();
  await page.getByLabel("Also show donors still in their 90-day waiting period").check();
  await expect(matches).not.toHaveCount(eligibleOnly);
  await expect(page.getByText("Not yet eligible").first()).toBeVisible();
  await expect(page.getByText(/not clinical approval/)).toBeVisible();
  await shot(page, "06-matching-donors");
  await page.getByLabel("Also show donors still in their 90-day waiting period").uncheck();
  await expect(matches).toHaveCount(eligibleOnly);

  await matches.first().getByRole("button", { name: "Record" }).click();
  await expect(page.getByText(/Donation recorded for .+\. 1 unit still needed\./)).toBeVisible();
  await expect(page.getByText("Partially Fulfilled")).toBeVisible();
  await shot(page, "07-partially-fulfilled");

  await matches.first().getByRole("button", { name: "Record" }).click();
  await expect(page.getByText(/The request is now fulfilled\./)).toBeVisible();
  await expect(page.getByText("Fulfilled", { exact: true })).toBeVisible();
  await expect(page.locator("section", { hasText: "Donations for this request" }).locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Matching donors" })).toHaveCount(0);
  await shot(page, "08-fulfilled");
});

test("hospital staff: cannot over-fulfil, can cancel, sees other hospitals read-only", async ({ page }) => {
  await signIn(page, "staff@lakeside.test");
  await nav(page, "Blood requests");

  // Request #4 belongs to Nandi Hills Medical Centre.
  await page.getByRole("row", { name: /Geetha Prasad/ }).getByRole("link", { name: "Find donors" }).click();
  await expect(page.getByText(/belongs to another hospital/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel request" })).toHaveCount(0);

  // Request #9 (Vinod Hegde, 4 units of O+) is ours: cancel it.
  await nav(page, "Blood requests");
  await page.getByRole("row", { name: /Vinod Hegde/ }).getByRole("link", { name: "Find donors" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Request cancelled.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matching donors" })).toHaveCount(0);
});

test("hospital staff: a request with no eligible donor says so clearly", async ({ page }) => {
  await signIn(page, "staff@lakeside.test");
  // Make both eligible O- donors unavailable, then open the O- request (#2).
  await nav(page, "Donors");
  for (const name of ["Meera Nair", "Manoj Kamath"]) {
    await page.getByRole("button", { name: `Mark ${name} unavailable` }).click();
    await expect(page.getByText(`${name} is now marked unavailable.`)).toBeVisible();
  }
  await nav(page, "Blood requests");
  await page.getByRole("row", { name: /Sunita Devi/ }).getByRole("link", { name: "Find donors" }).click();
  await expect(page.getByText("No matching donors")).toBeVisible();
  await expect(page.getByText(/No compatible donor is available and eligible right now/)).toBeVisible();
  await shot(page, "09-no-match");
});

test("hospital staff: walk-in donation and the activity log with statistics", async ({ page }) => {
  await signIn(page, "staff@lakeside.test");
  await nav(page, "Donations");
  await page.getByRole("button", { name: "Record a walk-in donation" }).click();
  await page.locator("form [name=donor_id]").selectOption({ label: "Arjun Rao (O+), Bengaluru" });
  await page.getByRole("button", { name: "Record donation" }).click();
  await expect(page.getByText("Donation recorded for Arjun Rao.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Arjun Rao.*Walk-in/ })).toBeVisible();
  await shot(page, "10-donations");

  await nav(page, "Activity log");
  await expect(page.getByText(/went from Partially Fulfilled to Fulfilled \(donation recorded\)/)).toBeVisible();
  await expect(page.getByText(/went from Pending to Cancelled/)).toBeVisible();
  await expect(page.getByText(/changed from Available to Unavailable/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /By action \(\d+ events\)/ })).toBeVisible();
  await page.getByRole("button", { name: "By week" }).click();
  await expect(page.getByRole("rowheader", { name: /^\d{4}-W\d{2}$/ })).toBeVisible();
  await shot(page, "11-activity-log");

  await page.getByLabel("About").selectOption("donation");
  await expect(page.getByText(/Donation #\d+ recorded/).first()).toBeVisible();
  await expect(page.getByText(/changed from Available to Unavailable/)).toHaveCount(0);

  await nav(page, "Hospitals");
  await expect(page.getByRole("row", { name: /Lakeside General Hospital.*Your hospital/ })).toBeVisible();
  await shot(page, "12-hospitals");
});

test("donor: own profile, availability toggle, no access to staff pages", async ({ page }) => {
  await signIn(page, "arjun@donor.test");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { name: "Hello, Arjun Rao" })).toBeVisible();
  // He donated today in the previous test, so the 90-day rule now applies to him.
  await expect(page.getByText(/You donated 0 days ago\. You can donate again from/)).toBeVisible();
  await expect(page.locator("section", { hasText: "Your donations" }).locator("tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: "Mark me unavailable" }).click();
  await expect(page.getByText("You are marked unavailable. Hospitals will not see you in matches.")).toBeVisible();
  await expect(page.getByText(/Donor #1 changed from Available to Unavailable/)).toBeVisible();
  await shot(page, "13-donor-profile");
  await page.getByRole("button", { name: "Mark me available" }).click();
  await expect(page.getByText("You are marked available. Hospitals can now find you.")).toBeVisible();

  await page.goto("/donors");
  await expect(page).toHaveURL(/\/me$/);
  const api = await page.request.get("/api/donors");
  expect(api.status()).toBe(403);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login$/);
});

test("a new donor can register and lands on their profile", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Zoya Newdonor");
  await page.getByLabel("Blood group").selectOption("B-");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByLabel("Phone").fill("9777000002");
  await page.getByLabel("Email").fill("zoya@donor.test");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create donor account" }).click();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
  await page.getByLabel("Password").fill("LongEnough#1");
  await page.getByRole("button", { name: "Create donor account" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Zoya Newdonor" })).toBeVisible();
  await expect(page.getByText("You can donate today.")).toBeVisible();
  // Request #1 needs B- (Critical) and is still open: it must be offered to a B- donor.
  await expect(page.locator("section", { hasText: "Open requests your blood group can help" }).locator("tbody tr").first()).toContainText("Critical");
});

test("works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, "staff@kaveri.test");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Most urgent open requests")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "14-dashboard-mobile");
});
