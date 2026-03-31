/**
 * Smoke test for <bottom-editor>.
 *
 * Strategy: access the component's public JS properties/methods from
 * page.evaluate() rather than querying into the closed shadow root.
 *
 * Run:  npx playwright test
 * Prereq: npx playwright install chromium  (once)
 */
import { test, expect } from '@playwright/test';

// Convenience: reach into the first <bottom-editor> on the page.
const editorProp = (prop: string) =>
    `document.querySelector('bottom-editor')?.${prop}`;

test.describe('<bottom-editor> smoke test', () => {
    test.beforeEach(async ({ page }) => {
        // Capture and fail on any unhandled JS errors.
        page.on('pageerror', err => { throw err; });
    });

    test('element is defined and mounts on embed.html', async ({ page }) => {
        await page.goto('/embed.html');

        // Custom element must be registered.
        const defined = await page.evaluate(() =>
            customElements.get('bottom-editor') !== undefined
        );
        expect(defined).toBe(true);

        // Element must be in the DOM.
        await expect(page.locator('bottom-editor')).toBeAttached();
    });

    test('initialises Python and reflects initial source code', async ({ page }) => {
        await page.goto('/embed.html');

        // Wait for Pyodide to finish booting — can take up to 60 s on first load.
        await page.waitForFunction(
            () => (document.querySelector('bottom-editor') as any)?.logText?.includes('Python Ready!'),
            { timeout: 75_000 },
        );

        // The embed.html source code should be readable via the public getter.
        const src = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.sourceCode
        );
        expect(src).toContain('greet');
    });

    test('runs Python code and shows output', async ({ page }) => {
        await page.goto('/embed.html');

        await page.waitForFunction(
            () => (document.querySelector('bottom-editor') as any)?.logText?.includes('Python Ready!'),
            { timeout: 75_000 },
        );

        // Trigger the run programmatically via the public method.
        await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.evaluatePython()
        );

        // embed.html calls greet('world') → prints 'Hi, world!'
        await page.waitForFunction(
            () => (document.querySelector('bottom-editor') as any)?.outputText?.includes('Hi, world!'),
            { timeout: 30_000 },
        );

        const output = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.outputText
        );
        expect(output).toContain('Hi, world!');
    });
});
