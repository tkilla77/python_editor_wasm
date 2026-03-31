import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import styles from './bottom-editor-output.css?inline';
import { appendOutput } from './output-buffer.js';

@customElement('bottom-editor-output')
export class BottomEditorOutput extends LitElement {
    static styles = unsafeCSS(styles);

    @query('#output')
    private _output?: HTMLTextAreaElement;

    @query('#log')
    private _log?: HTMLElement;

    get outputText(): string { return this._output?.value ?? ''; }
    get logText(): string { return this._log?.textContent ?? ''; }

    clearOutput() {
        if (this._output) this._output.value = '';
    }

    addOutput(text: string) {
        if (!this._output) return;
        this._output.value = appendOutput(this._output.value, text);
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
