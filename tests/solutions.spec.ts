import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init: ShadowRootInit) { return attach.call(this, { ...init, mode: 'open' }); };
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as any).__clip = t; } } });
    });
});

const EX = '(window).__ex';
const ED = '(window).__ex.shadowRoot.querySelector("bottom-editor")';

/** Add a <bottom-exercise> (or <kara-exercise>) with the given inner HTML; wait for Python. */
async function addExercise(page: any, html: string, tag = 'bottom-exercise', attrs = '') {
    await page.goto(tag === 'kara-exercise' ? '/kara.html' : '/exercise.html');
    await page.evaluate(async ({ html, tag, attrs }: any) => {
        document.querySelectorAll('bottom-exercise, kara-editor-page').forEach(e => e.remove());
        const wrap = document.createElement('div');
        wrap.innerHTML = `<${tag} ${attrs}>${html}</${tag}>`;
        const el = wrap.firstElementChild as any;
        document.body.append(el);
        await el.updateComplete;
        const ex = tag === 'kara-exercise' ? el.shadowRoot.querySelector('bottom-exercise') : el;
        await ex.updateComplete;
        (window as any).__host = el;
        (window as any).__ex = ex;
        await ex.shadowRoot.querySelector('bottom-editor').ready;
    }, { html, tag, attrs });
}

const files = (page: any) => page.evaluate(`${ED}.files`);

const K11 = '<template data-type="starter">from toolbox import square\nprint(square(3))</template>'
    + '<template filename="toolbox.py">def square(n):\n    pass</template>'
    + '<template filename="notes.txt">my notes</template>'
    + '<template data-type="test">assert square(3) == 9</template>'
    + '<template data-type="solution">from toolbox import square\nprint("solved", square(3))</template>'
    + '<template data-type="solution" filename="toolbox.py">def square(n):\n    return n * n</template>';

test('Show solution replaces each file that has a solution and leaves the rest', async ({ page }) => {
    await addExercise(page, K11);
    expect((await files(page)).map((f: any) => f.name)).toEqual(['main.py', 'toolbox.py', 'notes.txt']);
    await page.evaluate(`(() => { const e = ${ED}; e._switchTab(2); e.replaceDoc('edited notes'); e._switchTab(0); })()`);
    await page.evaluate(`${EX}.showSolution()`);
    expect(await files(page)).toEqual([
        { name: 'main.py', code: 'from toolbox import square\nprint("solved", square(3))' },
        { name: 'toolbox.py', code: 'def square(n):\n    return n * n' },
        { name: 'notes.txt', code: 'edited notes' },
    ]);
    expect(await page.evaluate(`${EX}._status`)).toBe('viewed-solution');
    await page.evaluate(`${EX}.runTests()`);
    expect(await page.evaluate(`${EX}._testReport.passed`)).toBe(true);
});

test('a deleted file comes back with its solution; a file-only solution still shows the button', async ({ page }) => {
    await addExercise(page, K11.replace(/<template data-type="solution">[^<]*<\/template>/, ''));
    expect(await page.evaluate(`!!${EX}.shadowRoot.querySelector('button.show-solution')`)).toBe(true);
    await page.evaluate(`${ED}._deleteTab(1)`);
    expect((await files(page)).map((f: any) => f.name)).toEqual(['main.py', 'notes.txt']);
    await page.evaluate(`${EX}.showSolution()`);
    const after = await files(page);
    expect(after[0].code).toBe('from toolbox import square\nprint(square(3))');
    expect(after.find((f: any) => f.name === 'toolbox.py').code).toBe('def square(n):\n    return n * n');
});

test('permalinks carry file solutions unless hidesolution is set', async ({ page }) => {
    await addExercise(page, K11, 'bottom-exercise', 'hidesolution');
    await page.evaluate(`${EX}.shareExercise()`);
    let x = new URL(await page.evaluate(() => (window as any).__clip)).searchParams.get('x')!;
    let state = await page.evaluate(async (x: string) => (await import('/src/exercise-permalink.ts')).decodeExercise(x), x);
    expect(state.solution).toBeUndefined();
    expect(state.solutions).toBeUndefined();

    await addExercise(page, K11);
    await page.evaluate(`${EX}.shareExercise()`);
    const url = new URL(await page.evaluate(() => (window as any).__clip));
    x = url.searchParams.get('x')!;
    state = await page.evaluate(async (x: string) => (await import('/src/exercise-permalink.ts')).decodeExercise(x), x);
    expect(state.solutions).toEqual([{ name: 'toolbox.py', code: 'def square(n):\n    return n * n' }]);

    await page.goto(url.pathname.replace('/editor/stable', '') + url.search);
    await page.waitForFunction(() => document.querySelector<any>('bottom-exercise')?.shadowRoot?.querySelector('bottom-editor')?.files.length === 3);
    await page.evaluate(() => { (window as any).__ex = document.querySelector('bottom-exercise'); });
    expect((await files(page)).map((f: any) => f.name)).toEqual(['main.py', 'toolbox.py', 'notes.txt']);
    await page.evaluate(`${EX}.showSolution()`);
    expect((await files(page))[1].code).toBe('def square(n):\n    return n * n');
});

test('kara-solution with a filename solves that file', async ({ page }) => {
    await addExercise(page,
        'from moves import go\ngo(2)'
        + '<template filename="moves.py">def go(n):\n    pass</template>'
        + '<kara-solution>from moves import go\ngo(3)</kara-solution>'
        + '<kara-solution filename="moves.py">\n    def go(n):\n        for _ in range(n):\n            kara.move()\n</kara-solution>',
        'kara-exercise', 'step="0"');
    expect((await files(page)).map((f: any) => f.name)).toEqual(['main.py', 'moves.py']);
    await page.evaluate(`${EX}.showSolution()`);
    expect(await files(page)).toEqual([
        { name: 'main.py', code: 'from moves import go\ngo(3)' },
        { name: 'moves.py', code: 'def go(n):\n    for _ in range(n):\n        kara.move()' },
    ]);
});
