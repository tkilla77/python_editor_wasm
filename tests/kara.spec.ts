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

const HELPER = 'def go(n):\n    for _ in range(n):\n        kara.move()';

/** A fresh <kara-editor> with a helper.py template; returns once Python is ready. */
async function karaWithHelper(page: any, step: number) {
    await page.goto('/kara.html');
    await page.evaluate(async ({ step, helper }: any) => {
        document.querySelector('kara-editor-page')!.remove();
        const k = document.createElement('kara-editor') as any;
        k.setAttribute('step', String(step));
        k.innerHTML = 'from helper import go\nstart = kara.x\ngo(2)\nprint("moved", kara.x - start)'
            + `<template filename="helper.py">${helper}</template>`;
        document.body.append(k);
        await k.updateComplete;
        (window as any).__ed = k.shadowRoot.querySelector('bottom-editor');
        await (window as any).__ed.ready;
    }, { step, helper: HELPER });
}

test('Kara can be moved from a helper module in another file tab', async ({ page }) => {
    await karaWithHelper(page, 250);
    expect(await page.evaluate(() => (window as any).__ed.files.map((f: any) => f.name))).toEqual(['main.py', 'helper.py']);
    await page.evaluate(() => { (window as any).__run = (window as any).__ed.evaluatePython(); });
    // Moves inside the helper highlight the main-file line that called it.
    await page.waitForFunction(() => (window as any).__ed.shadowRoot.querySelector('.cm-step-line')?.textContent === 'go(2)');
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(() => (window as any).__ed.outputText)).toContain('moved 2');
});

test('kara-editor permalink carries extra files', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as any).__clip = t; } } });
    });
    await karaWithHelper(page, 0);
    await page.evaluate(async () => {
        const ed = (window as any).__ed;
        ed._switchTab(1); ed.replaceDoc('def go(n):\n    kara.turnLeft()'); ed._switchTab(0);
        await ed.copyPermalink();
    });
    const url = new URL(await page.evaluate(() => (window as any).__clip));
    await page.goto(url.pathname.replace('/editor/stable', '') + url.search);
    const inner = 'document.querySelector("kara-editor-page").shadowRoot.querySelector("kara-editor").shadowRoot.querySelector("bottom-editor")';
    await page.waitForFunction(`${inner}?.files.length === 2`);
    expect(await page.evaluate(`${inner}.files[1]`)).toEqual({ name: 'helper.py', code: 'def go(n):\n    kara.turnLeft()' });
    await page.evaluate(`${inner}.ready`);
    await page.evaluate(`${inner}.revertCode()`);
    expect(await page.evaluate(`${inner}.files[1].code`)).toBe(HELPER);
});

test('kara-exercise supports extra files, in tests and permalinks', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as any).__clip = t; } } });
    });
    await page.goto('/kara.html');
    const report = await page.evaluate(async (helper: string) => {
        const k = document.createElement('kara-exercise') as any;
        k.step = 0;
        k.innerHTML = 'from helper import go\nstart = kara.x\ngo(3)'
            + `<template filename="helper.py">${helper}</template>`
            + '<kara-tests>assert kara.x == start + 3</kara-tests>';
        document.body.append(k);
        await k.updateComplete;
        const ex = k.shadowRoot.querySelector('bottom-exercise');
        await ex.updateComplete;
        await ex.shadowRoot.querySelector('bottom-editor').ready;
        await ex.runTests();
        await k._permalink();
        return ex._testReport;
    }, HELPER);
    expect(report.passed).toBe(true);

    const url = new URL(await page.evaluate(() => (window as any).__clip));
    await page.goto(url.pathname.replace('/editor/stable', '') + url.search);
    const inner = 'document.querySelector("kara-editor-page").shadowRoot.querySelector("kara-exercise").shadowRoot.querySelector("bottom-exercise").shadowRoot.querySelector("bottom-editor")';
    await page.waitForFunction(`${inner}?.files.length === 2`);
    expect(await page.evaluate(`${inner}.files[1]`)).toEqual({ name: 'helper.py', code: HELPER });
});
