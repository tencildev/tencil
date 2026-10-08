import { expect, type Page, test } from '@playwright/test';

/**
 * Drives the real overlay in a real browser: playground (Vite + tencil
 * plugin) → bridge → fake T3 Code. Playwright CSS locators pierce the
 * overlay's open shadow root.
 */
const overlay = (page: Page) => page.locator('tencil-overlay');

async function openPlayground(page: Page) {
    await page.goto('/');
    await expect(overlay(page).locator('.status-dot.status-ok')).toBeVisible({ timeout: 15_000 });
}

async function pinElement(page: Page, target: string, prompt: string) {
    await page.keyboard.press('c');
    const element = page.getByRole('button', { name: target });
    await element.hover();
    await expect(overlay(page).locator('.highlight-label')).toContainText('PricingCard');
    await element.click();
    const composer = overlay(page).locator('.composer textarea');
    await expect(composer).toBeFocused();
    await composer.fill(prompt);
    await composer.press('Enter');
}

test('connects to the agent through the bridge', async ({ page }) => {
    await openPlayground(page);
    // The playground lives in this repository, so its T3 Code project is the
    // checkout's root folder, whatever it is called.
    await expect(overlay(page).locator('.status-dot')).toHaveAttribute('title', /^T3 Code · \S/);
});

test('pins a prompt on an element and streams the reply into it', async ({ page }) => {
    await openPlayground(page);
    await pinElement(page, 'Choose Pro', 'Make this button green');

    const thread = overlay(page).locator('.thread');
    await expect(thread.locator('.chip')).toContainText('PricingCard');
    await expect(thread.locator('.thread-source')).toContainText('pricing-card.tsx');
    await expect(thread.locator('.message-user')).toHaveText('Make this button green');
    await expect(thread.locator('.message-assistant')).toContainText('Updated it.', {
        timeout: 10_000,
    });
    await expect(thread.locator('.message-assistant li')).toHaveCount(2);
    await expect(overlay(page).locator('.pin.pin-done')).toHaveCount(1);
});

test('continues the conversation and keeps pins across reloads', async ({ page }) => {
    await openPlayground(page);
    // The pin itself is a 0×0 anchor; its body is what you see and click.
    await overlay(page).locator('.pin .pin-body').first().click();
    const reply = overlay(page).locator('.thread textarea');
    await reply.fill('Also make it bigger');
    await reply.press('Enter');
    await expect(overlay(page).locator('.thread .message-assistant')).toHaveCount(2, {
        timeout: 10_000,
    });

    await page.reload();
    await expect(overlay(page).locator('.pin')).toHaveCount(1, { timeout: 15_000 });
});

test("lists the agent's threads and opens one in the dock", async ({ page }) => {
    await openPlayground(page);
    await overlay(page).locator('.tool[title="Pins"]').click();
    await overlay(page).getByRole('button', { name: 'T3 Code' }).click();
    const row = overlay(page).locator('.provider-item').first();
    await expect(row).toContainText('PricingCard');
    await row.click();
    await expect(overlay(page).locator('.thread.thread-docked')).toBeVisible();
});

test('drags the toolbar to another corner', async ({ page }) => {
    await openPlayground(page);
    const handle = overlay(page).locator('.divider');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(60, 60, { steps: 12 });
    await page.mouse.up();
    await expect(overlay(page).locator('.toolbar-wrap')).toHaveClass(/dock-top-left/);

    await page.reload();
    await expect(overlay(page).locator('.toolbar-wrap')).toHaveClass(/dock-top-left/);
});

test('cancels comment mode with Escape without touching the page', async ({ page }) => {
    await openPlayground(page);
    await page.keyboard.press('c');
    await expect(overlay(page).locator('.tool-active')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay(page).locator('.tool-active')).toHaveCount(0);
});

test('closes the thread once it is resolved', async ({ page }) => {
    await openPlayground(page);
    await overlay(page).locator('.pin .pin-body').first().click();
    const thread = overlay(page).locator('.thread');
    await expect(thread).toBeVisible();
    await thread.getByTitle('Resolve').click();
    await expect(thread).toHaveCount(0);
});

test("switches the project's agent in settings and remembers it", async ({ page }) => {
    await openPlayground(page);
    const settings = overlay(page).locator('.settings-panel');
    await overlay(page).locator('.tool[title="Project settings"]').click();
    await expect(settings.getByRole('radio', { name: 'T3 Code' })).toBeChecked();

    await settings.getByText('Claude Code').click();
    await expect(overlay(page).locator('.status-dot')).toHaveAttribute('title', /^Claude Code/, {
        timeout: 15_000,
    });

    await page.reload();
    await overlay(page).locator('.tool[title="Project settings"]').click();
    await expect(settings.getByRole('radio', { name: 'Claude Code' })).toBeChecked();

    await settings.getByText('T3 Code').click();
    await expect(overlay(page).locator('.status-dot')).toHaveAttribute('title', /^T3 Code/);
});
