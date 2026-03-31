import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import styles from './bottom-editor-output.css?inline';

const MAX_OUTPUT_LINES = 100;
const MAX_OUTPUT_CHARS = 5000;

@customElement('bottom-editor-output')
export class BottomEditorOutput extends LitElement {
    static styles = unsafeCSS(styles);

    @query('#output')
    private _output?: HTMLTextAreaElement;

    @query('#log')
    private _log?: HTMLElement;

    clearOutput() {
        if (this._output) this._output.value = '';
    }

    addOutput(text: string) {
        if (!this._output) return;
        let current = this._output.value + text;

        // Remove stale trim notice before recalculating
        if (current.startsWith('...[output trimmed:')) {
            const nl = current.indexOf('\n');
            if (nl > 0) current = current.slice(nl + 1);
        }

        const noticeParts: string[] = [];

        const lines = current.split(/\r?\n/);
        if (lines.length > MAX_OUTPUT_LINES) {
            noticeParts.push(`${lines.length - MAX_OUTPUT_LINES} lines`);
            current = lines.slice(-MAX_OUTPUT_LINES).join('\n');
        }

        if (current.length > MAX_OUTPUT_CHARS) {
            noticeParts.push(`~${current.length - MAX_OUTPUT_CHARS} chars`);
            current = current.slice(-MAX_OUTPUT_CHARS);
            const nl = current.indexOf('\n');
            if (nl > 0) current = current.slice(nl + 1);
        }

        this._output.value = noticeParts.length > 0
            ? `...[output trimmed: ${noticeParts.join(', ')}]...\n` + current
            : current;
    }

    addLog(text: string) {
        if (!this._log) return;
        this._log.textContent += text + '\n';
        this._log.scrollTop = this._log.scrollHeight;
    }

    render() {
        return html`
            <textarea readonly id="output" name="output"></textarea>
            <details id="log-details">
                <summary title="System log">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 2.5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M6 8.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </summary>
                <div id="log"></div>
            </details>`;
    }
}
