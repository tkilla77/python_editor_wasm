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
const RUN_TIMEOUT = 30_000;

/** Wait for Pyodide to finish booting on the first <bottom-editor>. */
async function waitForReady(page: any) {
    await page.waitForFunction(
        () => (document.querySelector('bottom-editor') as any)?.logText?.includes('Python Ready!'),
        { timeout: PYODIDE_TIMEOUT },
    );
}

/** Trigger evaluatePython() on the first <bottom-editor> and wait for output. */
async function runAndWait(page: any, expected: string) {
    await page.evaluate(() =>
        (document.querySelector('bottom-editor') as any)?.evaluatePython()
    );
    await page.waitForFunction(
        (exp: string) => (document.querySelector('bottom-editor') as any)?.outputText?.includes(exp),
        expected,
        { timeout: RUN_TIMEOUT },
    );
}

test.describe('<bottom-editor> smoke test', () => {
    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => { throw err; });
    });

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
        await runAndWait(page, 'Hi, world!');

        const output = await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.outputText
        );
        expect(output).toContain('Hi, world!');
    });
});

test.describe('basic print smoke', () => {
    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => { throw err; });
    });

    test('print(42) appears in output', async ({ page }) => {
        await page.goto('/tests/fixtures/basic.html');
        await waitForReady(page);
        await runAndWait(page, '42');

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

        // Run the turtle code and wait for it to finish.
        await page.evaluate(() =>
            (document.querySelector('bottom-editor') as any)?.evaluatePython()
        );
        // Wait until running state clears (buttons.running → false).
        await page.waitForFunction(
            () => {
                const el = document.querySelector('bottom-editor') as any;
                // outputText updates when done; logText always present.
                return el?.logText && !el?.logText?.includes('Initializing');
            },
            { timeout: RUN_TIMEOUT },
        );
        // Give the turtle a moment to finish drawing (speed 0 = instant, but
        // the worker still needs to flush).
        await page.waitForTimeout(500);

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
