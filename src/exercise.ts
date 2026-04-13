import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import './editor.js' // side-effect: registers <bottom-editor>
import type { BottomEditor } from './editor.js'
import type { TestReport } from './pyodide-runtime.js'
import { LocalStorageAdapter, type ExerciseStatus, type StateAdapter } from './exercise-state.js'

/**
 * <bottom-exercise> wraps a <bottom-editor> with exercise semantics:
 * a prompt, starter code, test assertions, and a test results display.
 *
 * Usage:
 *   <bottom-exercise>   (exercise-id is optional; defaults to a hash of the test code)
 *     <div slot="prompt">
 *       <p>Write a function <code>sum_to(n)</code> that returns 1+2+...+n.</p>
 *     </div>
 *     <template data-type="starter">
 *       def sum_to(n):
 *           pass
 *     </template>
 *     <template data-type="test">
 *       assert sum_to(5) == 15, "sum_to(5) should be 15"
 *       assert sum_to(0) == 0
 *       assert sum_to(1) == 1
 *     </template>
 *   </bottom-exercise>
 */
@customElement('bottom-exercise')
export class BottomExercise extends LitElement {

    @property({ attribute: 'exercise-id' })
    exerciseId: string = '';

    // Forwarded to the inner <bottom-editor>
    @property() layout: string = 'console';
    @property() session: string = '';
    @property() orientation: string = 'auto';
    @property() timeout: string = '30';
    @property() zip: string = '';

    /** Override the default LocalStorageAdapter. */
    @property({ attribute: false })
    adapter: StateAdapter = new LocalStorageAdapter();

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
    @property({ attribute: 'solution-encoding' }) solutionEncoding: string = 'plain';

    private _starterCode: string = '';
    private _testCode: string = '';
    private _solutionCode: string = '';
    private _attempts: number = 0;
    private _solvedAt?: number;

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
    }

    /** Stable hash of the test code — used as the storage key when no exercise-id is given. */
    private static hashCode(s: string): string {
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
            h = Math.imul(h, 31) ^ s.charCodeAt(i);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    /** The key used for persistence. Explicit exercise-id wins; falls back to hash of test code. */
    private _effectiveId(): string | null {
        if (this.exerciseId) return this.exerciseId;
        if (this._testCode)  return BottomExercise.hashCode(this._testCode);
        return null;
    }

    override async firstUpdated() {
        const id = this._effectiveId();
        if (!id) return;
        const saved = await this.adapter.load(id);
        if (!saved) return;
        this._status   = saved.status;
        this._attempts = saved.attempts;
        this._solvedAt = saved.solvedAt;
        if (saved.code !== this._starterCode) {
            this._editor!.sourceCode = saved.code;
        }
    }

    private _onCodeChange() {
        if (this._status !== 'pristine') return;
        if (this._editor?.sourceCode !== this._starterCode) {
            this._status = 'started';
            this._saveState();
        }
    }

    private _saveState() {
        const id = this._effectiveId();
        if (!id) return;
        this.adapter.save(id, {
            exerciseId: id,
            status:     this._status,
            code:       this._editor?.sourceCode ?? this._starterCode,
            attempts:   this._attempts,
            solvedAt:   this._solvedAt,
        });
    }

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
        this._saveState();
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
            this._saveState();
        }
    }

    /** Returns the resolved solution code, or '' if none is provided. */
    private _resolvedSolution(): string {
        if (this._solutionCode) return this._solutionCode;
        if (!this.solution) return '';
        if (this.solutionEncoding === 'base64') return atob(this.solution);
        return this.solution;
    }

    private _showSolution() {
        const code = this._resolvedSolution();
        if (!code || !this._editor) return;
        this._editor.sourceCode = code;
        if (this._status !== 'solved') this._status = 'viewed-solution';
        this._confirmingSolution = false;
        this._testReport = undefined;
        this._saveState();
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
                .permalink=${false}
                .onRun=${() => this.runTests()}
                layout=${this.layout}
                session=${this.session}
                orientation=${this.orientation}
                timeout=${this.timeout}
                zip=${this.zip}
                @bottom-change="${this._onCodeChange}"
                @bottom-clear="${this.resetCode}"
            >${this._starterCode}</bottom-editor>
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
        if (!this._resolvedSolution()) return nothing;
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
        }
        exercise-prompt {
            display: block;
        }
        bottom-editor {
            max-height: initial;
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
