/**
 * Smoke tests for <bottom-editor>.
 *
 * Strategy: access the component's public JS properties/methods from
 * page.evaluate() rather than querying into the closed shadow root.
 *
 * Run:  npx playwright test
 * Prereq: npx playwright install chromium  (once)
 */
import { test, expect } from '@playwright/test';

const PYODIDE_TIMEOUT = 75_000;

/** Wait for Pyodide to finish booting on the first <bottom-editor>. */
async function waitForReady(page: any) {
    await page.waitForFunction(
        () => (document.querySelector('bottom-editor') as any)?.logText?.includes('Python Ready!'),
        { timeout: PYODIDE_TIMEOUT },
    );
}

/** Run the first editor and wait for the Python execution to complete. */
async function runAndAwait(page: any) {
    // page.evaluate can resolve a Promise returned from the browser context,
    // so awaiting evaluatePython() here blocks until the run is fully done.
    await page.evaluate(async () =>
        (document.querySelector('bottom-editor') as any)?.evaluatePython()
    );
}

test.describe('<bottom-editor> smoke test', () => {
    // Note: no pageerror handler here — embed.html has autorun editors that
    // install packages (matplotlib, cv2) and may produce non-fatal worker logs.

    test('element is defined and mounts on embed.html', async ({ page }) => {
        await page.goto('/embed.html');

        const defined = await page.evaluate(() =>
            customElements.get('bottom-editor') !== undefined
        );
        expect(defined).toBe(true);
        await expect(page.locator('bottom-editor')).toBeAttached();
    });

    test('initialises Python and reflects initial source code', async ({ page }) => {
        await page.goto('/embed.html');
        await waitForReady(page);

        const src = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.sourceCode
        );
        expect(src).toContain('greet');
    });

    test('runs Python code and shows output', async ({ page }) => {
        await page.goto('/embed.html');
        await waitForReady(page);

        // First editor defines greet() but prints nothing.
        // Set code to something that produces output, then run it.
        await page.evaluate(() => {
            const el = document.querySelector('bottom-editor') as any;
            el.replaceDoc("print('hello from test')");
        });
        await runAndAwait(page);

        const output = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.outputText
        );
        expect(output).toContain('hello from test');
    });
});

test.describe('basic print smoke', () => {
    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => { throw err; });
    });

    test('print(42) appears in output', async ({ page }) => {
        await page.goto('/tests/fixtures/basic.html');
        await waitForReady(page);
        await runAndAwait(page);

        const output = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.outputText
        );
        expect(output).toContain('42');
    });
});

test.describe('turtle canvas smoke', () => {
    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => { throw err; });
    });

    test('forward(10) draws a black line on the canvas', async ({ page }) => {
        await page.goto('/tests/fixtures/turtle.html');
        await waitForReady(page);

        // Await the run directly — resolves only when Python execution is done.
        await runAndAwait(page);

        // turtle forward(10) heading east: world (0,0)→(10,0)
        // _tc maps world→canvas: (CANVAS_SIZE/2 + x, CANVAS_SIZE/2 - y)
        //   start: (1000, 1000), end: (1010, 1000), midpoint: (1005, 1000)
        const pixel = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.samplePixel(1005, 1000)
        );

        // The midpoint of the line must be opaque (drawn).
        expect(pixel.a).toBeGreaterThan(200);
        // Default pen colour is black.
        expect(pixel.r).toBeLessThan(50);
        expect(pixel.g).toBeLessThan(50);
        expect(pixel.b).toBeLessThan(50);

        // A point well off the line must be blank.
        const blank = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.samplePixel(500, 500)
        );
        expect(blank.a).toBe(0);
    });
});
