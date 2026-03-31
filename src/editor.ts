import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { EditorView } from "@codemirror/view"
import { base64ToText } from './encoder.js'
import { PyodideRuntime } from './pyodide-runtime.js';
import { createPythonEditor } from './codemirror-setup.js';
// Side-effect imports: execute the modules so customElements.define() runs.
import './bottom-editor-output.js';
import './bottom-editor-buttons.js';
import type { BottomEditorOutput } from './bottom-editor-output.js';
import type { BottomEditorButtons } from './bottom-editor-buttons.js';
import styles from './bottom-editor.css?inline';

// Allow Python code to call input() via a browser prompt.
declare global {
    function input_fixed(msg: string): string | null;
}
globalThis.input_fixed = (msg: string) => prompt(msg);

@customElement('bottom-editor')
export class BottomEditor extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };
    static styles = unsafeCSS(styles);

    private _editor?: EditorView;
    private runtime!: PyodideRuntime;

    @property({ attribute: 'sourcecode' })
    set sourceCode(code: string) { this.replaceDoc(code); }
    get sourceCode() { return this._editor?.state.doc.toString() ?? ''; }

    @query('#code')
    private _code?: Element;

    @query('bottom-editor-output')
    private _output?: BottomEditorOutput;

    @query('bottom-editor-buttons')
    private _buttons?: BottomEditorButtons;

    private getSourceCode(): string {
        const encoded = this.getAttribute("code");
        if (encoded) return base64ToText(encoded);
        return Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent)
            .join('')
            .replace(/^\s*\n/, '') || '';
    }

    firstUpdated() {
        const text = this.getSourceCode();
        this._editor = createPythonEditor(this._code!, text, () => this.evaluatePython());
        if (this._buttons) this._buttons.vertical = text.split('\n', 6).length > 5;

        this._output?.addLog('Initializing...');

        this.runtime = new PyodideRuntime({
            onStdout: (data) => this._output?.addOutput(data),
            onLog:    (data) => this._output?.addLog(data),
            onError:  (data) => this._output?.addOutput(data),
            onReady:  () => {
                this._output?.clearOutput();
                this._output?.addLog('Python Ready!');
            },
        });
        this.runtime.start();

        if (this.hasAttribute("autorun")) {
            const v = this.getAttribute("autorun");
            if (v !== 'false' && v !== '0') this.evaluatePython();
        }
    }

    public replaceDoc(text: string) {
        const state = this._editor?.state;
        if (!state) return;
        this._editor!.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text } }));
    }

    async evaluatePython() {
        if (!this._editor) return;
        this._output?.clearOutput();
        const code = this._editor.state.doc.toString();
        if (this._buttons) this._buttons.running = true;
        try {
            await this.runtime.run(code);
        } catch (err: any) {
            let msg = err?.toString() ?? String(err);
            const idx = msg.indexOf('  File "<exec>"');
            if (idx > 0) msg = msg.substring(idx);
            this._output?.addOutput(msg);
        } finally {
            if (this._buttons) this._buttons.running = false;
        }
    }

    async installFilesFromZip(url: string) {
        this._output?.addLog(`Loading ${url}...`);
        await this.runtime.loadZip(url);
    }

    async copyPermalink() {
        const url = new URL("https://bottom.ch/ksr/ed/");
        url.searchParams.set('code', this.sourceCode);
        const zip = this.getAttribute("zip");
        if (zip) url.searchParams.set('zip', zip);
        navigator.clipboard.writeText(url.href);
    }

    render() {
        return html`
            <bottom-container>
                <bottom-editorarea>
                    <bottom-code id="code"></bottom-code>
                    <bottom-editor-output></bottom-editor-output>
                    <bottom-editor-buttons
                        part="buttons"
                        @bottom-run="${this.evaluatePython}"
                        @bottom-stop="${() => this.runtime.interrupt()}"
                        @bottom-clear="${() => this._output?.clearOutput()}"
                        @bottom-permalink="${this.copyPermalink}"
                    ></bottom-editor-buttons>
                </bottom-editorarea>
            </bottom-container>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor': BottomEditor
    }
}
