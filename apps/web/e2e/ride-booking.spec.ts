import { expect, test, type Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const RIDER_ID = '00000000-0000-4000-8000-000000000001';

// Start every test from a clean slate: the demo rider has no ride in progress.
test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API_URL}/riders/${RIDER_ID}/active-ride`);
  const { ride } = await res.json();
  if (ride) {
    await request.post(`${API_URL}/rides/${ride.id}/cancel`, { data: { actor: 'SYSTEM', reason: 'e2e reset' } });
  }
});

async function chooseTrip(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  await fillTrip(page);
  await expect(page.getByText('Economy', { exact: true })).toBeVisible();
}

// exact: the swap button's label ("Swap pickup and destination") also contains "pickup".
async function fillTrip(page: Page) {
  await page.getByLabel('Pickup', { exact: true }).fill('Liberty Market, Gulberg');
  await page.getByLabel('Destination', { exact: true }).fill('Model Town Park');
}

test('rider books a ride, a driver is assigned, and the trip completes', async ({ page }) => {
  await chooseTrip(page);

  const request = page.getByRole('button', { name: /^Request Economy · Rs \d+/ });
  await expect(request).toBeEnabled();
  const quoted = (await request.textContent())!.match(/Rs [\d,]+/)![0];
  await request.click();

  await expect(page.getByRole('heading', { name: 'Finding your driver' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel ride' })).toBeVisible();

  await page.getByRole('button', { name: 'Assign nearest driver' }).click();
  await expect(page.getByRole('heading', { name: 'Driver on the way' })).toBeVisible();
  await expect(page.locator('.driver-name')).not.toBeEmpty();

  await page.getByRole('button', { name: 'Complete trip' }).click();
  await expect(page.getByRole('heading', { name: 'Trip completed' })).toBeVisible();
  await expect(page.getByText('Fare paid')).toBeVisible();
  await expect(page.locator('.trip .fare')).toHaveText(quoted); // charged what was quoted
  await expect(page.getByRole('button', { name: 'Cancel ride' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Book another ride' }).click();
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
});

test('rider cancels a requested ride', async ({ page }) => {
  await chooseTrip(page);
  await page.getByRole('button', { name: /^Request Economy/ }).click();
  await expect(page.getByRole('heading', { name: 'Finding your driver' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel ride' }).click();
  await expect(page.getByRole('heading', { name: 'Ride cancelled' })).toBeVisible();
  await expect(page.getByText(/cancelled by rider/i)).toBeVisible();
});

test('an in-progress ride survives a page reload', async ({ page }) => {
  await chooseTrip(page);
  await page.getByRole('button', { name: /^Request Economy/ }).click();
  await expect(page.getByRole('heading', { name: 'Finding your driver' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Finding your driver' })).toBeVisible();
  await expect(page.getByText('Liberty Market, Gulberg')).toBeVisible();
});

test('a failed fare lookup shows an error and recovers on retry', async ({ page }) => {
  let failNext = true;
  await page.route('**/fare-estimates', (route) => {
    if (failNext) {
      failNext = false;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'e2e' } }),
      });
    }
    return route.continue();
  });

  await page.goto('/');
  await fillTrip(page);

  // Filter by text: Next.js also renders an (empty) role="alert" route announcer.
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: /^Request Economy · Rs/ })).toBeEnabled();
});

test('a lost connection while booking does not create duplicate rides', async ({ page, request }) => {
  await chooseTrip(page);

  // First attempt: the request reaches the server and a ride is created,
  // but the response is "lost" on the way back to the browser.
  const attempts: Array<{ key: string | null; status: number; replayed: string | undefined; rideId: string }> = [];
  await page.route('**/rides', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    attempts.push({
      key: await route.request().headerValue('idempotency-key'),
      status: response.status(),
      replayed: response.headers()['idempotent-replayed'],
      rideId: body.id,
    });
    if (attempts.length === 1) return route.abort('connectionreset');
    return route.fulfill({ response });
  });

  await page.getByRole('button', { name: /^Request Economy/ }).click();
  await expect(page.getByRole('heading', { name: 'Finding your driver' })).toBeVisible();

  // The client retried automatically with the SAME key, and the server replayed
  // the original ride instead of creating (or rejecting) a second one.
  expect(attempts).toHaveLength(2);
  expect(attempts[1]!.key).toBe(attempts[0]!.key);
  expect(attempts[1]).toMatchObject({ status: 201, replayed: 'true', rideId: attempts[0]!.rideId });

  const { ride } = await (await request.get(`${API_URL}/riders/${RIDER_ID}/active-ride`)).json();
  expect(ride.id).toBe(attempts[0]!.rideId);
});
