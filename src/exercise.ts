import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import './editor.js' // side-effect: registers <bottom-editor>
import type { BottomEditor } from './editor.js'
import type { TestReport } from './pyodide-runtime.js'
import { type ExerciseStatus } from './exercise-state.js'

/** Serialisable state for H5P server-side persistence (getCurrentState / previousState). */
export interface ExerciseH5PState {
    code:       string;
    status?:    ExerciseStatus;
    attempts?:  number;
    solvedAt?:  number;
}
import { getPageId } from './page-id.js'
import { encodeExercise } from './exercise-permalink.js'

/**
 * <bottom-exercise> wraps a <bottom-editor> with exercise semantics:
 * a prompt, optional starter code, optional test assertions, an optional
 * solution, and a results panel.
 *
 * Add an `id` attribute to enable localStorage persistence. Without `id`,
 * no state is saved. The id is used as a global key (no page prefix), so
 * the same exercise appearing on multiple pages shares its saved state.
 *
 * Tests are optional. Without them the Run button just executes the code.
 *
 * Usage:
 *   <bottom-exercise id="sum-to">
 *     <div slot="prompt">
 *       <p>Write a function <code>sum_to(n)</code> that returns 1+2+...+n.</p>
 *     </div>
 *     <template data-type="starter">
 *       def sum_to(n):
 *           pass
 *     </template>
 *     <template data-type="test">          <!-- optional -->
 *       assert sum_to(5) == 15, "sum_to(5) should be 15"
 *     </template>
 *     <template data-type="solution">     <!-- optional -->
 *       def sum_to(n):
 *           return n * (n + 1) // 2
 *     </template>
 *   </bottom-exercise>
 */
@customElement('bottom-exercise')
export class BottomExercise extends LitElement {

    // Forwarded to the inner <bottom-editor>
    @property() layout: string = 'console';
    @property() session: string = '';
    @property() orientation: string = 'auto';
    @property() timeout: string = '30';
    @property() zip: string = '';
    @property({ type: Boolean }) showswitcher: boolean = false;

    /** Initial code shown in the editor — overrides starter code if set.
     *  Used by the exercise-view landing page to show the student's submission. */
    @property() code: string = '';

    @state()
    private _testReport?: TestReport;

    @state()
    private _status: ExerciseStatus = 'pristine';

    @query('bottom-editor')
    private _editor?: BottomEditor;

    /**
     * Solution code shown when the student clicks "Show solution".
     * Plain text, or base64 when solution-encoding="base64".
     * Alternatively, place solution in <script type="text/x-solution"> inside the element.
     */
    @property() solution: string = '';

    /** When present, the "Show solution" button is hidden and the solution is
     *  excluded from shared permalinks. Remove the attribute to release the
     *  solution to students, e.g. after a lesson. */
    @property({ type: Boolean }) hidesolution: boolean = false;

    private _starterCode: string = '';
    private _testCode: string = '';
    private _solutionCode: string = '';
    private _attempts: number = 0;
    private _solvedAt?: number;
    private _pendingState?: ExerciseH5PState;

    @state() private _confirmingSolution = false;

    connectedCallback() {
        super.connectedCallback();
        // Support both <template data-type="..."> and <script type="text/x-...">
        // so the component works on CMS platforms that strip <template> elements.
        const starterTemplate = this.querySelector('template[data-type="starter"]') as HTMLTemplateElement | null;
        const starterScript   = this.querySelector('script[type="text/x-starter"]') as HTMLScriptElement | null;
        const starterText = starterTemplate?.content.textContent ?? starterScript?.textContent ?? '';
        if (starterText) this._starterCode = BottomExercise.dedent(starterText);

        const testTemplate = this.querySelector('template[data-type="test"]') as HTMLTemplateElement | null;
        const testScript   = this.querySelector('script[type="text/x-test"]') as HTMLScriptElement | null;
        const testText = testTemplate?.content.textContent ?? testScript?.textContent ?? '';
        if (testText) this._testCode = BottomExercise.dedent(testText);

        const solutionTemplate = this.querySelector('template[data-type="solution"]') as HTMLTemplateElement | null;
        const solutionScript   = this.querySelector('script[type="text/x-solution"]') as HTMLScriptElement | null;
        const solutionText = solutionTemplate?.content.textContent ?? solutionScript?.textContent ?? '';
        if (solutionText) this._solutionCode = BottomExercise.dedent(solutionText);

        // H5P server state injected before DOM attachment takes priority over starter code
        if (this._pendingState?.code) this.code = this._pendingState.code;
    }

    /** The key used for persistence. Requires an explicit `id` attribute; null means no persistence. */
    private _effectiveId(): string | null {
        return this.id ? `${getPageId()}:${this.id}` : null;
    }

    // ── State callbacks passed to <bottom-editor> ──────────────────────────────

    /**
     * Called by the editor at save time. Returns the exercise-specific fields
     * (status, attempts, solvedAt) to merge alongside the code.
     */
    private _stateSaver = (): Record<string, unknown> => ({
        status:   this._status,
        attempts: this._attempts,
        solvedAt: this._solvedAt,
    });

    /**
     * Called by the editor when state is loaded (localStorage or cloud).
     * Restores exercise metadata from the saved state object.
     * If H5P server state was injected via setState(), it takes priority.
     */
    private _stateLoader = (saved: Record<string, unknown>) => {
        if (this._pendingState) {
            const ps = this._pendingState;
            this._pendingState = undefined;
            this._status   = ps.status   ?? 'pristine';
            this._attempts = ps.attempts ?? 0;
            this._solvedAt = ps.solvedAt;
            if (ps.code && this._editor) this._editor.sourceCode = ps.code;
            return;
        }
        this._status   = (saved.status   as ExerciseStatus) ?? 'pristine';
        this._attempts = (saved.attempts as number)         ?? 0;
        this._solvedAt =  saved.solvedAt as number | undefined;
    };

    // ── Code change ────────────────────────────────────────────────────────────

    private _onCodeChange() {
        if (this._status === 'pristine' && this._editor?.sourceCode !== this._starterCode) {
            this._status = 'started';
        }
        // The editor already saves on every change. saveNow() ensures the updated
        // _status is included (timing: status update happens after CodeMirror's callback).
        this._editor?.saveNow();
    }

    // ── Public exercise API ────────────────────────────────────────────────────

    /** Remove leading/trailing blank lines and common leading whitespace. */
    private static dedent(text: string): string {
        const lines = text.split('\n');
        while (lines.length && lines[0].trim() === '') lines.shift();
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        const indent = lines
            .filter(l => l.trim() !== '')
            .reduce((min, l) => {
                const match = l.match(/^(\s*)/);
                return Math.min(min, match ? match[1].length : 0);
            }, Infinity);
        if (!isFinite(indent) || indent === 0) return lines.join('\n');
        return lines.map(l => l.slice(indent)).join('\n');
    }

    async runTests() {
        if (!this._editor) return;
        if (!this._testCode) return this._editor.evaluatePython();
        this._testReport = undefined;
        this._testReport = await this._editor.evaluateWithTests(this._testCode);
        // Advance state machine
        if (this._testReport.passed) {
            if (this._status !== 'solved' && this._status !== 'viewed-solution') {
                this._status  = 'solved';
                this._solvedAt = Date.now();
            }
        } else if (this._status === 'pristine' || this._status === 'started') {
            this._status = 'attempted';
        }
        this._attempts++;
        this._editor.saveNow();
        this.dispatchEvent(new CustomEvent('test-result', {
            detail: this._testReport,
            bubbles: true,
            composed: true,
        }));
    }

    resetCode() {
        if (this._editor) {
            this._editor.sourceCode = this._starterCode;
            this._testReport = undefined;
            this._status   = 'pristine';
            this._attempts = 0;
            this._solvedAt = undefined;
            this._confirmingSolution = false;
            this._editor.saveNow();
        }
    }

    /** Returns the resolved solution code, or '' if none is provided. */
    private _resolvedSolution(): string {
        if (this._solutionCode) return this._solutionCode;
        if (!this.solution) return '';
        const m = this.solution.match(/^data:[^,]*?(;base64)?,(.*)$/s);
        if (m) return m[1] ? atob(m[2]) : decodeURIComponent(m[2]);
        return this.solution;
    }

    /** Show the solution immediately, bypassing the confirmation dialog. */
    showSolution() {
        const code = this._resolvedSolution();
        if (!code || !this._editor) return;
        this._editor.sourceCode = code;
        if (this._status !== 'solved') this._status = 'viewed-solution';
        this._confirmingSolution = false;
        this._testReport = undefined;
        this._editor.saveNow();
    }

    private _showSolution() { this.showSolution(); }

    // ── H5P server-side state protocol ────────────────────────────────────────

    /** Returns the current exercise state for H5P getCurrentState(). */
    getState(): ExerciseH5PState | undefined {
        if (!this._editor) return undefined;
        const code = this._editor.sourceCode;
        if (!code) return undefined; // CodeMirror not ready yet
        return {
            code,
            status:   this._status,
            attempts: this._attempts,
            solvedAt: this._solvedAt,
        };
    }

    /**
     * Injects H5P server-side state (previousState from extras).
     * Must be called before the element is appended to the DOM.
     */
    setState(state: ExerciseH5PState) {
        this._pendingState = state;
    }

    // ── Sharing ────────────────────────────────────────────────────────────────

    /** Extract the prompt's HTML from light DOM (named slot or CMS text). */
    private _getPromptHtml(): string {
        const named = this.querySelector('[slot="prompt"]');
        if (named) return named.innerHTML.trim();
        // CMS mode: collect non-data child nodes
        const parts: string[] = [];
        for (const child of this.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                if (child.textContent?.trim()) parts.push(child.textContent);
            } else if (child instanceof HTMLElement) {
                const t = child.tagName.toLowerCase();
                if (t === 'template') continue;
                if (t === 'script' && child.getAttribute('type')?.startsWith('text/x-')) continue;
                parts.push(child.outerHTML);
            }
        }
        return parts.join('').trim();
    }

    async shareExercise() {
        const encoded = await encodeExercise({
            code:     this._editor?.sourceCode ?? '',
            starter:  this._starterCode         || undefined,
            tests:    this._testCode            || undefined,
            solution: this.hidesolution ? undefined : (this._resolvedSolution() || undefined),
            prompt:   this._getPromptHtml()     || undefined,
            layout:   this.layout  !== 'console' ? this.layout  : undefined,
            zip:      this.zip                  || undefined,
            timeout:      this.timeout !== '30'     ? this.timeout : undefined,
            showswitcher: this.showswitcher         || undefined,
        });
        const url = new URL('https://bottom.ch/editor/stable/exercise-view.html');
        url.searchParams.set('x', encoded);
        await navigator.clipboard.writeText(url.href);
        // State feedback is handled by the editor's Share button via permalinkCallback
    }

    render() {
        return html`
            <exercise-prompt>
                <slot name="prompt"></slot>
                <slot></slot>
            </exercise-prompt>
            <bottom-editor
                showclear
                resetmode
                norevert
                .permalinkCallback=${() => this.shareExercise()}
                .onRun=${() => this.runTests()}
                .storageKey=${this._effectiveId() ?? ''}
                .stateSaver=${this._stateSaver}
                .stateLoader=${this._stateLoader}
                layout=${this.layout}
                session=${this.session}
                orientation=${this.orientation}
                timeout=${this.timeout}
                zip=${this.zip}
                ?showswitcher=${this.showswitcher}
                @bottom-change="${this._onCodeChange}"
                @bottom-clear="${this.resetCode}"
            >${this.code || this._starterCode}</bottom-editor>
            ${this._renderStatus()}
            ${this._renderSolution()}
            ${this._renderResults()}
        `;
    }

    private _renderStatus() {
        if (this._status === 'pristine' || this._status === 'started') return nothing;
        const labels: Record<ExerciseStatus, string> = {
            pristine: '', started: '',
            attempted: 'Attempted',
            solved: 'Solved',
            'viewed-solution': 'Solution viewed',
        };
        return html`<exercise-status class="${this._status}">${labels[this._status]}</exercise-status>`;
    }

    private _renderSolution() {
        if (this.hidesolution || !this._resolvedSolution()) return nothing;
        if (this._confirmingSolution) {
            return html`
                <exercise-solution-confirm>
                    Show solution? Your code will be replaced.
                    <button class="confirm-yes" @click="${this._showSolution}">Show it</button>
                    <button class="confirm-no" @click="${() => this._confirmingSolution = false}">Cancel</button>
                </exercise-solution-confirm>
            `;
        }
        return html`
            <button class="show-solution" @click="${() => this._confirmingSolution = true}">
                Show solution
            </button>
        `;
    }

    private _renderResults() {
        if (!this._testReport) return nothing;
        const report = this._testReport;
        const passCount = report.results.filter(r => r.passed).length;
        return html`
            <exercise-results class="${report.passed ? 'passed' : 'failed'}">
                <exercise-summary>
                    ${report.passed ? 'All tests passed!' : 'Some tests failed.'}
                    (${passCount}/${report.results.length})
                </exercise-summary>
                <ul>
                    ${report.results.map(r => html`
                        <li class="${r.passed ? 'passed' : 'failed'}">
                            <span class="icon">${r.passed ? '\u2713' : '\u2717'}</span>
                            <code>${r.test}</code>
                            ${r.message ? html`<span class="message">${r.message}</span>` : nothing}
                        </li>
                    `)}
                </ul>
            </exercise-results>
        `;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 0.5em;
            font-family: system-ui, sans-serif;
            overflow-y: auto;
        }
        exercise-prompt {
            display: block;
        }
        bottom-editor {
            flex: var(--be-editor-flex, 0 1 auto);
            max-height: var(--be-editor-max-height, initial);
        }

        /* Status badge */
        exercise-status {
            display: inline-block;
            font-size: 0.8em;
            font-weight: 600;
            padding: 0.15em 0.6em;
            border-radius: 1em;
            align-self: flex-start;
        }
        exercise-status.attempted {
            background: #fef3c7;
            color: #92400e;
        }
        exercise-status.solved {
            background: #dcfce7;
            color: #166534;
        }
        exercise-status.viewed-solution {
            background: #f3f4f6;
            color: #6b7280;
        }

        /* Test results */
        exercise-results {
            display: block;
            border-radius: 0.5em;
            padding: 0.75em;
            font-size: 0.9em;
        }
        exercise-results.passed {
            background-color: #f0fdf4;
            border: 1px solid #bbf7d0;
        }
        exercise-results.failed {
            background-color: #fef2f2;
            border: 1px solid #fecaca;
        }
        exercise-summary {
            display: block;
            font-weight: 700;
            margin-bottom: 0.5em;
        }
        exercise-results.passed exercise-summary {
            color: #166534;
        }
        exercise-results.failed exercise-summary {
            color: #991b1b;
        }
        exercise-results ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        exercise-results li {
            padding: 0.25em 0;
            display: flex;
            align-items: baseline;
            gap: 0.5em;
            flex-wrap: wrap;
        }
        exercise-results li .icon {
            font-weight: 700;
            flex-shrink: 0;
        }
        exercise-results li.passed .icon { color: #16a34a; }
        exercise-results li.failed .icon { color: #dc2626; }
        exercise-results li code {
            font-size: 0.9em;
            background: rgba(0,0,0,0.05);
            padding: 0.1em 0.3em;
            border-radius: 0.25em;
        }
        exercise-results li .message {
            color: #6b7280;
            font-size: 0.85em;
            width: 100%;
            padding-left: 1.5em;
        }

        /* Show solution */
        button.show-solution {
            align-self: flex-start;
            font-size: 0.8em;
            padding: 0.2em 0.7em;
            border: 1px solid #d1d5db;
            border-radius: 1em;
            background: transparent;
            color: #6b7280;
            cursor: pointer;
        }
        button.show-solution:hover {
            background: #f3f4f6;
            color: #374151;
        }
        exercise-solution-confirm {
            display: flex;
            align-items: center;
            gap: 0.5em;
            font-size: 0.85em;
            color: #374151;
        }
        exercise-solution-confirm button {
            padding: 0.2em 0.7em;
            border-radius: 0.3em;
            border: 1px solid #d1d5db;
            cursor: pointer;
            font-size: 1em;
        }
        exercise-solution-confirm .confirm-yes {
            background: #fee2e2;
            color: #991b1b;
            border-color: #fca5a5;
        }
        exercise-solution-confirm .confirm-yes:hover {
            background: #fecaca;
        }
        exercise-solution-confirm .confirm-no {
            background: transparent;
            color: #6b7280;
        }
        exercise-solution-confirm .confirm-no:hover {
            background: #f3f4f6;
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-exercise': BottomExercise
    }
}
