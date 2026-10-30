import { test, expect } from '@playwright/test';

/** Serve pages like a typical embedding site: no COOP/COEP, so no SharedArrayBuffer. */
async function withoutIsolation(page: any) {
    await page.route('**/*', async (route: any) => {
        const res = await route.fetch();
        const headers = { ...res.headers() };
        delete headers['cross-origin-opener-policy'];
        delete headers['cross-origin-embedder-policy'];
        await route.fulfill({ response: res, headers });
    });
}

async function energyOf(page: any, code: string): Promise<number | null> {
    return page.evaluate(async (code: string) => {
        const ed = document.querySelector('bottom-editor') as any;
        ed.sourceCode = code;
        await ed.evaluatePython();
        return ed.energy;
    }, code);
}

test('without showenergy, no trace is installed and no energy reported', async ({ page }) => {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });

    const res = await page.evaluate(async () => {
        const ed = document.querySelector('bottom-editor') as any;
        ed.sourceCode = 'import sys\nprint(sys.gettrace())';
        await ed.evaluatePython();
        return { out: ed.outputText, energy: ed.energy };
    });
    expect(res.out).toContain('None');
    expect(res.energy).toBeNull();
});

test('energy counts executed user lines only', async ({ page }) => {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });
    await page.evaluate(() => { (document.querySelector('bottom-editor') as any).showenergy = true; });

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
    await withoutIsolation(page);
    await page.goto('/tests/fixtures/basic.html');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });

    await page.evaluate(() => {
        const e = document.querySelector('bottom-editor') as any;
        e.stepmode = true;
        e.sourceCode = 'a = 1\nb = a + 1\nprint(b)';
        (window as any).__run = e._startRun('step');
    });
    const paused = () => page.waitForFunction(() => (document.querySelector('bottom-editor') as any)._stepPaused);

    await paused();
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).energy)).toBe(1);

    await page.evaluate(() => { (document.querySelector('bottom-editor') as any)._doStep(); });
    await page.waitForFunction(() => (document.querySelector('bottom-editor') as any).energy === 2);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any)._stepLocals)).toEqual({ a: '1' });

    await page.evaluate(() => {
        const e = document.querySelector('bottom-editor') as any;
        e._setStepSpeed(21);  // max: run the rest at full speed
        e._doPlay();
    });
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).energy)).toBe(3);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).outputText)).toContain('2');
});

test('exercises count energy only when maxenergy or energy() is used', async ({ page }) => {
    await page.goto('/exercise.html');
    const run = (attrs: { maxenergy?: number; tests: string }) => page.evaluate(async ({ maxenergy, tests }) => {
        const ex = document.createElement('bottom-exercise') as any;
        ex.code = 'total = 0\nfor i in range(3):\n    total += i';
        ex.tests = tests;
        if (maxenergy) ex.maxenergy = maxenergy;
        document.body.append(ex);
        await ex.updateComplete;
        await ex.renderRoot.querySelector('bottom-editor').ready;
        await ex.runTests();
        const r = ex._testReport;
        ex.remove();
        return { energy: r.energy ?? null, results: r.results.map((x: any) => [x.test, x.passed]) };
    }, attrs);

    expect((await run({ tests: 'assert total == 3' })).energy).toBeNull();
    expect(await run({ tests: 'assert energy() == 8' })).toEqual({ energy: 8, results: [['assert energy() == 8', true]] });
    expect(await run({ maxenergy: 5, tests: 'assert total == 3' })).toEqual({
        energy: 8, results: [['assert total == 3', true], ['energy() <= 5', false]],
    });
});

test('pause stops a full-speed run, stop ends a paused run', async ({ page }) => {
    await withoutIsolation(page);
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });
    const ed = 'document.querySelector("bottom-editor")';

    await page.evaluate(() => {
        const e = document.querySelector('bottom-editor') as any;
        e.stepmode = true;
        e.sourceCode = 'n = 0\nwhile True:\n    n += 1';
        (window as any).__run = e._startRun('step');
    });
    await page.waitForFunction(`${ed}._stepPaused`);
    await page.evaluate(() => { const e = document.querySelector('bottom-editor') as any; e._setStepSpeed(21); e._doPlay(); });
    await page.waitForFunction(`!${ed}._stepPaused`);
    await page.waitForTimeout(300);
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)._doPlay());  // pause
    await page.waitForFunction(`${ed}._stepPaused`);
    const n = Number(await page.evaluate(() => (document.querySelector('bottom-editor') as any)._stepLocals.n));
    expect(n).toBeGreaterThan(1000);

    await page.evaluate(() => (document.querySelector('bottom-editor') as any)._stop());
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any)._stepping)).toBe(false);
    expect(await page.evaluate(() => (document.querySelector('bottom-editor') as any).outputText)).toContain('KeyboardInterrupt');
});

test('exercises step through student code, then run tests untraced', async ({ page }) => {
    await withoutIsolation(page);
    await page.goto('/exercise.html');
    await page.evaluate(async () => {
        const ex = document.createElement('bottom-exercise') as any;
        ex.stepmode = true;
        ex.code = 'a = 1\nb = 2';
        ex.tests = 'assert a + b == 3\nfor _ in range(1000): pass';
        document.body.append(ex);
        await ex.updateComplete;
        await ex.renderRoot.querySelector('bottom-editor').ready;
        (window as any).__ex = ex;
        (window as any).__run = ex.renderRoot.querySelector('bottom-editor')._startRun('step');
    });
    const inner = '__ex.renderRoot.querySelector("bottom-editor")';
    await page.waitForFunction(`${inner}._stepPaused && ${inner}.energy === 1`);
    await page.evaluate(`${inner}._doStep()`);
    await page.waitForFunction(`${inner}._stepPaused && ${inner}.energy === 2`);
    await page.evaluate(`${inner}._doStep()`);
    await page.evaluate(() => (window as any).__run);
    const report = await page.evaluate(() => (window as any).__ex._testReport);
    expect(report.passed).toBe(true);
    expect(report.energy).toBe(2);
    expect(await page.evaluate(`${inner}._stepping`)).toBe(false);
});

test('turtle drawing appears step by step', async ({ page }) => {
    await withoutIsolation(page);
    await page.goto('/tests/fixtures/turtle.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });
    await page.evaluate(() => {
        const e = document.querySelector('bottom-editor') as any;
        e.stepmode = true;
        e.sourceCode = 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.pensize(3)\nt.forward(100)\nt.left(90)\nt.forward(100)';
        (window as any).__run = e._startRun('step');
    });
    const ed = 'document.querySelector("bottom-editor")';
    const pausedAt = async (line: number) => page.waitForFunction(`${ed}._stepPaused && ${ed}.energy === ${line}`);
    await pausedAt(1);
    for (let line = 2; line <= 6; line++) {
        await page.evaluate(`${ed}._doStep()`);
        await pausedAt(line);
    }
    // Paused before t.left(90): the first segment is drawn, the second is not.
    const pixel = (x: number, y: number) => page.evaluate(([x, y]) => (document.querySelector('bottom-editor') as any).samplePixel(x, y), [x, y]);
    expect((await pixel(1050, 1000)).a).toBeGreaterThan(200);
    expect((await pixel(1100, 950)).a).toBe(0);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

    await page.evaluate(() => { const e = document.querySelector('bottom-editor') as any; e._setStepSpeed(21); e._doPlay(); });
    await page.evaluate(() => (window as any).__run);
    expect((await pixel(1100, 950)).a).toBeGreaterThan(200);
});

test('input() works while stepping', async ({ page }) => {
    await withoutIsolation(page);
    page.on('dialog', (d: any) => d.accept('21'));
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(() => (document.querySelector('bottom-editor') as any)?.ready, { timeout: 75_000 });
    await page.evaluate(() => {
        const e = document.querySelector('bottom-editor') as any;
        e.stepmode = true;
        e.sourceCode = 'n = int(input("n? "))\nprint(n * 2)';
        (window as any).__run = e._startRun('step');
    });
    const ed = 'document.querySelector("bottom-editor")';
    await page.waitForFunction(`${ed}._stepPaused && ${ed}.energy === 1`);
    await page.evaluate(`${ed}._doStep()`);
    await page.waitForFunction(`${ed}._stepPaused && ${ed}.energy === 2`);
    expect(await page.evaluate(`${ed}._stepLocals`)).toEqual({ n: '21' });
    await page.evaluate(`${ed}._doStep()`);
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(`${ed}.outputText`)).toContain('42');
});

test('a paused stepped run is not killed by the run timeout', async ({ page }) => {
    await withoutIsolation(page);
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(async () => {
        const e = document.createElement('bottom-editor') as any;
        e.setAttribute('timeout', '1');
        e.stepmode = true;
        e.textContent = 'a = 1\nprint("done")';
        document.body.append(e);
        await e.ready;
        (window as any).__ed = e;
        (window as any).__run = e._startRun('step');
    });
    await page.waitForFunction(() => (window as any).__ed._stepPaused);
    await page.waitForTimeout(2000);
    await page.evaluate(() => { const e = (window as any).__ed; e._setStepSpeed(21); e._doPlay(); });
    await page.evaluate(() => (window as any).__run);
    expect(await page.evaluate(() => (window as any).__ed.outputText)).toContain('done');
});
