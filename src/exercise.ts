import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import './editor.js' // side-effect: registers <bottom-editor>
import type { BottomEditor } from './editor.js'
import type { TestReport } from './pyodide-runtime.js'

/**
 * <bottom-exercise> wraps a <bottom-editor> with exercise semantics:
 * a prompt, starter code, test assertions, and a test results display.
 *
 * Usage:
 *   <bottom-exercise exercise-id="sum-to">
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

    @state()
    private _testReport?: TestReport;

    @query('bottom-editor')
    private _editor?: BottomEditor;

    private _starterCode: string = '';
    private _testCode: string = '';

    connectedCallback() {
        super.connectedCallback();
        const starterTemplate = this.querySelector('template[data-type="starter"]') as HTMLTemplateElement | null;
        if (starterTemplate) {
            this._starterCode = BottomExercise.dedent(starterTemplate.content.textContent || '');
        }
        const testTemplate = this.querySelector('template[data-type="test"]') as HTMLTemplateElement | null;
        if (testTemplate) {
            this._testCode = BottomExercise.dedent(testTemplate.content.textContent || '');
        }
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
        if (!this._editor || !this._testCode) return;
        this._testReport = undefined;
        this._testReport = await this._editor.evaluateWithTests(this._testCode);
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
        }
    }

    render() {
        return html`
            <exercise-prompt>
                <slot name="prompt"></slot>
            </exercise-prompt>
            <bottom-editor
                showclear
                resetmode
                .permalink=${false}
                .onRun=${() => this.runTests()}
                @bottom-clear="${this.resetCode}"
            >${this._starterCode}</bottom-editor>
            ${this._renderResults()}
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

    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-exercise': BottomExercise
    }
}
