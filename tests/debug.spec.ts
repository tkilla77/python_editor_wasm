import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // Test only: open shadow roots so the line-number gutter can be clicked.
    await page.addInitScript(() => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init: ShadowRootInit) {
            return attach.call(this, { ...init, mode: 'open' });
        };
    });
});

async function addEditor(page: any, attrs: Record<string, string>, html: string) {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(async ({ attrs, html }: any) => {
        document.querySelector('bottom-editor')!.remove();
        const e = document.createElement('bottom-editor') as any;
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as string);
        e.innerHTML = html;
        document.body.append(e);
        (window as any).__ed = e;
        await e.ready;
    }, { attrs, html });
}

const ed = '(window as any).__ed';
const get = (page: any, expr: string) => page.evaluate(`window.__ed.${expr}`);
const clickLine = (page: any, n: number) =>
    page.locator('bottom-editor .cm-lineNumbers .cm-gutterElement', { hasText: new RegExp(`^${n}$`) }).click();
const startRun = (page: any) => page.evaluate(() => { (window as any).__run = (window as any).__ed._startRun('run'); });
const finish = (page: any) => page.evaluate(() => (window as any).__run);
const pausedAt = (page: any, energy: number) =>
    page.waitForFunction((n: number) => (window as any).__ed._stepPaused && (window as any).__ed.energy === n, energy);
const continueAtMax = (page: any) => page.evaluate(() => { const e = (window as any).__ed; e._setStepSpeed(21); e._doPlay(); });

test('without breakpoints, Run is untraced and shows no step bar', async ({ page }) => {
    await addEditor(page, {}, 'import sys\nprint(sys.gettrace())');
    expect(await page.locator('bottom-editor bottom-stepbar').count()).toBe(0);
    await startRun(page);
    await finish(page);
    expect(await get(page, 'outputText')).toContain('None');
    expect(await page.locator('bottom-editor bottom-stepbar').count()).toBe(0);
});

test('a breakpoint pauses Run there; the bar appears only while debugging', async ({ page }) => {
    await addEditor(page, {}, 'a = 1\nb = 2\nc = a + b\nprint(c)');
    await clickLine(page, 3);
    await expect(page.locator('bottom-editor .cm-breakpoint')).toHaveCount(1);
    await startRun(page);
    await pausedAt(page, 3);
    expect(await get(page, '_stepLocals')).toEqual({ a: '1', b: '2' });
    await expect(page.locator('bottom-editor bottom-stepbar')).toHaveCount(1);
    await continueAtMax(page);
    await finish(page);
    expect(await get(page, 'outputText')).toContain('3');
    await expect(page.locator('bottom-editor bottom-stepbar')).toHaveCount(0);
    expect(await get(page, 'energy')).toBeNull();
});

test('a breakpoint in a loop stops on every iteration', async ({ page }) => {
    await addEditor(page, {}, 'for i in range(3):\n    x = i\nprint("done")');
    await clickLine(page, 2);
    await startRun(page);
    for (const i of ['0', '1', '2']) {
        await page.waitForFunction((i: string) => (window as any).__ed._stepPaused && (window as any).__ed._stepLocals.i === i, i);
        await continueAtMax(page);
    }
    await finish(page);
    expect(await get(page, 'outputText')).toContain('done');
});

test('breakpoints can be added while paused; blank and comment lines take none', async ({ page }) => {
    await addEditor(page, {}, 'a = 1\n\n# note\nb = 2\nc = 3\nprint("end")');
    await clickLine(page, 2);
    await clickLine(page, 3);
    await expect(page.locator('bottom-editor .cm-breakpoint')).toHaveCount(0);
    await clickLine(page, 1);
    await startRun(page);
    await pausedAt(page, 1);
    await clickLine(page, 5);
    await continueAtMax(page);
    await pausedAt(page, 3);
    expect(await get(page, '_stepLocals')).toEqual({ a: '1', b: '2' });
    await continueAtMax(page);
    await finish(page);
});

test('breakpoints survive switching to another file tab', async ({ page }) => {
    await addEditor(page, {}, 'a = 1\nb = 2<template filename="other.py">x = 0</template>');
    await clickLine(page, 2);
    await page.evaluate(() => { const e = (window as any).__ed; e._switchTab(1); });
    await expect(page.locator('bottom-editor .cm-breakpoint')).toHaveCount(0);
    await startRun(page);
    await pausedAt(page, 2);
    expect(await get(page, '_tabIdx')).toBe(0);
    await expect(page.locator('bottom-editor .cm-breakpoint')).toHaveCount(1);
    await continueAtMax(page);
    await finish(page);
});

test('nodebug ignores clicks on line numbers', async ({ page }) => {
    await addEditor(page, { nodebug: '' }, 'a = 1\nimport sys\nprint(sys.gettrace())');
    await clickLine(page, 1);
    await expect(page.locator('bottom-editor .cm-breakpoint')).toHaveCount(0);
    await startRun(page);
    await finish(page);
    expect(await get(page, 'outputText')).toContain('None');
});

test('stepmode: the bar is always there and Run plays line by line', async ({ page }) => {
    await addEditor(page, { stepmode: '' }, 'a = 1\nb = 2\nc = 3\nprint("end")');
    await expect(page.locator('bottom-editor bottom-stepbar')).toHaveCount(1);
    await page.evaluate(() => (window as any).__ed._setStepSpeed(20));
    const started = Date.now();
    await startRun(page);
    await page.waitForFunction(() => (window as any).__ed._stepPlaying);
    await finish(page);
    expect(Date.now() - started).toBeGreaterThan(150); // 4 lines at 20/s
    expect(await get(page, 'outputText')).toContain('end');
    expect(await get(page, 'energy')).toBe(4);
});

test('stepmode: Play stops at a breakpoint', async ({ page }) => {
    await addEditor(page, { stepmode: '' }, 'a = 1\nb = 2\nc = 3\nprint("end")');
    await page.evaluate(() => (window as any).__ed._setStepSpeed(20));
    await clickLine(page, 3);
    await startRun(page);
    await pausedAt(page, 3);
    await page.waitForTimeout(300);
    expect(await get(page, '_stepPlaying')).toBe(false);
    expect(await get(page, 'energy')).toBe(3);
    await continueAtMax(page);
    await finish(page);
});
