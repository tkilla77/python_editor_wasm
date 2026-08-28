import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import './exercise.js'
import karaShimSrc from './kara-shim.py?raw'
import { dedentWorld, renderKaraWorld } from './kara-world.js'
import { transformKaraCode } from './kara-transform.js'
import { encodeExercise } from './exercise-permalink.js'

// Minimal custom elements so the browser doesn't treat them as unknown inline.
for (const tag of ['kara-world', 'kara-prompt', 'kara-solution', 'kara-tests']) {
    if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
}

const DEFAULT_WORLD = `
###########
#.........#
#....>....#
#.........#
###########
`.trim();

const PERMALINK_BASE = 'https://bottom.ch/editor/stable/kara.html';

/** Strip leading/trailing blank lines and common indentation. */
function dedent(text: string): string {
    const lines = text.split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    const indent = lines
        .filter(l => l.trim() !== '')
        .reduce((min, l) => Math.min(min, l.match(/^\s*/)?.[0].length ?? 0), Infinity);
    return lines.map(l => l.slice(isFinite(indent) ? indent : 0)).join('\n');
}

/**
 * <kara-exercise> — a Kara world editor with exercise semantics.
 *
 * Wraps <bottom-exercise> with the Kara shim, world parsing, and optional
 * prompt, solution, and test-assertion support.
 *
 * Usage:
 *   <kara-exercise id="ex1" step="200">
 *     <kara-world>
 *       ###########
 *       #>.......*#
 *       ###########
 *     </kara-world>
 *
 *     <kara-prompt><p>Move Kara to the leaf.</p></kara-prompt>
 *
 *     <!-- starter code (plain text nodes between child elements) -->
 *     kara.move()
 *
 *     <kara-solution>
 *       for i in range(8):
 *           kara.move()
 *     </kara-solution>
 *
 *     <kara-tests>
 *       assert kara.x == 8, f"Expected x=8, got {kara.x}"
 *       assert kara.direction == 'right'
 *       assert world_leaf_at(8, 1), "Should be standing on the leaf"
 *     </kara-tests>
 *   </kara-exercise>
 *
 * Test assertions run after user code in the same Pyodide context, so `kara`,
 * `world_leaf_at(x, y)`, `world_mushroom_at(x, y)`, and `world_leaves()` are
 * all in scope.
 *
 * Coordinates are 0-indexed (column, row) from the top-left corner.
 * kara.direction is one of: 'right', 'down', 'left', 'up'.
 *
 * Add `id` to enable localStorage persistence. Add `hidesolution` to keep
 * the solution button hidden until you choose to release it.
 */
@customElement('kara-exercise')
export class KaraExercise extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };

    /** Animation step delay in milliseconds (0 = instant). */
    @property({ type: Number }) step     = 200;
    @property({ type: Boolean }) autorun = false;
    @property() timeout                  = '30';
    @property() storage                  = '';
    /** Hide the "Show solution" button (teacher controls release). */
    @property({ type: Boolean }) hidesolution = false;

    private readonly _sessionId = `kara-${crypto.randomUUID()}`;

    private _worldStr        = DEFAULT_WORLD;
    private _promptHtml      = '';
    private _userCode        = '';
    private _solutionCode    = '';
    private _testCode        = '';
    private _expectedWorldStr = '';   // target world for visual diff on failure
    private _showExpected    = false;

    /** Programmatic overrides used by kara-editor-page when loading from a permalink.
     *  Empty string is a no-op so Lit bindings with a missing field don't clobber defaults. */
    set world(w: string)      { if (w) { this._worldStr   = w; this.requestUpdate(); } }
    set promptHtml(h: string) { if (h) { this._promptHtml = h; this.requestUpdate(); } }
    set code(c: string)       { if (c) { this._userCode   = c; this.requestUpdate(); } }
    set solution(s: string)   { if (s) { this._solutionCode = s; this.requestUpdate(); } }
    set testCode(t: string) {
        if (!t) return;
        this._testCode = t;
        // Extract expected world for visual rendering when test code was generated from a
        // <kara-world> in <kara-tests> (format: _world_matches("""\n<world>\n""") )
        const m = t.match(/_world_matches\("""\n([\s\S]*?)\n"""\)/);
        if (m) this._expectedWorldStr = m[1];
        this.requestUpdate();
    }

    connectedCallback() {
        super.connectedCallback();
        this._parse();
    }

    private _parse() {
        const worldEl = this.querySelector('kara-world');
        if (worldEl) {
            if (worldEl.children.length > 0) {
                console.warn(
                    'kara-world: unexpected child elements detected — the world text likely ' +
                    'contains an unescaped < character. Use &lt; for Kara facing left in HTML.'
                );
            }
            this._worldStr = dedentWorld(worldEl.textContent ?? '') || DEFAULT_WORLD;
        }

        const promptEl = this.querySelector('kara-prompt');
        if (promptEl) this._promptHtml = promptEl.innerHTML.trim();

        // Starter code = direct text-node children (outside named child elements).
        // Guard: don't overwrite a value already set programmatically (e.g. via
        // Lit's .code binding, which fires before connectedCallback).
        const domCode = Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent ?? '')
            .join('')
            .replace(/^\s*\n/, '');
        if (domCode.trim()) this._userCode = domCode;

        const solutionEl = this.querySelector('kara-solution');
        if (solutionEl) this._solutionCode = dedent(solutionEl.textContent ?? '');

        const testsEl = this.querySelector('kara-tests');
        if (testsEl) {
            const targetWorldEl = testsEl.querySelector('kara-world');
            const plainText = Array.from(testsEl.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent ?? '')
                .join('');
            let testCode = '';
            if (targetWorldEl) {
                const worldStr = dedentWorld(targetWorldEl.textContent ?? '').replace(/"""/g, "'''");
                this._expectedWorldStr = worldStr;
                testCode = `_world_matches("""\n${worldStr}\n""")\n`;
            }
            testCode += dedent(plainText);
            this._testCode = testCode.trim();
        }
    }

    private get _prefix(): string {
        const world = this._worldStr.replace(/"""/g, "'''");
        return karaShimSrc + `\n_kara_setup("""${world}""", ${this.step})\n`;
    }

    private get _prefixLineCount(): number {
        return (this._prefix.match(/\n/g) ?? []).length;
    }

    private readonly _transform = (editorCode: string): string =>
        this._prefix + transformKaraCode(editorCode);

    private get _readyCode(): string { return this._prefix; }

    private readonly _onTestResult = (e: Event) => {
        const report = (e as CustomEvent).detail as { passed: boolean };
        this._showExpected = !report.passed && !!this._expectedWorldStr;
        if (this._showExpected) {
            this.updateComplete.then(() => {
                const canvas = this.renderRoot?.querySelector('.expected-canvas') as HTMLCanvasElement | null;
                if (canvas) renderKaraWorld(canvas, this._expectedWorldStr);
            });
        }
        this.requestUpdate();
    };

    private readonly _permalink = async () => {
        const exercise = this.renderRoot?.querySelector('bottom-exercise') as any;
        const currentCode = (exercise?.sourceCode ?? this._userCode).trim();
        const encoded = await encodeExercise({
            world:    this._worldStr,
            code:     currentCode                || undefined,
            prompt:   this._promptHtml           || undefined,
            // Omit solution when hidesolution — absence IS the obfuscation.
            solution: this.hidesolution ? undefined : (this._solutionCode.trim() || undefined),
            tests:    this._testCode.trim()      || undefined,
            step:     this.step !== 200          ? this.step    : undefined,
            timeout:  this.timeout !== '30'      ? this.timeout : undefined,
        });
        const url = new URL(PERMALINK_BASE);
        url.searchParams.set('x', encoded);
        navigator.clipboard.writeText(url.href);
    };

    render() {
        return html`
            <bottom-exercise
                layout="split"
                .code=${this._userCode}
                .transformCode=${this._transform}
                .transformLineOffset=${this._prefixLineCount}
                .readyCode=${this._readyCode}
                .solution=${this._solutionCode}
                .tests=${this._testCode}
                .permalinkOverride=${this._permalink}
                ?hidesolution=${this.hidesolution}
                ?autofit=${true}
                session=${this._sessionId}
                timeout=${this.timeout}
                id=${this.id || nothing}
                storage=${this.storage || nothing}
                @test-result=${this._onTestResult}
            >${this._promptHtml ? html`<div slot="prompt">${unsafeHTML(this._promptHtml)}</div>` : nothing}</bottom-exercise>
            ${this._showExpected ? html`
                <div class="expected-world">
                    <span class="expected-label">Expected world</span>
                    <canvas class="expected-canvas" width="2000" height="2000"></canvas>
                </div>` : nothing}`;
    }

    static styles = css`
        :host { display: block; }
        bottom-exercise {
            --be-output-row: calc(2lh + 1em + 4px);
            --be-output-min-height: calc(2lh + 1em + 4px);
        }
        .expected-world {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.25em;
            margin-top: 0.75em;
        }
        .expected-label {
            font-size: 0.8em;
            font-weight: 600;
            color: #dc2626;
            font-family: system-ui, sans-serif;
        }
        .expected-canvas {
            display: block;
            width: min(100%, 280px);
            height: auto;
            aspect-ratio: 1;
            border: 1px solid #fca5a5;
            border-radius: 4px;
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        'kara-exercise': KaraExercise
    }
}
