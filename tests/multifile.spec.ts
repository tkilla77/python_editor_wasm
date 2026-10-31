import { test, expect } from '@playwright/test';

/** Add a fresh <bottom-editor> to the page and wait until Python is ready. */
async function addEditor(page: any, attrs: Record<string, string>, html: string) {
    await page.goto('/tests/fixtures/basic.html');
    await page.evaluate(async ({ attrs, html }: any) => {
        const e = document.createElement('bottom-editor') as any;
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as string);
        e.innerHTML = html;
        document.body.append(e);
        (window as any).__ed = e;
        await e.ready;
    }, { attrs, html });
}

const names = (page: any) => page.evaluate(() => (window as any).__ed.files.map((f: any) => f.name));

async function editTab(page: any, idx: number, code: string) {
    await page.evaluate(({ idx, code }: any) => {
        const e = (window as any).__ed;
        e._switchTab(idx);
        e.replaceDoc(code);
        e._switchTab(0);
    }, { idx, code });
}

async function run(page: any): Promise<string> {
    return page.evaluate(async () => {
        const e = (window as any).__ed;
        await e.evaluatePython();
        return e.outputText;
    });
}

test('multifile shows tabs with a single file; user files are importable', async ({ page }) => {
    await addEditor(page, { multifile: '' }, 'from extra import X\nprint(X)');
    expect(await names(page)).toEqual(['main.py']);
    await page.evaluate(() => (window as any).__ed._addTab('extra.py'));
    await editTab(page, 1, 'X = 7');
    expect(await run(page)).toContain('7');
});

test('editing an imported file takes effect on the next run', async ({ page }) => {
    await addEditor(page, {}, 'from mod import V\nprint(V)<template filename="mod.py">V = "first"</template>');
    expect(await run(page)).toContain('first');
    await editTab(page, 1, 'V = "second"');
    expect(await run(page)).toContain('second');
});

test('revert restores deleted files and drops added ones', async ({ page }) => {
    await addEditor(page, {}, 'print(1)<template filename="a.txt">A</template>');
    await page.evaluate(() => {
        const e = (window as any).__ed;
        e._deleteTab(1);
        e._addTab('mine.py');
    });
    expect(await names(page)).toEqual(['main.py', 'mine.py']);
    await page.evaluate(() => (window as any).__ed.revertCode());
    expect(await page.evaluate(() => (window as any).__ed.files)).toEqual([
        { name: 'main.py', code: 'print(1)' },
        { name: 'a.txt', code: 'A' },
    ]);
});

test('text files from a zip appear as tabs and edits are used', async ({ page }) => {
    await addEditor(page, { multifile: '', zip: '/tests/fixtures/helpers.zip' },
        'from helper import GREETING\nprint(GREETING)');
    await page.waitForFunction(() => (window as any).__ed.files.length === 3);
    expect(await names(page)).toEqual(['main.py', 'helper.py', 'data/values.txt']);
    expect(await run(page)).toContain('hi from zip');
    await editTab(page, 1, 'GREETING = "edited"');
    expect(await run(page)).toContain('edited');

    // Revert brings the zip's original content back.
    await page.evaluate(() => (window as any).__ed.revertCode());
    expect(await names(page)).toEqual(['main.py', 'helper.py', 'data/values.txt']);
    expect(await run(page)).toContain('hi from zip');
});

test('without multifile, zip files stay hidden', async ({ page }) => {
    await addEditor(page, { zip: '/tests/fixtures/helpers.zip' }, 'from helper import GREETING\nprint(GREETING)');
    await page.waitForTimeout(500);
    expect(await names(page)).toEqual([]);
    expect(await run(page)).toContain('hi from zip');
});

test('Run executes the main file whichever tab is open', async ({ page }) => {
    await addEditor(page, {}, 'from helper import V\nprint("main", V)<template filename="helper.py">V = 3\nprint("helper ran directly")</template>');
    await page.evaluate(() => (window as any).__ed._switchTab(1));
    const out = await run(page);
    expect(out).toContain('main 3');
    expect(await page.evaluate(() => (window as any).__ed.sourceCode)).toBe('from helper import V\nprint("main", V)');

    // Errors name the main file; the helper tab stays open.
    await page.evaluate(() => {
        const e = (window as any).__ed;
        e.sourceCode = 'x = 1\nundefined_name';
    });
    expect(await page.evaluate(() => (window as any).__ed._tabIdx)).toBe(1);
    expect(await run(page)).toContain('main.py, line 2: NameError');

    // The main file can't be deleted.
    await page.evaluate(() => (window as any).__ed._deleteTab(0));
    expect(await names(page)).toEqual(['main.py', 'helper.py']);
});

test('stepping switches to the main file', async ({ page }) => {
    await addEditor(page, { stepmode: '' }, 'a = 1<template filename="helper.py">X = 0</template>');
    await page.evaluate(() => {
        const e = (window as any).__ed;
        e._switchTab(1);
        (window as any).__run = e._startRun('step');
    });
    await page.waitForFunction(() => (window as any).__ed._stepPaused);
    expect(await page.evaluate(() => (window as any).__ed._tabIdx)).toBe(0);
    await page.evaluate(() => (window as any).__ed._doStep());
    await page.evaluate(() => (window as any).__run);
});

for (const tag of ['bottom-exercise', 'kara-exercise']) {
    test(`${tag}: edited files survive Run and reload`, async ({ page }) => {
        await page.addInitScript(() => {
            const attach = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function (init: ShadowRootInit) { return attach.call(this, { ...init, mode: 'open' }); };
        });
        const tests = tag === 'kara-exercise' ? '<kara-tests>assert X == 2</kara-tests>' : '<template data-type="test">assert X == 2</template>';
        const starter = tag === 'kara-exercise' ? 'from toolbox import X' : '<template data-type="starter">from toolbox import X</template>';
        const html = `<!doctype html><script type="module" src="/src/kara-exercise.ts"></script>
            <${tag} id="persist-run" multifile>${starter}<template filename="toolbox.py">X = 1</template>${tests}</${tag}>`;
        await page.route('**/persist-run.html', (r: any) => r.fulfill({ contentType: 'text/html', body: html }));
        const ex = tag === 'kara-exercise'
            ? `document.querySelector("${tag}").shadowRoot.querySelector("bottom-exercise")`
            : `document.querySelector("${tag}")`;
        const ed = `${ex}.shadowRoot.querySelector("bottom-editor")`;
        const load = async () => {
            await page.goto('/persist-run.html');
            await page.waitForFunction(`${ed}?.files.length === 2`);
            await page.evaluate(`${ed}.ready`);
        };
        await load();
        await page.evaluate(`(() => { const e = ${ed}; e._switchTab(1); e.replaceDoc('X = 2'); e._switchTab(0); })()`);
        // Run changes the exercise status, which re-renders the exercise.
        await page.evaluate(`${ex}.runTests()`);
        expect(await page.evaluate(`${ex}._testReport.passed`)).toBe(true);
        expect(await page.evaluate(`${ed}.files[1].code`)).toBe('X = 2');

        await load();
        await page.waitForTimeout(300);
        expect(await page.evaluate(`${ed}.files[1].code`)).toBe('X = 2');
    });
}
