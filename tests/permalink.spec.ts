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
        e.nodebug = true;
        await e.copyPermalink();
    });
    const path = await copied(page);
    expect(path).toContain('stepmode=1');
    await page.goto(path);
    const ed = page.locator('bottom-editor-page bottom-editor');
    await expect(ed).toHaveAttribute('stepmode', '');
    await expect(ed).toHaveAttribute('showenergy', '');
    await expect(ed).toHaveAttribute('nodebug', '');
});

test('exercise permalink keeps stepmode, showenergy, maxenergy, maxmemory', async ({ page }) => {
    await page.goto('/exercise.html');
    await page.evaluate(async () => {
        const ex = document.createElement('bottom-exercise') as any;
        ex.code = 'x = 1';
        ex.tests = 'assert x == 1';
        Object.assign(ex, { stepmode: true, showenergy: true, nodebug: true, maxenergy: 5, maxmemory: 3 });
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
    await expect(ex.locator('bottom-editor')).toHaveAttribute('nodebug', '');
});

test('kara-editor permalink keeps stepmode and showenergy', async ({ page }) => {
    await page.goto('/kara.html');
    const kara = page.locator('kara-editor');
    await kara.evaluate(async (k: any) => {
        k.stepmode = true;
        k.showenergy = true;
        k.nodebug = true;
        await k.updateComplete;
        k._permalink();
    });
    await page.goto(await copied(page));
    await expect(page.locator('kara-editor bottom-editor')).toHaveAttribute('stepmode', '');
    await expect(page.locator('kara-editor bottom-editor')).toHaveAttribute('showenergy', '');
    await expect(page.locator('kara-editor bottom-editor')).toHaveAttribute('nodebug', '');
});

test('kara-exercise permalink keeps step and energy settings', async ({ page }) => {
    await page.goto('/kara.html');
    await page.evaluate(async () => {
        const k = document.createElement('kara-exercise') as any;
        Object.assign(k, { stepmode: true, showenergy: true, nodebug: true, maxenergy: 50, maxmemory: 4 });
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
    await expect(ex.locator('bottom-editor')).toHaveAttribute('nodebug', '');
});

async function decodeX(page: any, path: string) {
    const x = new URL(path, 'http://x').searchParams.get('x')!;
    return page.evaluate(async (x: string) => (await import('/src/exercise-permalink.ts')).decodeExercise(x), x);
}

const exEditor = 'document.querySelector("bottom-exercise").renderRoot.querySelector("bottom-editor")';

test('exercise permalink carries extra files; revert goes back to the authored versions', async ({ page }) => {
    await page.goto('/exercise.html');
    await page.evaluate(async () => {
        document.querySelectorAll('bottom-exercise').forEach(e => e.remove());
        const ex = document.createElement('bottom-exercise') as any;
        ex.setAttribute('mainfile', 'app.py');
        ex.innerHTML = '<template data-type="starter">from helper import f\nprint(f())</template>'
            + '<template filename="helper.py">def f(): return 1</template>';
        document.body.append(ex);
        await ex.updateComplete;
        const ed = ex.renderRoot.querySelector('bottom-editor');
        await ed.updateComplete;
        ed._switchTab(1); ed.replaceDoc('def f(): return 2'); ed._switchTab(0);
        ed._addTab('notes.txt'); ed.replaceDoc('mine'); ed._switchTab(0);
        await ex.shareExercise();
    });
    await page.goto(await copied(page));
    await page.waitForFunction(`${exEditor}?.files.length === 3`);
    expect(await page.evaluate(`${exEditor}.files`)).toEqual([
        { name: 'app.py', code: 'from helper import f\nprint(f())' },
        { name: 'helper.py', code: 'def f(): return 2' },
        { name: 'notes.txt', code: 'mine' },
    ]);
    await page.evaluate(`${exEditor}.ready`);
    await page.evaluate(`${exEditor}.revertCode()`);
    expect(await page.evaluate(`${exEditor}.files`)).toEqual([
        { name: 'app.py', code: 'from helper import f\nprint(f())' },
        { name: 'helper.py', code: 'def f(): return 1' },
    ]);
});

test('links leave out unchanged zip files and keep edited ones', async ({ page }) => {
    await page.goto('/exercise.html');
    await page.evaluate(async () => {
        document.querySelectorAll('bottom-exercise').forEach(e => e.remove());
        const ex = document.createElement('bottom-exercise') as any;
        ex.setAttribute('multifile', '');
        ex.setAttribute('zip', '/tests/fixtures/helpers.zip');
        ex.code = 'print(open("data/values.txt").read())';
        document.body.append(ex);
        await ex.updateComplete;
    });
    await page.waitForFunction(`${exEditor}.files.length === 3`);
    await page.evaluate(async (sel: string) => {
        const ed = eval(sel);
        ed._switchTab(2); ed.replaceDoc('9\n'); ed._switchTab(0);
        await document.querySelector<any>('bottom-exercise').shareExercise();
    }, exEditor);
    const path = await copied(page);
    expect((await decodeX(page, path)).files).toEqual([{ name: 'data/values.txt', code: '9\n', initial: null }]);

    await page.goto(path);
    await page.waitForFunction(`${exEditor}?.files.length === 3`);
    expect(await page.evaluate(`${exEditor}.files.map(f => f.name + '=' + f.code.trim())`))
        .toEqual(['main.py=print(open("data/values.txt").read())', 'helper.py=GREETING = "hi from zip"', 'data/values.txt=9']);
    await page.evaluate(`${exEditor}.revertCode()`);
    expect(await page.evaluate(`${exEditor}.files[2].code`)).toBe('1\n2\n3\n');
});

test('editor permalink skips unchanged zip files; long links are flagged', async ({ page }) => {
    await page.goto('/tests/fixtures/basic.html');
    const res = await page.evaluate(async () => {
        const e = document.createElement('bottom-editor') as any;
        e.setAttribute('multifile', '');
        e.setAttribute('zip', '/tests/fixtures/helpers.zip');
        e.textContent = 'print(1)';
        document.body.append(e);
        await e.ready;
        while (e.files.length < 3) await new Promise(r => setTimeout(r, 50));
        await e.copyPermalink();
        const short = JSON.parse(new URL((window as any).__clip).searchParams.get('files'));
        e._addTab('big.csv');
        e.replaceDoc('x,y\n'.repeat(5000));
        await e.copyPermalink();
        return { short, state: e._shareState, hint: e._shareHint };
    });
    expect(res.short).toEqual([{ name: 'main.py', code: 'print(1)' }]);
    expect(res.state).toBe('large');
    expect(res.hint).toContain('big.csv (20 kB)');
});
