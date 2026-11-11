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
    // By its label: the workspace's folder name may contain "daemon" too.
    const daemonRow = card
        .locator('.status-card-row')
        .filter({ has: page.locator('dt', { hasText: /^Daemon$/ }) });
    await expect(daemonRow).toContainText('Connected');
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

test('keeps a pin dragged past the window edge at that edge', async ({ page }) => {
    await openPlayground(page);
    const pin = overlay(page).locator('.pin .pin-body').first();
    const from = (await pin.boundingBox())!;
    const grab = { x: from.x + 6, y: from.y + from.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    // The tip sits left of the pointer, so this puts it outside the window.
    await page.mouse.move(2, 300, { steps: 12 });
    await page.mouse.up();

    await page.reload();
    await expect(overlay(page).locator('.pin')).toHaveCount(1, { timeout: 15_000 });
    const to = (await overlay(page).locator('.pin .pin-body').first().boundingBox())!;
    expect(to.x).toBeLessThan(4);
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
    await overlay(page).locator('.tool[title="Settings"]').click();
    await settings.getByRole('button', { name: 'Agent', exact: true }).click();
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
    await overlay(page).locator('.tool[title="Settings"]').click();
    await settings.getByRole('button', { name: 'Agent', exact: true }).click();
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
    await overlay(page).locator('.tool[title="Settings"]').click();
    await overlay(page).getByRole('button', { name: 'Tools' }).click();
    await expect(batchMode).toBeChecked();
    await batchMode.click();
    await expect(batchMode).not.toBeChecked();
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(batchToggle).toHaveCount(0);
});

test("opens settings on the project's page, with how it was detected", async ({ page }) => {
    await openPlayground(page);
    await overlay(page).locator('.tool[title="Settings"]').click();
    const panel = overlay(page).locator('.settings-panel');
    const nav = panel.locator('.settings-nav-project');
    await expect(nav).toHaveText('Project');
    await expect(nav).toHaveAttribute('aria-current', 'page');

    // The playground loads Tencil through the Vite plugin, which passes its git root.
    const detection = panel.locator('.detection');
    await expect(detection.locator('.detection-badge')).toHaveText('Automatic');
    await expect(detection).toContainText('the Vite or Next.js plugin passed along');
    await detection.getByRole('button', { name: 'Change' }).click();
    await expect(panel.locator('.detection-search')).toBeFocused();
    await expect(panel.locator('.detection-list')).toContainText(/No other projects|\//);
    await detection.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel.locator('.detection-picker')).toHaveCount(0);
});

test('hides the whole dock from settings and brings it back with Alt+T', async ({ page }) => {
    await openPlayground(page);
    await pinElement(page, 'Choose Pro', 'Round the corners');
    const toolbar = overlay(page).locator('.toolbar');
    // Earlier tests leave pins in the shared store: count from here.
    const pins = overlay(page).locator('.pin');
    await expect(overlay(page).locator('.pin[title$="Round the corners"]')).toHaveCount(1);
    const count = await pins.count();

    await overlay(page).locator('.tool[title="Settings"]').click();
    await overlay(page).getByRole('button', { name: 'Dock' }).click();
    await overlay(page)
        .getByRole('switch', { name: /Hide the dock/ })
        .click();
    await expect(toolbar).toHaveCount(0);
    await expect(pins).toHaveCount(0);
    await expect(overlay(page).getByRole('status')).toContainText('Tencil is hidden');

    // Hidden, the other shortcuts leave the page alone, and it stays hidden across reloads.
    await page.keyboard.press('c');
    await expect(overlay(page).locator('.toolbar-hint')).toHaveCount(0);
    const mounted = page.waitForEvent('console', message =>
        message.text().startsWith('Tencil is hidden'),
    );
    await page.reload();
    await mounted;
    await expect(toolbar).toHaveCount(0);

    await page.keyboard.press('Alt+t');
    await expect(toolbar).toBeVisible({ timeout: 15_000 });
    await expect(pins).toHaveCount(count);
    await page.keyboard.press('Alt+t');
    await expect(toolbar).toHaveCount(0);
    await overlay(page).getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(toolbar).toBeVisible();
});

test('records a new Comment shortcut, uses it, swaps and resets', async ({ page }) => {
    await openPlayground(page);
    const panel = overlay(page).locator('.settings-panel');
    const hint = overlay(page).locator('.toolbar-hint');
    const commentKey = panel.getByRole('button', { name: 'Comment', exact: true });
    const rulerKey = panel.getByRole('button', { name: 'Ruler', exact: true });
    await overlay(page).locator('.tool[title="Settings"]').click();
    await panel.getByRole('button', { name: 'Shortcuts' }).click();
    await expect(commentKey).toHaveText('C');

    // Shortcuts the browser needs are refused, with the reason.
    await commentKey.click();
    await page.keyboard.press('Control+w');
    await expect(panel.getByRole('alert')).toContainText('already uses');

    await page.keyboard.press('Shift+K');
    await expect(commentKey).toHaveText(/^(⇧K|Shift\+K)$/);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // The new key works straight away, and the old one leaves the page alone.
    await expect(overlay(page).locator('.tool[title^="Comment"] kbd')).toHaveText(/K$/);
    await page.keyboard.press('c');
    await expect(hint).toHaveCount(0);
    await page.keyboard.press('Shift+K');
    await expect(hint).toContainText('Click any element');
    await page.keyboard.press('Escape');

    // Taking a key another action has asks first, then swaps them.
    await overlay(page).locator('.tool[title="Settings"]').click();
    await rulerKey.click();
    await page.keyboard.press('Shift+K');
    await expect(panel.getByRole('alert')).toContainText('already used for Comment');
    await panel.getByRole('button', { name: 'Swap' }).click();
    await expect(rulerKey).toHaveText(/K$/);
    await expect(commentKey).toHaveText('R');

    await panel.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(commentKey).toHaveText('C');
    await expect(rulerKey).toHaveText('R');
});

test('starts dark and saves the theme on the machine, not just the browser', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openPlayground(page);
    const root = overlay(page).locator('.root');
    await expect(root).toHaveClass(/\bdark\b/);

    await overlay(page).locator('.tool[title="Settings"]').click();
    await overlay(page).getByRole('button', { name: 'Appearance' }).click();
    await overlay(page).locator('.settings-segmented label', { hasText: 'Light' }).click();
    await expect(root).not.toHaveClass(/\bdark\b/);

    // With the browser's copy gone, the daemon still has it: it applies once connected.
    await page.evaluate(() => localStorage.removeItem('tencil:theme'));
    await page.reload();
    await expect(overlay(page).locator('.status-dot.status-ok')).toBeVisible({ timeout: 15_000 });
    await expect(root).not.toHaveClass(/\bdark\b/);

    // System follows the browser, live.
    await overlay(page).locator('.tool[title="Settings"]').click();
    await overlay(page).getByRole('button', { name: 'Appearance' }).click();
    await overlay(page).locator('.settings-segmented label', { hasText: 'System' }).click();
    await expect(root).not.toHaveClass(/\bdark\b/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(root).toHaveClass(/\bdark\b/);

    // The daemon is shared by the tests that follow.
    await overlay(page).locator('.settings-segmented label', { hasText: 'Dark' }).click();
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

test('measures spacing with Alt and sends it with the comment', async ({ page }) => {
    const sent: string[] = [];
    page.on('websocket', socket =>
        socket.on('framesent', frame => {
            if (typeof frame.payload === 'string') sent.push(frame.payload);
        }),
    );
    await openPlayground(page);
    const card = page.locator('article', { has: page.getByRole('button', { name: 'Choose Pro' }) });
    const button = card.getByRole('button', { name: 'Choose Pro' });

    // Hovering shows the box model once the ruler is on: the button's padding, the card's gap.
    await overlay(page).getByRole('button', { name: 'Ruler', exact: true }).click();
    await overlay(page).locator('.tool[title="Comment (C)"]').click();
    await button.hover();
    await expect(overlay(page).locator('.band-value-padding')).toHaveText(['12', '20', '12', '20']);
    await card.hover({ position: { x: 4, y: 4 } });
    await expect(overlay(page).locator('.band-value-gap').first()).toHaveText('12');

    // Alt: distances to the parent instead, without moving the mouse.
    await button.hover();
    await page.keyboard.down('Alt');
    await expect(overlay(page).locator('.band')).toHaveCount(0);
    // The card's 1px border plus its 24px padding.
    await expect(overlay(page).locator('.guide-value').filter({ hasText: /^25$/ })).toHaveCount(3);

    // Alt-click pins it with the spacing to its parent.
    await button.click({ modifiers: ['Alt'] });
    await page.keyboard.up('Alt');
    const measured = overlay(page).locator('.composer-measure');
    await expect(measured).toContainText('Parent');
    await expect(measured).toContainText('25 right, 25 below, 25 left');

    // With the comment open, Alt-click another element to measure against it instead.
    const heading = card.getByRole('heading', { name: 'Pro' });
    await heading.hover();
    await page.keyboard.down('Alt');
    await expect(overlay(page).locator('.measure-target')).toHaveCount(1);
    await heading.click({ modifiers: ['Alt'] });
    await page.keyboard.up('Alt');
    await expect(measured).toContainText('h2');
    await expect(measured).not.toContainText('Parent');

    const composer = overlay(page).locator('.composer textarea');
    await expect(composer).toBeFocused();
    await composer.fill('Move the button closer to the heading');
    await composer.press('Enter');

    await expect
        .poll(() =>
            sent.map(text => JSON.parse(text)).find(message => message.type === 'thread.create'),
        )
        .toMatchObject({
            context: {
                box: { padding: [12, 20, 12, 20] },
                spacing: { to: expect.stringContaining('h2'), top: expect.any(Number) },
            },
        });
});

test('starts with the ruler off and hides it in settings', async ({ page }) => {
    await openPlayground(page);
    const ruler = overlay(page).getByRole('button', { name: 'Ruler', exact: true });
    await expect(ruler).toHaveAttribute('aria-pressed', 'false');

    // Off: picking shows a plain highlight, and Alt measures nothing.
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Choose Pro' }).hover();
    await expect(overlay(page).locator('.highlight')).toBeVisible();
    await expect(overlay(page).locator('.band')).toHaveCount(0);
    await page.keyboard.down('Alt');
    await expect(overlay(page).locator('.guide')).toHaveCount(0);
    await page.keyboard.up('Alt');
    await page.keyboard.press('Escape');

    // Turned on (R), it stays on across reloads.
    await page.keyboard.press('r');
    await expect(ruler).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(ruler).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

    // The project setting takes the button away altogether.
    await overlay(page).locator('.tool[title="Settings"]').click();
    await overlay(page).getByRole('button', { name: 'Tools' }).click();
    const setting = overlay(page).getByRole('switch', { name: /Ruler/ });
    await expect(setting).toBeChecked();
    await setting.click();
    await expect(ruler).toHaveCount(0);
    await setting.click();
    await expect(ruler).toHaveCount(1);
});

test('measures with Alt outside comment mode and comments on the selection', async ({ page }) => {
    const sent: string[] = [];
    page.on('websocket', socket =>
        socket.on('framesent', frame => {
            if (typeof frame.payload === 'string') sent.push(frame.payload);
        }),
    );
    await openPlayground(page);
    await overlay(page).getByRole('button', { name: 'Ruler', exact: true }).click();
    const card = page.locator('article', { has: page.getByRole('button', { name: 'Choose Pro' }) });
    const button = card.getByRole('button', { name: 'Choose Pro' });

    // Without comment mode: nothing until Alt, then the box model and distances to the parent.
    await button.hover();
    await expect(overlay(page).locator('.highlight')).toHaveCount(0);
    await page.keyboard.down('Alt');
    await expect(overlay(page).locator('.band-value-padding')).toHaveText(['12', '20', '12', '20']);
    await expect(overlay(page).locator('.guide-value').filter({ hasText: /^25$/ })).toHaveCount(3);

    // Alt-click selects the button to measure from; Alt-hover measures to the heading.
    await button.click({ modifiers: ['Alt'] });
    await expect(overlay(page).locator('.measure-box')).toHaveCount(1);
    await card.getByRole('heading', { name: 'Pro' }).hover();
    await expect(overlay(page).locator('.measure-target')).toHaveCount(1);
    await page.keyboard.up('Alt');
    await expect(overlay(page).locator('.toolbar-hint')).toContainText('C to comment');

    // C comments on the selection, with the spacing it measured.
    await page.keyboard.press('c');
    await expect(overlay(page).locator('.composer-measure')).toContainText('h2');
    const composer = overlay(page).locator('.composer textarea');
    await composer.fill('Tighten the space above the button');
    await composer.press('Enter');
    await expect
        .poll(() =>
            sent.map(text => JSON.parse(text)).find(message => message.type === 'thread.create'),
        )
        .toMatchObject({
            context: { tagName: 'button', spacing: { to: expect.stringContaining('h2') } },
        });
});

test('shows the version in settings and offers the update, with a fallback when it fails', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openPlayground(page);
    // The fake registry says 99.0.0 is out: the settings button gets a dot.
    const button = overlay(page).locator('.tool[title="Settings"]');
    await expect(button.locator('.tool-dot')).toBeVisible();
    await button.click();
    await overlay(page).getByRole('button', { name: 'About (update available)' }).click();

    const about = overlay(page).getByRole('region', { name: 'About Tencil' });
    await expect(about.locator('.settings-version')).toHaveText(/^v\d+\.\d+\.\d+/);
    await expect(about).toContainText('Tencil 99.0.0 is available.');
    await expect(about.getByRole('link', { name: "What's new" })).toHaveAttribute(
        'href',
        /CHANGELOG\.md$/,
    );

    // It has no package to install, so the update fails and the old daemon stays.
    await about.getByRole('button', { name: 'Update' }).click();
    const failure = about.getByRole('alert');
    await expect(failure).toContainText("Couldn't update", { timeout: 60_000 });
    await expect(failure).toContainText('is still running');
    await expect(failure.locator('code')).toHaveText('npx tencil@latest setup');
    await expect(overlay(page).locator('.status-dot.status-ok')).toBeVisible();
    await expect(button.locator('.tool-dot')).toHaveCount(0);

    await failure.getByRole('button', { name: 'Copy' }).click();
    await expect(failure.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'npx tencil@latest setup',
    );
    await expect(about.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('resolves every done pin on the page at once', async ({ page }) => {
    await openPlayground(page);
    await pinElement(page, 'Choose Team', 'Rename to Business');
    await expect(overlay(page).locator('.thread .message-assistant')).toContainText('Updated it.', {
        timeout: 10_000,
    });
    await page.keyboard.press('Escape');
    // Only finished pins are resolved, so wait for this one to finish too.
    await expect(overlay(page).locator('.pin-working')).toHaveCount(0);

    await overlay(page).locator('.tool[title="Pins"]').click();
    const resolve = overlay(page).getByRole('button', { name: /^Resolve \d+ done$/ });
    await expect(resolve).toBeVisible();
    await resolve.click();
    await expect(resolve).toHaveCount(0);
    await expect(overlay(page).locator('.inbox-item')).toHaveCount(0);
    await expect(overlay(page).locator('.pin:not(.pin-leaving)')).toHaveCount(0);
});
