import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // Test only: open shadow roots to reach the editor inside <kara-editor>.
    await page.addInitScript(() => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init: ShadowRootInit) {
            return attach.call(this, { ...init, mode: 'open' });
        };
    });
});

const inner = 'document.querySelector("kara-editor-page").shadowRoot.querySelector("kara-editor").shadowRoot.querySelector("bottom-editor")';

async function karaEditor(page: any, step: number) {
    await page.goto(`/kara.html?step=${step}`);
    await page.waitForFunction(`${inner}?.ready`);
    await page.evaluate(`${inner}.ready`);
}

async function runKara(page: any, code: string): Promise<string> {
    return page.evaluate(async ({ sel, code }: any) => {
        const ed = eval(sel);
        ed.sourceCode = code;
        await ed.evaluatePython();
        return ed.outputText;
    }, { sel: inner, code });
}

test('Kara functions work as plain Python functions (map, sorted, recursion)', async ({ page }) => {
    await karaEditor(page, 0);
    const out = await runKara(page, [
        'def go(n):',
        '    for _ in range(n):',
        '        kara.move()',
        '    return n',
        'def walk(n):',
        '    if n > 0:',
        '        kara.move()',
        '        walk(n - 1)',
        'list(map(go, [1]))',
        'sorted([1], key=go)',
        'walk(1)',
        'print("x =", kara.x)',
    ].join('\n'));
    expect(out).not.toContain('Error');
    expect(out).toMatch(/x = \d+/);
});

test('the line Kara is executing is highlighted during the animation', async ({ page }) => {
    await karaEditor(page, 400);
    await page.evaluate(({ sel }: any) => {
        const ed = eval(sel);
        ed.sourceCode = 'x = 1\nkara.turnLeft()\nkara.turnRight()';
        (window as any).__run = ed.evaluatePython();
    }, { sel: inner });
    const highlighted = `${inner}.shadowRoot.querySelector(".cm-step-line")?.textContent`;
    await page.waitForFunction(`${highlighted} === "kara.turnLeft()"`);
    await page.waitForFunction(`${highlighted} === "kara.turnRight()"`);
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(`${inner}.shadowRoot.querySelector(".cm-step-line")`)).toBeNull();
});

test('plain statements are not slowed down by the Kara delay', async ({ page }) => {
    await karaEditor(page, 500);
    const started = Date.now();
    const out = await runKara(page, 's = 0\nfor i in range(10000):\n    s += i\nprint(s)');
    expect(out).toContain('49995000');
    expect(Date.now() - started).toBeLessThan(2000);
});

test('kara-exercise tests run against the moved Kara', async ({ page }) => {
    await page.goto('/kara.html');
    const report = await page.evaluate(async () => {
        const k = document.createElement('kara-exercise') as any;
        k.step = 0;
        k.code = 'start = kara.x\nkara.move()';
        k.testCode = 'assert kara.x == start + 1';
        document.body.append(k);
        await k.updateComplete;
        const ex = k.shadowRoot.querySelector('bottom-exercise');
        await ex.updateComplete;
        await ex.shadowRoot.querySelector('bottom-editor').ready;
        await ex.runTests();
        return ex._testReport;
    });
    expect(report.passed).toBe(true);
});

test('breakpoints work in Kara code alongside the animation delay', async ({ page }) => {
    await karaEditor(page, 100);
    await page.evaluate(({ sel }: any) => {
        const ed = eval(sel);
        ed.sourceCode = 'kara.turnLeft()\nkara.turnRight()\nprint("done")';
        ed._restoreBreakpoints([2]);
        (window as any).__run = ed._startRun('run');
    }, { sel: inner });
    await page.waitForFunction(`${inner}._stepPaused`);
    expect(await page.evaluate(`${inner}.shadowRoot.querySelector(".cm-step-line")?.textContent`)).toMatch(/^kara\.turnRight\(\)/);
    await page.evaluate(`${inner}._doStep()`);
    await page.waitForFunction(`${inner}._stepPaused && ${inner}.shadowRoot.querySelector(".cm-step-line")?.textContent.startsWith('print("done")')`);
    await page.evaluate(`(() => { const e = ${inner}; e._setStepSpeed(21); e._doPlay(); })()`);
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(`${inner}.outputText`)).toContain('done');
});
