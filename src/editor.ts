import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { EditorView } from "@codemirror/view"
import PyodideWorker from './pyodide-worker.ts?worker&inline';
import { PyodideRuntime } from './pyodide-runtime.js';
import { joinSession, leaveSession, type MemberCallbacks } from './session-registry.js';
import { createPythonEditor } from './codemirror-setup.js';
// Side-effect imports: execute the modules so customElements.define() runs.
import './bottom-editor-output.js';
import './bottom-editor-buttons.js';
import './bottom-editor-canvas.js';
import type { BottomEditorOutput } from './bottom-editor-output.js';
import type { BottomEditorButtons } from './bottom-editor-buttons.js';
import type { BottomEditorCanvas } from './bottom-editor-canvas.js';
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
    private _pendingCode?: string;
    private _offscreenCanvas?: OffscreenCanvas;
    private runtime!: PyodideRuntime;
    private _memberCallbacks?: MemberCallbacks;

    @property({ reflect: true })
    layout: string = 'console';

    @property()
    session: string = '';

    @property({ attribute: 'sourcecode' })
    set sourceCode(code: string) { this.replaceDoc(code); }
    get sourceCode() { return this._editor?.state.doc.toString() ?? ''; }

    get outputText(): string { return this._output?.outputText ?? ''; }
    get logText(): string { return this._output?.logText ?? ''; }

    @query('#code')
    private _code?: Element;

    @query('bottom-editor-output')
    private _output?: BottomEditorOutput;

    @query('bottom-editor-buttons')
    private _buttons?: BottomEditorButtons;

    private getSourceCode(): string {
        return Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent)
            .join('')
            .replace(/^\s*\n/, '') || '';
    }

    async firstUpdated() {
        const text = this._pendingCode ?? this.getSourceCode();
        this._editor = createPythonEditor(this._code!, text, () => this.evaluatePython());
        if (this._buttons) this._buttons.vertical = text.split('\n', 6).length > 5;

        const canvasEl = this.renderRoot.querySelector('bottom-editor-canvas') as BottomEditorCanvas | null;
        if (canvasEl) await canvasEl.updateComplete;

        this._output?.addLog('Initializing...');

        this._memberCallbacks = {
            onLog:   (data) => this._output?.addLog(data),
            onError: (data) => this._output?.addOutput(data),
            onReady: async () => {
                this._output?.clearOutput();
                this._output?.addLog('Python Ready!');
                if (canvasEl) {
                    this._offscreenCanvas = canvasEl.transferToOffscreen();
                    await this.runtime.setCanvas(this._offscreenCanvas);
                }
                const zip = this.getAttribute('zip');
                if (zip) await this.installFilesFromZip(zip);
                const autorun = this.getAttribute('autorun');
                if (autorun !== null && autorun !== 'false' && autorun !== '0') this.evaluatePython();
            },
        };

        if (this.session) {
            this.runtime = joinSession(
                this.session,
                this._memberCallbacks,
                () => new PyodideWorker() as unknown as Worker,
            );
        } else {
            this.runtime = new PyodideRuntime(
                this._memberCallbacks,
                () => new PyodideWorker() as unknown as Worker,
            );
            this.runtime.start();
        }
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        if (this.session && this._memberCallbacks) {
            leaveSession(this.session, this._memberCallbacks);
        } else {
            this.runtime?.terminate();
        }
    }

    public replaceDoc(text: string) {
        if (!this._editor) {
            this._pendingCode = text;
            return;
        }
        const state = this._editor.state;
        this._editor.dispatch(state.update({ changes: { from: 0, to: state.doc.length, insert: text } }));
    }

    /** Sample a canvas pixel in OffscreenCanvas coordinates. For testing. */
    samplePixel(x: number, y: number) {
        return this.runtime.samplePixel(x, y);
    }

    async evaluatePython() {
        if (!this._editor) return;
        this._output?.clearOutput();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
        const code = this._editor.state.doc.toString();
        if (this._buttons) this._buttons.running = true;
        try {
            await this.runtime.run(code, (data) => this._output?.addOutput(data));
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
        // FIXME allow permalink base to be configured
        const url = new URL("https://bottom.ch/editor/stable/");
        url.searchParams.set('code', this.sourceCode);
        if (this.layout !== 'console') url.searchParams.set('layout', this.layout);
        const zip = this.getAttribute("zip");
        if (zip) url.searchParams.set('zip', zip);
        navigator.clipboard.writeText(url.href);
    }

    private clearAll() {
        this._output?.clearOutput();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
    }

    private _handleFitRequest() {
        const canvasEl = this.renderRoot.querySelector('bottom-editor-canvas') as BottomEditorCanvas | null;
        if (!canvasEl) return;
        this.runtime.requestFit(bounds => canvasEl.applyFit(bounds));
    }

    render() {
        const hasCanvas = this.layout === 'canvas' || this.layout === 'split';
        const hasOutput = this.layout !== 'canvas';
        return html`
            <bottom-editorarea>
                <bottom-code id="code"></bottom-code>
                ${hasCanvas ? html`<bottom-editor-canvas @bottom-fit="${this._handleFitRequest}"></bottom-editor-canvas>` : ''}
                ${hasOutput ? html`<bottom-editor-output></bottom-editor-output>` : ''}
                <bottom-editor-buttons
                    part="buttons"
                    @bottom-run="${this.evaluatePython}"
                    @bottom-stop="${() => this.runtime.interrupt()}"
                    @bottom-clear="${this.clearAll}"
                    @bottom-permalink="${this.copyPermalink}"
                ></bottom-editor-buttons>
            </bottom-editorarea>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor': BottomEditor
    }
}
