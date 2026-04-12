import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'
import { EditorView } from "@codemirror/view"
import PyodideWorker from './pyodide-worker.ts?worker&inline';
import { joinSession, leaveSession, type MemberCallbacks, EditorHandle } from './session-registry.js';
import type { TestReport, TestResult } from './pyodide-runtime.js';
export type { TestReport, TestResult };
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
    private runtime!: EditorHandle;
    private _memberCallbacks?: MemberCallbacks;
    private _readyResolve!: () => void;
    /** Resolves when Pyodide is ready. Useful for testing. */
    readonly ready: Promise<void> = new Promise(r => { this._readyResolve = r; });

    @property({ reflect: true })
    layout: string = 'console';

    @property()
    session: string = '';

    @property({ type: Boolean, reflect: true })
    showclear = false;

    /** When true, the clear button becomes "Reset" and also re-runs readyCode. */
    @property({ type: Boolean, reflect: true })
    resetmode = false;

    /** When false, the permalink button is hidden. Default: true. */
    @property({ type: Boolean })
    permalink = true;

    @property({ type: Boolean, reflect: true })
    showswitcher = false;

    /** 'auto' (default) | 'horizontal' | 'vertical' */
    @property({ reflect: true })
    orientation: string = 'auto';

    /** Run timeout in seconds, or "inf" for no timeout. Default: 30. */
    @property()
    timeout: string = '30';

    /**
     * Code that runs silently when Pyodide is ready (output discarded).
     * Useful for initialising state before the first user run.
     */
    @property({ attribute: false })
    readyCode: string = '';

    /** Trigger fit-to-content on the canvas after every run and after readyCode. */
    @property({ type: Boolean })
    autofit = false;

    // Internal switcher state — only meaningful when showswitcher=true.
    // Initialised from the `layout` attribute in firstUpdated(); kept in sync
    // back to `layout` via updated() so CSS grid rules and copyPermalink work.
    @state() private _swCanvas  = true;
    @state() private _swConsole = true;

    /** Code prepended before the editor contents at run time (not shown in editor). */
    /**
     * When set, the Run button calls this instead of evaluatePython().
     * Used by <bottom-exercise> to wire Run → runTests().
     */
    @property({ attribute: false })
    onRun?: () => void | Promise<void>;

    @property({ attribute: false })
    codePrefix: string = '';

    /**
     * Optional transform applied to the full code (codePrefix + editor text)
     * just before execution. Use this to inject wrapping or rewrite syntax.
     */
    @property({ attribute: false })
    transformCode?: (code: string) => string;

    /**
     * Override the default permalink behaviour. If set, this function is called
     * instead of copyPermalink()'s built-in URL builder.
     */
    @property({ attribute: false })
    permalinkCallback?: () => void;

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

    private _parseTimeout(): number {
        const v = this.timeout.trim().toLowerCase();
        if (v === 'inf' || v === 'infinity') return Infinity;
        return parseFloat(v) * 1000;
    }

    async firstUpdated() {
        // Seed switcher state from the initial layout attribute.
        if (this.showswitcher) {
            this._swCanvas  = this.layout !== 'console';
            this._swConsole = this.layout !== 'canvas';
            this.layout = 'split';
        }

        const text = this._pendingCode ?? this.getSourceCode();
        this._editor = createPythonEditor(this._code!, text, () => this.onRun ? this.onRun() : this.evaluatePython());
        if (this._buttons) this._buttons.vertical = text.split('\n', 6).length >= 4;

        const canvasEl = this.renderRoot.querySelector('bottom-editor-canvas') as BottomEditorCanvas | null;
        if (canvasEl) await canvasEl.updateComplete;

        this._output?.addLog('Initializing...');

        this._memberCallbacks = {
            onLog:   (data) => this._output?.addLog(data),
            onError: (data) => this._output?.addOutput(data),
            onReady: async () => {
                this._output?.clearOutput();
                this._output?.addLog('Python Ready!');
                this._readyResolve();
                if (canvasEl) {
                    this._offscreenCanvas = canvasEl.transferToOffscreen();
                    await this.runtime.setCanvas(this._offscreenCanvas);
                }
                const zip = this.getAttribute('zip');
                if (zip) await this.installFilesFromZip(zip);
                if (this.readyCode) {
                    await this.runtime.run(this.readyCode, () => {});
                    if (this.autofit) this._handleFitRequest();
                }
                const autorun = this.getAttribute('autorun');
                if (autorun !== null && autorun !== 'false' && autorun !== '0') this.evaluatePython();
            },
        };

        // All editors share a session. No session attr → implicit '__default__'
        // (one shared worker per page). Use a unique id for true isolation.
        this.runtime = joinSession(
            this.session || '__default__',
            this._memberCallbacks,
            () => new PyodideWorker() as unknown as Worker,
            undefined,
            this._parseTimeout(),
        );
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        if (this._memberCallbacks) {
            leaveSession(this.session || '__default__', this._memberCallbacks);
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
        const raw  = this.codePrefix + this._editor.state.doc.toString();
        const code = this.transformCode ? this.transformCode(raw) : raw;
        if (this._buttons) this._buttons.running = true;
        try {
            await this.runtime.run(code, (data: string) => this._output?.addOutput(data));
            if (this.autofit) this._handleFitRequest();
        } catch (err: any) {
            let msg = err?.toString() ?? String(err);
            // Strip traceback — keep only the last exception line.
            const lastNewline = msg.lastIndexOf('\n', msg.length - 2);
            if (lastNewline > 0 && msg.includes('  File "<exec>"'))
                msg = msg.substring(lastNewline + 1).trim();
            this._output?.addOutput(msg);
        } finally {
            if (this._buttons) this._buttons.running = false;
        }
    }

    /**
     * Run the editor's code, then run test assertions in the same Python
     * namespace. Returns a structured TestReport with per-assertion results.
     */
    async evaluateWithTests(tests: string): Promise<TestReport> {
        if (!this._editor) {
            return { passed: false, results: [{ passed: false, test: '<error>', message: 'Editor not initialized' }] };
        }
        this._output?.clearOutput();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
        const raw  = this.codePrefix + this._editor.state.doc.toString();
        const code = this.transformCode ? this.transformCode(raw) : raw;
        if (this._buttons) this._buttons.running = true;
        try {
            return await this.runtime.runWithTests(code, tests, (data: string) => this._output?.addOutput(data));
        } catch (err: any) {
            let msg = err?.toString() ?? String(err);
            const lastNewline = msg.lastIndexOf('\n', msg.length - 2);
            if (lastNewline > 0 && msg.includes('  File "<exec>"'))
                msg = msg.substring(lastNewline + 1).trim();
            this._output?.addOutput(msg);
            return { passed: false, results: [{ passed: false, test: '<user code>', message: msg }] };
        } finally {
            if (this._buttons) this._buttons.running = false;
        }
    }

    async installFilesFromZip(url: string) {
        this._output?.addLog(`Loading ${url}...`);
        await this.runtime.loadZip(url);
    }

    async copyPermalink() {
        if (this.permalinkCallback) { this.permalinkCallback(); return; }
        // FIXME allow permalink base to be configured
        const url = new URL("https://bottom.ch/editor/stable/");
        url.searchParams.set('code', this.sourceCode);
        const defaultLayout = this.showswitcher ? 'split' : 'console';
        if (this.layout !== defaultLayout) url.searchParams.set('layout', this.layout);
        const zip = this.getAttribute("zip");
        if (zip) url.searchParams.set('zip', zip);
        if (this.timeout !== '30') url.searchParams.set('timeout', this.timeout);
        navigator.clipboard.writeText(url.href);
    }

    private async clearAll() {
        this._output?.clearOutput();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
        if (this.resetmode && this.readyCode) {
            await this.runtime.run(this.readyCode, () => {});
        }
    }

    private _handleFitRequest() {
        const canvasEl = this.renderRoot.querySelector('bottom-editor-canvas') as BottomEditorCanvas | null;
        if (!canvasEl) return;
        this.runtime.requestFit((bounds: Parameters<typeof canvasEl.applyFit>[0]) => canvasEl.applyFit(bounds));
    }

    override updated(changed: Map<string, unknown>) {
        // Keep layout attribute in sync with switcher toggles so CSS grid
        // rules and copyPermalink both see the correct effective layout.
        if (this.showswitcher && (changed.has('_swCanvas') || changed.has('_swConsole'))) {
            if (this._swCanvas && this._swConsole) this.layout = 'split';
            else if (this._swCanvas)               this.layout = 'canvas';
            else                                   this.layout = 'console';
        }
    }

    private _toggleSwCanvas() {
        if (this._swCanvas && !this._swConsole) { this._swConsole = true; return; }
        this._swCanvas = !this._swCanvas;
    }

    private _toggleSwConsole() {
        if (this._swConsole && !this._swCanvas) { this._swCanvas = true; return; }
        this._swConsole = !this._swConsole;
    }

    render() {
        const hasCanvas = this.layout === 'canvas' || this.layout === 'split';
        const hasOutput = this.layout !== 'canvas';

        // When showswitcher is on, always render both canvas+output inside a
        // flex-column wrapper with a clickable rail between them.
        const outputArea = this.showswitcher
            ? html`
                <div class="split-col">
                    <bottom-editor-canvas
                        class="${this._swCanvas ? '' : 'sw-hidden'}"
                        @bottom-fit="${this._handleFitRequest}">
                    </bottom-editor-canvas>
                    <div class="sw-rail">
                        <button class="sw-tab ${this._swCanvas ? 'open' : 'closed'}"
                                @click="${this._toggleSwCanvas}">▲ Canvas</button>
                        <button class="sw-tab ${this._swConsole ? 'open' : 'closed'}"
                                @click="${this._toggleSwConsole}">Console ▼</button>
                    </div>
                    <bottom-editor-output
                        class="${this._swConsole ? '' : 'sw-hidden'}">
                    </bottom-editor-output>
                </div>`
            : html`
                ${hasCanvas ? html`<bottom-editor-canvas @bottom-fit="${this._handleFitRequest}"></bottom-editor-canvas>` : ''}
                ${hasOutput ? html`<bottom-editor-output></bottom-editor-output>` : ''}`;

        return html`
            <bottom-editorarea>
                <bottom-code id="code"></bottom-code>
                ${outputArea}
                <bottom-editor-buttons
                    part="buttons"
                    ?showclear="${this.showclear}"
                    ?resetmode="${this.resetmode}"
                    .permalink=${this.permalink}
                    @bottom-run="${() => this.onRun ? this.onRun() : this.evaluatePython()}"
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
