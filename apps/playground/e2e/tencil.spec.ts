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
    const status = overlay(page).locator('.status-button');
    await expect(status).toHaveAttribute('aria-label', /^Tencil status: T3 Code · \S/);

    // Hovering the dot explains the connection.
    await status.hover();
    const card = overlay(page).getByRole('tooltip');
    await expect(card).toContainText('Tencil');
    await expect(card.locator('.status-card-row').filter({ hasText: 'Daemon' })).toContainText(
        'Connected',
    );
    await expect(
        card.locator('.status-card-row').filter({ hasText: 'Agent' }).first(),
    ).toContainText('T3 Code');
    await page.mouse.move(640, 300);
    await expect(card).toHaveCount(0);
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

test('opens a thread at its latest message', async ({ page }) => {
    // A short window so the conversation overflows the thread panel.
    await page.setViewportSize({ width: 1280, height: 360 });
    await openPlayground(page);
    await page.getByRole('button', { name: 'Choose Pro' }).scrollIntoViewIfNeeded();
    await overlay(page).locator('.pin .pin-body').first().click();
    const messages = overlay(page).locator('.thread .messages');
    await expect(messages.locator('.message-assistant')).toHaveCount(2);
    await expect
        .poll(() =>
            messages.evaluate(element => ({
                overflows: element.scrollHeight > element.clientHeight,
                atBottom: element.scrollHeight - element.scrollTop - element.clientHeight < 2,
            })),
        )
        .toEqual({ overflows: true, atBottom: true });
});

test('drags a pin onto another element and keeps it there', async ({ page }) => {
    await openPlayground(page);
    const pin = overlay(page).locator('.pin .pin-body').first();
    const from = (await pin.boundingBox())!;
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    // The pin's tip is its bottom-left corner; grab the body and land the tip on the heading.
    const grab = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const tip = { x: heading.x + 20, y: heading.y + heading.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(tip.x + (grab.x - from.x), tip.y - (from.y + from.height - grab.y), {
        steps: 12,
    });
    await page.mouse.up();
    // A drag isn't a click: the thread stays closed.
    await expect(overlay(page).locator('.thread')).toHaveCount(0);

    await page.reload();
    await expect(overlay(page).locator('.pin')).toHaveCount(1, { timeout: 15_000 });
    const to = (await overlay(page).locator('.pin .pin-body').first().boundingBox())!;
    expect(Math.abs(to.x - tip.x)).toBeLessThan(4);
    expect(Math.abs(to.y + to.height - tip.y)).toBeLessThan(4);
});

test("lists the agent's threads and opens one in the dock", async ({ page }) => {
    await openPlayground(page);
    await overlay(page).locator('.tool[title="Pins"]').click();
    await overlay(page).getByRole('button', { name: 'T3 Code', exact: true }).click();
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

    // Up there it sits over the logo link: the browser mustn't start dragging the link instead.
    const again = (await handle.boundingBox())!;
    await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await page.mouse.down();
    await page.mouse.move(1180, 660, { steps: 12 });
    await page.mouse.up();
    await expect(overlay(page).locator('.toolbar-wrap')).toHaveClass(/dock-bottom-right/);
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
    await expect(overlay(page).locator('.status-button')).toHaveAttribute(
        'aria-label',
        /^Tencil status: Claude Code/,
        {
            timeout: 15_000,
        },
    );

    await page.reload();
    await overlay(page).locator('.tool[title="Project settings"]').click();
    await expect(settings.getByRole('radio', { name: 'Claude Code' })).toBeChecked();

    await settings.getByText('T3 Code').click();
    await expect(overlay(page).locator('.status-button')).toHaveAttribute(
        'aria-label',
        /^Tencil status: T3 Code/,
    );
});

test('picks the agent and model new threads run on', async ({ page }) => {
    await openPlayground(page);
    // Pins the heading: near the top, the composer stays clear of the toolbar.
    await page.keyboard.press('c');
    await page.getByRole('heading', { level: 1 }).click();
    const composer = overlay(page).locator('.composer');
    const toggle = composer.locator('.model-toggle');
    // Nothing set in T3 Code: its first ready agent's default model.
    await expect(toggle).toHaveText('GPT Test');
    await toggle.click();
    await composer.getByRole('option', { name: 'Claude Test Mini' }).click();
    await expect(toggle).toHaveText('Claude Test Mini');

    // Saved for the project.
    await page.reload();
    await expect(overlay(page).locator('.status-dot.status-ok')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('c');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(toggle).toHaveText('Claude Test Mini');
    const input = composer.locator('textarea');
    await input.fill('Use the brand font');
    await input.press('Enter');
    await expect(overlay(page).locator('.thread .message-assistant')).toContainText('Updated it.', {
        timeout: 10_000,
    });

    // The new T3 Code thread runs on Claude.
    await overlay(page).locator('.thread').getByTitle('Close (Esc)').click();
    await overlay(page).locator('.tool[title="Pins"]').click();
    await overlay(page).getByRole('button', { name: 'T3 Code', exact: true }).click();
    const row = overlay(page).locator('.provider-item').filter({ hasText: 'Use the brand font' });
    await expect(row.getByRole('img', { name: 'Claude' })).toBeVisible();

    // Back to T3 Code's default for the tests after this one.
    await openPlayground(page);
    await page.keyboard.press('c');
    await page.getByRole('heading', { level: 1 }).click();
    await toggle.click();
    await composer.getByRole('option', { name: /^Default/ }).click();
    await expect(toggle).toHaveText('GPT Test');
});

test('queues several comments and sends them as one thread', async ({ page }) => {
    await openPlayground(page);
    const composer = overlay(page).locator('.composer');
    const batchToggle = composer.getByRole('button', { name: 'Batch' });
    const batchMode = overlay(page).getByRole('switch', { name: /Batch mode/ });
    // Batch mode is on by default, so the comment box offers the toggle right away.
    await page.keyboard.press('c');
    await page.getByRole('heading', { level: 1 }).click();
    await batchToggle.click();
    await composer.locator('textarea').fill('Make the heading bigger');
    await composer.locator('textarea').press('Enter');

    // Queued, and straight back to picking the next element.
    await expect(overlay(page).locator('.toolbar-hint')).toContainText('Click any element');
    await page.getByRole('button', { name: 'Choose Team' }).click();
    await expect(composer.locator('.composer-batch')).toHaveText('→ Batch · 1 queued');
    await composer.locator('textarea').fill('Rename to Business');
    await composer.locator('textarea').press('Enter');
    await page.keyboard.press('Escape');

    const queued = overlay(page).locator('.pin.pin-queued');
    await expect(queued).toHaveCount(2);
    // Survives a reload, and can still be rewritten before sending.
    await page.reload();
    await expect(queued).toHaveCount(2, { timeout: 15_000 });
    await queued.first().locator('.pin-body').click();
    const edit = overlay(page).locator('.thread textarea');
    await expect(edit).toHaveValue('Make the heading bigger');
    await edit.fill('Make the heading much bigger');
    await edit.press('Enter');

    await overlay(page).getByRole('button', { name: 'Send 2' }).click();
    const thread = overlay(page).locator('.thread');
    await expect(thread.locator('.message-user')).toContainText(
        /#\d+ Make the heading much bigger\s+#\d+ Rename to Business/,
    );
    await expect(thread.locator('.message-assistant')).toContainText('Updated it.', {
        timeout: 10_000,
    });
    await expect(queued).toHaveCount(0);
    await expect(overlay(page).getByRole('button', { name: /^Send \d/ })).toHaveCount(0);

    // Turning batch mode off in the settings takes the toggle away again.
    await overlay(page).locator('.tool[title="Project settings"]').click();
    await expect(batchMode).toBeChecked();
    await batchMode.click();
    await expect(batchMode).not.toBeChecked();
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(batchToggle).toHaveCount(0);
});

test("stands beside Next.js's dev tools button in its corner", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tencil:dock', 'bottom-left'));
    await openPlayground(page);
    // The same structure Next.js renders: an open shadow root holding #devtools-indicator.
    await page.evaluate(() => {
        const portal = document.createElement('nextjs-portal');
        const root = portal.attachShadow({ mode: 'open' });
        root.innerHTML =
            '<div id="devtools-indicator" style="position:fixed;left:20px;bottom:20px;width:36px;height:36px"></div>';
        document.body.append(portal);
    });
    const wrap = overlay(page).locator('.toolbar-wrap');
    await expect(wrap).toHaveCSS('left', '64px');

    // Somewhere else, no shift.
    await page.evaluate(() => {
        const indicator = document
            .querySelector('nextjs-portal')
            ?.shadowRoot?.getElementById('devtools-indicator');
        indicator?.setAttribute(
            'style',
            'position:fixed;right:20px;bottom:20px;width:36px;height:36px',
        );
    });
    await expect(wrap).toHaveCSS('left', '20px');
});
