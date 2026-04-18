import { LitElement, html, nothing, unsafeCSS } from 'lit'
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
import { getPageId } from './page-id.js';
import { LocalStorageAdapter, type ExerciseState } from './exercise-state.js';
import { StorageManager, initStorageManager } from './storage-manager.js';
import type { BackendId } from './storage-manager.js';

// Detect OAuth redirect returns on every page load (no-op if none pending).
initStorageManager();

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
    private _initialCode: string = '';
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

    /** When true, the revert button is never shown even if a storage key exists. */
    @property({ type: Boolean })
    norevert = false;

    /**
     * Storage backend. 'local' persists code in localStorage keyed by the
     * element's `id` + page URL. 'none' disables storage. Defaults to 'local'
     * when an `id` is present, otherwise no storage.
     * Global default can be set via window.BottomEditorConfig = { storage: '...' }.
     */
    @property()
    storage: string = '';

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
    permalinkCallback?: () => Promise<void> | void;

    /**
     * Override the storage key used for persistence. When set, bypasses the
     * id+storage attribute logic and uses this key directly. Used by
     * <bottom-exercise> to share a key with its own exercise state.
     */
    @property({ attribute: false })
    storageKey: string = '';

    /**
     * Called at save time; returned fields are merged into the saved state
     * alongside the code. Used by <bottom-exercise> to persist exercise
     * metadata (status, attempts, solvedAt) through the same storage path.
     */
    @property({ attribute: false })
    stateSaver?: () => Record<string, unknown>;

    /**
     * Called when state is loaded from localStorage or the cloud. The argument
     * is the full saved state object. Used by <bottom-exercise> to restore
     * exercise metadata from the loaded state.
     */
    @property({ attribute: false })
    stateLoader?: (saved: Record<string, unknown>) => void;

    // ── Cloud sync state ───────────────────────────────────────────────────────
    @state() private _syncBackend: BackendId = 'local';
    @state() private _cloudSyncing = false;
    @state() private _showSyncPicker = false;
    @state() private _shareState: 'idle' | 'copied' | 'error' = 'idle';
    private readonly _local = new LocalStorageAdapter();
    private _cloudSaveTimer?: ReturnType<typeof setTimeout>;

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

    /**
     * Resolved storage key for persistence. Returns null when storage is
     * disabled (`storage="none"`) or when no id is present. An explicit
     * `storageKey` property (set by <bottom-exercise>) bypasses id/storage
     * attribute checks entirely.
     */
    private _effectiveStorageKey(): string | null {
        if (this.storageKey) return this.storageKey;
        if (!this.id) return null;
        const storage = this.storage || (window as any).BottomEditorConfig?.storage || '';
        if (storage === 'none') return null;
        return `bottom-editor:${getPageId()}:${this.id}`;
    }

    /**
     * Cloud backends available in this context: intersection of what was
     * compiled in (client IDs present at build time) and what the site/page
     * author allows via window.BottomEditorConfig.storageBackends.
     *
     * Site-wide:  <script>window.BottomEditorConfig = { storageBackends: ['microsoft'] }</script>
     */
    private _availableBackends(): Array<'google' | 'microsoft'> {
        const compiled: Array<'google' | 'microsoft'> = [];
        if (import.meta.env.VITE_GOOGLE_CLIENT_ID)    compiled.push('google');
        if (import.meta.env.VITE_MICROSOFT_CLIENT_ID) compiled.push('microsoft');
        const allowed: unknown = (window as any).BottomEditorConfig?.storageBackends;
        if (!Array.isArray(allowed)) return compiled;
        return compiled.filter(b => allowed.includes(b));
    }

    private _syncAvailable(): boolean {
        return !!this._effectiveStorageKey() && this._availableBackends().length > 0;
    }

    // ── Persistence ────────────────────────────────────────────────────────────

    private _saveState(): void {
        const key = this._effectiveStorageKey();
        if (!key) return;
        const extra = this.stateSaver?.() ?? {};
        const state: ExerciseState = {
            exerciseId: key,
            code:       this.sourceCode,
            status:     (extra.status   as ExerciseState['status']) ?? 'started',
            attempts:   (extra.attempts as number)                  ?? 0,
            solvedAt:   extra.solvedAt  as number | undefined,
        };
        this._local.save(key, state);
        if (this._syncBackend !== 'local') {
            clearTimeout(this._cloudSaveTimer);
            this._cloudSaveTimer = setTimeout(() => {
                StorageManager.instance.adapter.save(key, state).catch(err =>
                    console.warn('Cloud save failed:', err),
                );
            }, 2000);
        }
    }

    /** Trigger an immediate save (used by <bottom-exercise> after state transitions). */
    saveNow(): void { this._saveState(); }

    private _applyState(saved: ExerciseState): void {
        if (saved.code !== this._initialCode) {
            this.replaceDoc(saved.code);
        }
        this.stateLoader?.(saved);
    }

    private async _loadFromCloud(): Promise<void> {
        const key = this._effectiveStorageKey();
        if (!key) return;
        this._cloudSyncing = true;
        try {
            const cloud = await StorageManager.instance.adapter.load(key);
            if (cloud) this._applyState(cloud);
        } catch (err) {
            console.warn('Cloud load failed, using local cache:', err);
        } finally {
            this._cloudSyncing = false;
        }
    }

    private _onStorageChange = (ev: Event) => {
        const newBackend = (ev as CustomEvent<{ backend: BackendId }>).detail.backend;
        const wasLocal = this._syncBackend === 'local';
        this._syncBackend = newBackend;
        this._showSyncPicker = false;
        if (wasLocal && newBackend !== 'local') {
            this._loadFromCloud();
        }
    };

    private async _onSync() {
        if (this._syncBackend !== 'local') {
            StorageManager.instance.disconnect(this._syncBackend as 'google' | 'microsoft');
        } else {
            this._showSyncPicker = !this._showSyncPicker;
        }
    }

    private async _connectBackend(backend: 'google' | 'microsoft') {
        this._showSyncPicker = false;
        try {
            await StorageManager.instance.connect(backend);
        } catch (err) {
            console.error('Cloud sync connect failed:', err);
        }
    }

    // ── Revert ─────────────────────────────────────────────────────────────────

    revertCode() {
        this.replaceDoc(this._initialCode);
        const key = this._effectiveStorageKey();
        if (key) this._saveState(); // overwrite saved state with initial code
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    async firstUpdated() {
        // Seed switcher state from the initial layout attribute.
        if (this.showswitcher) {
            this._swCanvas  = this.layout !== 'console';
            this._swConsole = this.layout !== 'canvas';
            this.layout = 'split';
        }

        const text = this._pendingCode ?? this.getSourceCode();
        this._initialCode = text;
        this._editor = createPythonEditor(
            this._code!,
            text,
            () => this.onRun ? this.onRun() : this.evaluatePython(),
            () => {
                this.dispatchEvent(new CustomEvent('bottom-change', { bubbles: true, composed: true }));
                this._saveState();
            },
        );
        if (this._buttons) this._buttons.vertical = text.split('\n', 6).length >= 4;

        // ── Cloud sync init ───────────────────────────────────────────────────
        this._syncBackend = StorageManager.instance.backend;
        window.addEventListener('bottom-storage-change', this._onStorageChange);

        const key = this._effectiveStorageKey();
        if (key) {
            // Migrate old plain-string localStorage format to adapter format.
            // Old format: localStorage['bottom-editor:pageId:id'] = 'code string'
            // New format: localStorage['bottom-exercise:bottom-editor:pageId:id'] = JSON
            if (!this.storageKey && this.id) {
                const oldKey = `bottom-editor:${getPageId()}:${this.id}`;
                const oldValue = localStorage.getItem(oldKey);
                if (oldValue !== null) {
                    await this._local.save(key, {
                        exerciseId: key, code: oldValue, status: 'started', attempts: 0,
                    });
                    localStorage.removeItem(oldKey);
                }
            }

            // Cache-first: apply localStorage immediately (zero delay).
            const cached = await this._local.load(key);
            if (cached) this._applyState(cached);

            // Background cloud sync if already connected.
            if (this._syncBackend !== 'local') {
                await this._loadFromCloud();
            }
        }

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
        window.removeEventListener('bottom-storage-change', this._onStorageChange);
        clearTimeout(this._cloudSaveTimer);
    }

    // ── Public API ─────────────────────────────────────────────────────────────

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
        try {
            if (this.permalinkCallback) {
                await this.permalinkCallback();
            } else {
                // FIXME allow permalink base to be configured
                const url = new URL("https://bottom.ch/editor/stable/");
                url.searchParams.set('code', this.sourceCode);
                const defaultLayout = this.showswitcher ? 'split' : 'console';
                if (this.layout !== defaultLayout) url.searchParams.set('layout', this.layout);
                const zip = this.getAttribute("zip");
                if (zip) url.searchParams.set('zip', zip);
                if (this.timeout !== '30') url.searchParams.set('timeout', this.timeout);
                await navigator.clipboard.writeText(url.href);
            }
            this._shareState = 'copied';
        } catch {
            this._shareState = 'error';
        }
        setTimeout(() => this._shareState = 'idle', 2000);
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

    // ── Render ─────────────────────────────────────────────────────────────────

    render() {
        const hasCanvas  = this.layout === 'canvas' || this.layout === 'split';
        const hasOutput  = this.layout !== 'canvas';
        const backends   = this._availableBackends();
        const syncBackend = this._cloudSyncing ? 'syncing' : this._syncBackend;

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
                    .shareState=${this._shareState}
                    ?showrevert="${!this.norevert && !!this._effectiveStorageKey()}"
                    ?showsync="${this._syncAvailable()}"
                    syncbackend="${syncBackend}"
                    @bottom-run="${() => this.onRun ? this.onRun() : this.evaluatePython()}"
                    @bottom-stop="${() => this.runtime.interrupt()}"
                    @bottom-clear="${this.clearAll}"
                    @bottom-revert="${this.revertCode}"
                    @bottom-permalink="${this.copyPermalink}"
                    @bottom-sync="${this._onSync}"
                ></bottom-editor-buttons>
            </bottom-editorarea>
            ${this._showSyncPicker ? html`
                <editor-sync-picker>
                    <span>Connect cloud sync:</span>
                    ${backends.includes('google') ? html`
                        <button @click="${() => this._connectBackend('google')}">
                            <svg class="provider-icon" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                                <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/>
                                <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/>
                                <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                                <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                                <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                            </svg>
                            Google Drive™
                        </button>` : nothing}
                    ${backends.includes('microsoft') ? html`
                        <button @click="${() => this._connectBackend('microsoft')}">
                            <svg class="provider-icon" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="35.98 139.2 648.03 430.85" aria-hidden="true">
                                <defs>
                                    <radialGradient id="od-r0" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(130.864814,156.804864,-260.089994,217.063603,48.669602,228.766494)">
                                        <stop offset="0" style="stop-color:rgb(28.235294%,58.039216%,99.607843%);stop-opacity:1;"/>
                                        <stop offset="0.695072" style="stop-color:rgb(3.529412%,20.392157%,70.196078%);stop-opacity:1;"/>
                                    </radialGradient>
                                    <radialGradient id="od-r1" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(-575.289668,663.594003,-491.728488,-426.294267,596.956501,-6.380235)">
                                        <stop offset="0.165327" style="stop-color:rgb(13.72549%,75.294118%,99.607843%);stop-opacity:1;"/>
                                        <stop offset="0.534" style="stop-color:rgb(10.980392%,56.862745%,100%);stop-opacity:1;"/>
                                    </radialGradient>
                                    <radialGradient id="od-r2" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(-136.753383,-114.806698,262.816935,-313.057562,181.196995,240.395994)">
                                        <stop offset="0" style="stop-color:rgb(100%,100%,100%);stop-opacity:0.4;"/>
                                        <stop offset="0.660528" style="stop-color:rgb(67.843137%,75.294118%,100%);stop-opacity:0;"/>
                                    </radialGradient>
                                    <radialGradient id="od-r3" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(-153.638428,-130.000063,197.433014,-233.332948,375.353994,451.43549)">
                                        <stop offset="0" style="stop-color:rgb(1.176471%,22.745098%,80%);stop-opacity:1;"/>
                                        <stop offset="1" style="stop-color:rgb(21.176471%,55.686275%,100%);stop-opacity:0;"/>
                                    </radialGradient>
                                    <radialGradient id="od-r4" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(175.585899,405.198026,-437.434522,189.555055,169.378495,125.589294)">
                                        <stop offset="0.592618" style="stop-color:rgb(20.392157%,39.215686%,89.019608%);stop-opacity:0;"/>
                                        <stop offset="1" style="stop-color:rgb(1.176471%,22.745098%,80%);stop-opacity:0.6;"/>
                                    </radialGradient>
                                    <radialGradient id="od-r5" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(-459.329491,459.329491,-719.614455,-719.614455,589.876499,39.484649)">
                                        <stop offset="0" style="stop-color:rgb(29.411765%,99.215686%,90.980392%);stop-opacity:0.898039;"/>
                                        <stop offset="0.543937" style="stop-color:rgb(29.411765%,99.215686%,90.980392%);stop-opacity:0;"/>
                                    </radialGradient>
                                    <linearGradient id="od-l0" gradientUnits="userSpaceOnUse" x1="29.999701" y1="37.9823" x2="29.999701" y2="18.398199" gradientTransform="matrix(15,0,0,15,0,0)">
                                        <stop offset="0" style="stop-color:rgb(0%,52.54902%,100%);stop-opacity:1;"/>
                                        <stop offset="0.49" style="stop-color:rgb(0%,73.333333%,100%);stop-opacity:1;"/>
                                    </linearGradient>
                                    <radialGradient id="od-r6" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(273.622108,108.513684,-205.488428,518.148261,296.488495,307.441492)">
                                        <stop offset="0" style="stop-color:rgb(100%,100%,100%);stop-opacity:0.4;"/>
                                        <stop offset="0.785262" style="stop-color:rgb(100%,100%,100%);stop-opacity:0;"/>
                                    </radialGradient>
                                    <radialGradient id="od-r7" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(-305.683909,263.459223,-264.352324,-306.720147,674.845505,249.378004)">
                                        <stop offset="0" style="stop-color:rgb(29.411765%,99.215686%,90.980392%);stop-opacity:0.898039;"/>
                                        <stop offset="0.584724" style="stop-color:rgb(29.411765%,99.215686%,90.980392%);stop-opacity:0;"/>
                                    </radialGradient>
                                </defs>
                                <path style="fill:url(#od-r0);" d="M 215.078125 205.089844 C 116.011719 205.09375 41.957031 286.1875 36.382812 376.527344 C 39.835938 395.992188 51.175781 434.429688 68.941406 432.457031 C 91.144531 429.988281 147.066406 432.457031 194.765625 346.105469 C 229.609375 283.027344 301.285156 205.085938 215.078125 205.089844 Z"/>
                                <path style="fill:url(#od-r1);" d="M 192.171875 238.8125 C 158.871094 291.535156 114.042969 367.085938 98.914062 390.859375 C 80.929688 419.121094 33.304688 407.113281 37.25 366.609375 C 36.863281 369.894531 36.5625 373.210938 36.355469 376.546875 C 29.84375 481.933594 113.398438 569.453125 217.375 569.453125 C 331.96875 569.453125 605.269531 426.671875 577.609375 283.609375 C 548.457031 199.519531 466.523438 139.203125 373.664062 139.203125 C 280.808594 139.203125 221.296875 192.699219 192.171875 238.8125 Z"/>
                                <path style="fill:url(#od-r2);" d="M 192.171875 238.8125 C 158.871094 291.535156 114.042969 367.085938 98.914062 390.859375 C 80.929688 419.121094 33.304688 407.113281 37.25 366.609375 C 36.863281 369.894531 36.5625 373.210938 36.355469 376.546875 C 29.84375 481.933594 113.398438 569.453125 217.375 569.453125 C 331.96875 569.453125 605.269531 426.671875 577.609375 283.609375 C 548.457031 199.519531 466.523438 139.203125 373.664062 139.203125 C 280.808594 139.203125 221.296875 192.699219 192.171875 238.8125 Z"/>
                                <path style="fill:url(#od-r3);" d="M 192.171875 238.8125 C 158.871094 291.535156 114.042969 367.085938 98.914062 390.859375 C 80.929688 419.121094 33.304688 407.113281 37.25 366.609375 C 36.863281 369.894531 36.5625 373.210938 36.355469 376.546875 C 29.84375 481.933594 113.398438 569.453125 217.375 569.453125 C 331.96875 569.453125 605.269531 426.671875 577.609375 283.609375 C 548.457031 199.519531 466.523438 139.203125 373.664062 139.203125 C 280.808594 139.203125 221.296875 192.699219 192.171875 238.8125 Z"/>
                                <path style="fill:url(#od-r4);" d="M 192.171875 238.8125 C 158.871094 291.535156 114.042969 367.085938 98.914062 390.859375 C 80.929688 419.121094 33.304688 407.113281 37.25 366.609375 C 36.863281 369.894531 36.5625 373.210938 36.355469 376.546875 C 29.84375 481.933594 113.398438 569.453125 217.375 569.453125 C 331.96875 569.453125 605.269531 426.671875 577.609375 283.609375 C 548.457031 199.519531 466.523438 139.203125 373.664062 139.203125 C 280.808594 139.203125 221.296875 192.699219 192.171875 238.8125 Z"/>
                                <path style="fill:url(#od-r5);" d="M 192.171875 238.8125 C 158.871094 291.535156 114.042969 367.085938 98.914062 390.859375 C 80.929688 419.121094 33.304688 407.113281 37.25 366.609375 C 36.863281 369.894531 36.5625 373.210938 36.355469 376.546875 C 29.84375 481.933594 113.398438 569.453125 217.375 569.453125 C 331.96875 569.453125 605.269531 426.671875 577.609375 283.609375 C 548.457031 199.519531 466.523438 139.203125 373.664062 139.203125 C 280.808594 139.203125 221.296875 192.699219 192.171875 238.8125 Z"/>
                                <path style="fill:url(#od-l0);" d="M 215.699219 569.496094 C 215.699219 569.496094 489.320312 570.035156 535.734375 570.035156 C 619.960938 570.035156 684 501.273438 684 421.03125 C 684 340.789062 618.671875 272.445312 535.734375 272.445312 C 452.792969 272.445312 405.027344 334.492188 369.152344 402.226562 C 327.117188 481.59375 273.488281 568.546875 215.699219 569.496094 Z"/>
                                <path style="fill:url(#od-r6);" d="M 215.699219 569.496094 C 215.699219 569.496094 489.320312 570.035156 535.734375 570.035156 C 619.960938 570.035156 684 501.273438 684 421.03125 C 684 340.789062 618.671875 272.445312 535.734375 272.445312 C 452.792969 272.445312 405.027344 334.492188 369.152344 402.226562 C 327.117188 481.59375 273.488281 568.546875 215.699219 569.496094 Z"/>
                                <path style="fill:url(#od-r7);" d="M 215.699219 569.496094 C 215.699219 569.496094 489.320312 570.035156 535.734375 570.035156 C 619.960938 570.035156 684 501.273438 684 421.03125 C 684 340.789062 618.671875 272.445312 535.734375 272.445312 C 452.792969 272.445312 405.027344 334.492188 369.152344 402.226562 C 327.117188 481.59375 273.488281 568.546875 215.699219 569.496094 Z"/>
                            </svg>
                            OneDrive
                        </button>` : nothing}
                    <button class="cancel" @click="${() => this._showSyncPicker = false}">Cancel</button>
                </editor-sync-picker>
            ` : nothing}`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor': BottomEditor
    }
}
