import { test, expect } from '@playwright/test';

async function energyOf(page: any, code: string): Promise<number | null> {
    return page.evaluate(async (code: string) => {
        const ed = document.querySelector('bottom-editor') as any;
        ed.sourceCode = code;
        await ed.evaluatePython();
        return ed.energy;
    }, code);
}

test('energy counts executed user lines only', async ({ page }) => {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });

    expect(await energyOf(page, '')).toBe(0);
    expect(await energyOf(page, 'x = 3')).toBe(1);
    expect(await energyOf(page, 'x = 3\nprint(x)')).toBe(2);
    expect(await energyOf(page, '# comment\n\nx = 1')).toBe(1);
    // for-header runs once per iteration plus the final exhausted check
    expect(await energyOf(page, 'for i in range(3):\n    print(i)')).toBe(7);
    // def line once, body line per call, call line once
    expect(await energyOf(page, 'def f():\n    return 1\nf()')).toBe(3);

    // Prepended code (e.g. Kara's shim) is not counted, even when called.
    await page.evaluate(() => {
        (document.querySelector('bottom-editor') as any).codePrefix = 'def step():\n    a = 1\n    b = 2\n';
    });
    expect(await energyOf(page, 'step()\nstep()')).toBe(2);
});

test('stepmode pauses on each line and reports locals', async ({ page }) => {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });

    await page.evaluate(() => {
        const e = document.querySelector('bottom-editor') as any;
        e.stepmode = true;
        e.sourceCode = 'a = 1\nb = a + 1\nprint(b)';
        (window as any).__run = e.evaluatePython();
    });
    const paused = () => page.waitForFunction(() => (document.querySelector('bottom-editor') as any)._stepPaused);

    await paused();
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).energy)).toBe(1);

    await page.evaluate(() => { (document.querySelector('bottom-editor') as any)._doStep(); });
    await page.waitForFunction(() => (document.querySelector('bottom-editor') as any).energy === 2);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any)._stepLocals)).toEqual({ a: '1' });

    await page.evaluate(() => (document.querySelector('bottom-editor') as any)._doContinue());
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).energy)).toBe(3);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).outputText)).toContain('2');
});
