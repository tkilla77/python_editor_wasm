import { test, expect } from '@playwright/test';

/** Open all shadow roots (test only) so locators can reach inner editors, and capture clipboard writes. */
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init: ShadowRootInit) {
            return attach.call(this, { ...init, mode: 'open' });
        };
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: async (t: string) => { (window as any).__clip = t; } },
        });
    });
});

/** Turn a copied production permalink into a path on the dev server. */
async function copied(page: any): Promise<string> {
    await page.waitForFunction(() => (window as any).__clip);
    const url = new URL(await page.evaluate(() => (window as any).__clip));
    return url.pathname.replace('/editor/stable', '') + url.search;
}

test('editor permalink keeps stepmode and showenergy', async ({ page }) => {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(async () => {
        const e = document.querySelector('bottom-editor') as any;
        await e.updateComplete;
        e.stepmode = true;
        e.showenergy = true;
        await e.copyPermalink();
    });
    const path = await copied(page);
    expect(path).toContain('stepmode=1');
    await page.goto(path);
    const ed = page.locator('bottom-editor-page bottom-editor');
    await expect(ed).toHaveAttribute('stepmode', '');
    await expect(ed).toHaveAttribute('showenergy', '');
});

test('exercise permalink keeps stepmode, showenergy, maxenergy, maxmemory', async ({ page }) => {
    await page.goto('/exercise.html');
    await page.evaluate(async () => {
        const ex = document.createElement('bottom-exercise') as any;
        ex.code = 'x = 1';
        ex.tests = 'assert x == 1';
        Object.assign(ex, { stepmode: true, showenergy: true, maxenergy: 5, maxmemory: 3 });
        document.body.append(ex);
        await ex.updateComplete;
        await ex.shareExercise();
    });
    await page.goto(await copied(page));
    const ex = page.locator('bottom-exercise');
    await expect(ex).toHaveAttribute('stepmode', '');
    await expect(ex).toHaveAttribute('showenergy', '');
    await expect(ex).toHaveAttribute('maxenergy', '5');
    await expect(ex).toHaveAttribute('maxmemory', '3');
    await expect(ex.locator('bottom-editor')).toHaveAttribute('stepmode', '');
});

test('kara-editor permalink keeps stepmode and showenergy', async ({ page }) => {
    await page.goto('/kara.html');
    const kara = page.locator('kara-editor');
    await kara.evaluate(async (k: any) => {
        k.stepmode = true;
        k.showenergy = true;
        await k.updateComplete;
        k._permalink();
    });
    await page.goto(await copied(page));
    await expect(page.locator('kara-editor bottom-editor')).toHaveAttribute('stepmode', '');
    await expect(page.locator('kara-editor bottom-editor')).toHaveAttribute('showenergy', '');
});

test('kara-exercise permalink keeps step and energy settings', async ({ page }) => {
    await page.goto('/kara.html');
    await page.evaluate(async () => {
        const k = document.createElement('kara-exercise') as any;
        Object.assign(k, { stepmode: true, showenergy: true, maxenergy: 50, maxmemory: 4 });
        document.body.append(k);
        await k.updateComplete;
        await k._permalink();
    });
    await page.goto(await copied(page));
    const ex = page.locator('kara-exercise bottom-exercise');
    await expect(ex).toHaveAttribute('maxenergy', '50');
    await expect(ex).toHaveAttribute('maxmemory', '4');
    await expect(ex.locator('bottom-editor')).toHaveAttribute('stepmode', '');
    await expect(ex.locator('bottom-editor')).toHaveAttribute('showenergy', '');
});
