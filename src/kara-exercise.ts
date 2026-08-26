import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './exercise.js'
import karaShimSrc from './kara-shim.py?raw'
import { dedentWorld } from './kara-world.js'
import { transformKaraCode } from './kara-transform.js'

// Minimal custom elements so the browser doesn't treat them as unknown inline.
for (const tag of ['kara-world', 'kara-solution', 'kara-tests']) {
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
 * solution / test-assertion support.
 *
 * Usage:
 *   <kara-exercise id="ex1" step="200">
 *     <kara-world>
 *       ###########
 *       #>.......*#
 *       ###########
 *     </kara-world>
 *
 *     <!-- starter code (plain text nodes between <kara-world> and siblings) -->
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
 * `world_leaf_at(x, y)`, and `world_mushroom_at(x, y)` are all in scope.
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

    private _worldStr    = DEFAULT_WORLD;
    private _userCode    = '';
    private _solutionCode = '';
    private _testCode    = '';

    connectedCallback() {
        super.connectedCallback();
        this._parse();
    }

    private _parse() {
        const worldEl = this.querySelector('kara-world');
        if (worldEl) {
            this._worldStr = dedentWorld(worldEl.textContent ?? '') || DEFAULT_WORLD;
        }

        // Starter code = direct text-node children (outside <kara-world> etc.)
        this._userCode = Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent ?? '')
            .join('')
            .replace(/^\s*\n/, '');

        const solutionEl = this.querySelector('kara-solution');
        if (solutionEl) this._solutionCode = dedent(solutionEl.textContent ?? '');

        const testsEl = this.querySelector('kara-tests');
        if (testsEl) this._testCode = dedent(testsEl.textContent ?? '');
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

    private readonly _permalink = () => {
        const url = new URL(PERMALINK_BASE);
        url.searchParams.set('world', this._worldStr);
        // Access the live editor via bottom-exercise's public sourceCode getter.
        const exercise = this.renderRoot?.querySelector('bottom-exercise') as any;
        const currentCode = exercise?.sourceCode ?? this._userCode;
        if (currentCode.trim()) url.searchParams.set('code', currentCode);
        if (this.step !== 200)      url.searchParams.set('step',    String(this.step));
        if (this.timeout !== '30')  url.searchParams.set('timeout', this.timeout);
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
            ></bottom-exercise>`;
    }

    static styles = css`
        :host { display: block; }
        bottom-exercise {
            --be-output-row: calc(2lh + 1em + 4px);
            --be-output-min-height: calc(2lh + 1em + 4px);
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        'kara-exercise': KaraExercise
    }
}
