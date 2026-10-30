import { LitElement, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view"
import { StateEffect, StateField } from "@codemirror/state"
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
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

// ---------------------------------------------------------------------------
// CodeMirror step-through decorations
// ---------------------------------------------------------------------------

const MAX_STEP_SPEED = 20; // lines per second; one notch above means full speed

const ICON_STEP = html`<svg class="step-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l8 6-8 6z"/><rect x="12" y="2" width="2" height="12"/></svg>`;
const ICON_PLAY = html`<svg class="step-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2l7 6-7 6zM8 2l7 6-7 6z"/></svg>`;
const ICON_PAUSE = html`<svg class="step-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/></svg>`;

const setStepLine = StateEffect.define<{ line: number | null; locals: Record<string, string> }>();

class VarsWidget extends WidgetType {
    constructor(private readonly locals: Record<string, string>) { super(); }
    toDOM() {
        const span = document.createElement('span');
        span.className = 'cm-step-vars';
        const entries = Object.entries(this.locals);
        span.textContent = '  ← ' + (entries.length ? entries.map(([k, v]) => `${k} = ${v}`).join(',  ') : '(no locals)');
        return span;
    }
    eq(other: WidgetType) {
        return other instanceof VarsWidget && JSON.stringify(this.locals) === JSON.stringify((other as VarsWidget).locals);
    }
    ignoreEvent() { return true; }
}

const stepLineField = StateField.define<DecorationSet>({
    create() { return Decoration.none; },
    update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(setStepLine)) {
                const { line, locals } = e.value;
                if (line === null || line < 1) {
                    deco = Decoration.none;
                } else {
                    const numLines = tr.state.doc.lines;
                    if (line > numLines) { deco = Decoration.none; break; }
                    const lineInfo = tr.state.doc.line(line);
                    const ds = [Decoration.line({ class: 'cm-step-line' }).range(lineInfo.from)];
                    if (Object.keys(locals).length > 0) {
                        ds.push(Decoration.widget({ widget: new VarsWidget(locals), side: 1 }).range(lineInfo.to));
                    }
                    deco = Decoration.set(ds, true);
                }
            }
        }
        return deco;
    },
    provide: f => EditorView.decorations.from(f),
});

// Allow Python code to call input() via a browser prompt.
declare global {
    function input_fixed(msg: string): string | null;
}
globalThis.input_fixed = (msg: string) => prompt(msg);

type FileEntry = { name: string; code: string; initialCode: string };

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

    // Multi-file state. Empty = single-file mode (existing behaviour unchanged).
    @state() private _tabs: FileEntry[] = [];
    /** The authored file set (main, templates, URL files, zip files) that Revert restores. */
    private _initialTabs: FileEntry[] = [];
    /** File names from saved state, so files the user deleted don't reappear when a zip loads. */
    private _savedFileNames?: Set<string>;

    /** Show the file tab bar even with a single file, so users can add their own. */
    @property({ type: Boolean })
    multifile = false;
    @state() private _tabIdx: number = 0;

    @property({ reflect: true })
    layout: string = 'console';

    @property()
    session: string = '';

    /** When true, show the Revert button (red eraser). Reset is shown automatically when a canvas is present. */
    @property({ type: Boolean, reflect: true })
    showrevert = false;

    /** Alias for showrevert — kept for backward compatibility. */
    @property({ type: Boolean })
    set showclear(v: boolean) { this.showrevert = v; }
    get showclear()           { return this.showrevert; }

    /** When false, the permalink button is hidden. Default: true. */
    @property({ type: Boolean })
    permalink = true;

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
    @state() private _swCanvasHasNew  = false;
    @state() private _swConsoleHasNew = false;
    private _pyReady = false;

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
     * Extra lines prepended by transformCode beyond codePrefix itself (e.g. a
     * runtime shim injected before the user's code). Added to codePrefix's
     * line count when mapping traceback line numbers back to the editor.
     */
    @property({ attribute: false })
    transformLineOffset: number = 0;

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

    // ── Step-through state ─────────────────────────────────────────────────────
    /** When true, Run executes line-by-line; step controls appear. */
    @property({ type: Boolean, reflect: true })
    stepmode = false;

    /** Count executed lines and show the total after each run. Off by default: counting slows execution. */
    @property({ type: Boolean, reflect: true })
    showenergy = false;

    @state() private _stepping = false;
    @state() private _stepPaused = false;
    @state() private _stepLocals: Record<string, string> = {};
    @state() private _energy: number | null = null;
    @state() private _stepPlaying = false;
    @state() private _stepSpeed = 5;
    @state() private _canStep = true;
    private _stepPlayTimer?: ReturnType<typeof setTimeout>;

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

    /**
     * Set initial multi-file content from URL (?files=JSON). Should be called
     * before firstUpdated(). Sets _pendingCode from the first file.
     */
    @property({ attribute: false })
    set files(list: { name: string; code: string }[]) {
        if (!list || list.length === 0) return;
        this._pendingCode = list[0].code;
        this._tabs = list.map(f => ({ name: f.name, code: f.code, initialCode: f.code }));
        this._tabIdx = 0;
    }
    get files(): { name: string; code: string }[] {
        return this._tabs.map(f => ({ name: f.name, code: f.code }));
    }

    /** Lines executed by the last run, or null before the first run. */
    get energy(): number | null { return this._energy; }

    get outputText(): string { return this._output?.outputText ?? ''; }
    get logText(): string { return this._output?.logText ?? ''; }

    @query('#code')
    private _code?: Element;

    @query('bottom-editor-output')
    private _output?: BottomEditorOutput;

    @query('bottom-editor-buttons')
    private _buttons?: BottomEditorButtons;

    private _buttonColHeight = 0;
    private _buttonRO?: ResizeObserver;
    private _leaveSessionTimer?: ReturnType<typeof setTimeout>;

    private getSourceCode(): string {
        return Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent)
            .join('')
            .replace(/^\s*\n/, '') || '';
    }

    private _getTemplateFiles(): { name: string; code: string }[] {
        const files: { name: string; code: string }[] = [];
        for (const child of Array.from(this.children)) {
            if (child.tagName === 'TEMPLATE') {
                const name = child.getAttribute('filename');
                if (name) {
                    const code = (child as HTMLTemplateElement).content.textContent ?? '';
                    files.push({ name, code: code.replace(/^\n/, '') });
                }
            }
        }
        return files;
    }

    /** Switch to a tab by index, saving the current editor content first. */
    private _switchTab(idx: number) {
        if (!this._editor || idx === this._tabIdx || idx < 0 || idx >= this._tabs.length) return;
        this._tabs[this._tabIdx].code = this._editor.state.doc.toString();
        this._tabIdx = idx;
        this.replaceDoc(this._tabs[idx].code);
    }

    /** Add a new blank (or named) file tab. */
    private _addTab(name?: string) {
        const baseName = name ?? `file${this._tabs.length + 1}.py`;
        const entry: FileEntry = { name: baseName, code: '', initialCode: '' };
        this._tabs = [...this._tabs, entry];
        this._switchTab(this._tabs.length - 1);
        this._saveState();
    }

    /** Delete a tab (not allowed if only one tab left). */
    private _deleteTab(idx: number) {
        if (this._tabs.length <= 1) return;
        const newTabs = this._tabs.filter((_, i) => i !== idx);
        const newIdx = idx >= newTabs.length ? newTabs.length - 1 : idx;
        this._tabs = newTabs;
        this._tabIdx = newIdx;
        this.replaceDoc(this._tabs[this._tabIdx].code);
        this._saveState();
    }

    private _extraFiles(): { name: string; code: string }[] | undefined {
        if (this._tabs.length === 0) return undefined;
        return this._tabs
            .filter((_, i) => i !== this._tabIdx)
            .map(f => ({ name: f.name, code: f.code }));
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
        // In multi-file mode, keep tab contents in sync before saving.
        if (this._tabs.length > 0 && this._editor) {
            this._tabs[this._tabIdx].code = this._editor.state.doc.toString();
        }
        const state: ExerciseState = {
            exerciseId: key,
            code:       this.sourceCode,
            status:     (extra.status   as ExerciseState['status']) ?? 'started',
            attempts:   (extra.attempts as number)                  ?? 0,
            solvedAt:   extra.solvedAt  as number | undefined,
            ...(this._tabs.length > 0 ? {
                files:      this._tabs.map(f => ({ name: f.name, code: f.code })),
                activeFile: this._tabs[this._tabIdx]?.name,
            } : {}),
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
        if (this._tabs.length > 0 && saved.files && saved.files.length > 0) {
            // Multi-file: the saved list wins, so added and deleted files persist.
            this._tabs = saved.files.map(f => ({
                name: f.name,
                code: f.code,
                initialCode: this._initialTabs.find(t => t.name === f.name)?.initialCode ?? '',
            }));
            this._savedFileNames = new Set(saved.files.map(f => f.name));
            const activeIdx = saved.activeFile
                ? this._tabs.findIndex(t => t.name === saved.activeFile)
                : -1;
            this._tabIdx = activeIdx >= 0 ? activeIdx : 0;
            this.replaceDoc(this._tabs[this._tabIdx].code);
        } else if (saved.code !== this._initialCode) {
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

    /** Revert: reset editor code to initial, then reset canvas/output. */
    async revertCode() {
        if (this._tabs.length > 0) {
            // Back to the authored files: user-added ones go, deleted ones return.
            this._tabs = this._initialTabs.map(t => ({ ...t, code: t.initialCode }));
            this._savedFileNames = undefined;
            this._tabIdx = 0;
            this.replaceDoc(this._tabs[0]?.code ?? this._initialCode);
        } else {
            this.replaceDoc(this._initialCode);
        }
        const key = this._effectiveStorageKey();
        if (key) this._saveState();
        await this.reset();
    }

    // ── Button orientation ─────────────────────────────────────────────────────

    private _measureButtonColHeight(): number {
        if (!this._buttons) return 0;
        // Force column via inline style (overrides shadow :host, bypasses container
        // query) so the measurement is correct regardless of current container width.
        this._buttons.style.flexDirection = 'column';
        const h = this._buttons.scrollHeight;
        this._buttons.style.flexDirection = '';
        return h;
    }

    private async _setupButtonOrientation(): Promise<void> {
        this._buttonRO?.disconnect();
        if (!this._buttons) return;
        // Child LitElement shadow DOM renders in a microtask after the parent's
        // firstUpdated(). Wait for it before measuring, otherwise scrollHeight = 0.
        await this._buttons.updateComplete;
        this._buttonColHeight = this._measureButtonColHeight();
        const cmContent = this.renderRoot.querySelector('.cm-content') as HTMLElement | null;
        if (!cmContent) return;
        const sync = () => {
            if (!this._buttons) return;
            this._buttons.vertical = cmContent.getBoundingClientRect().height >= this._buttonColHeight;
        };
        this._buttonRO = new ResizeObserver(sync);
        this._buttonRO.observe(cmContent);
        sync();
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

        // Multi-file: parse <template filename="..."> children.
        const templateFiles = this._getTemplateFiles();
        if (templateFiles.length > 0) {
            // First tab is the main editor file; derive its name from the element id or default.
            const mainName = this.getAttribute('mainfile') ?? 'main.py';
            this._tabs = [
                { name: mainName, code: text, initialCode: text },
                ...templateFiles.map(f => ({ name: f.name, code: f.code, initialCode: f.code })),
            ];
            this._tabIdx = 0;
        } else if (this._tabs.length === 0 && this.multifile) {
            this._tabs = [{ name: this.getAttribute('mainfile') ?? 'main.py', code: text, initialCode: text }];
            this._tabIdx = 0;
        }
        this._initialTabs = this._tabs.map(t => ({ ...t }));

        this._editor = createPythonEditor(
            this._code!,
            text,
            () => this.onRun ? this.onRun() : this.evaluatePython(),
            () => {
                this.dispatchEvent(new CustomEvent('bottom-change', { bubbles: true, composed: true }));
                this._saveState();
            },
        );
        this._editor.dispatch({ effects: StateEffect.appendConfig.of([stepLineField]) });
        this._setupButtonOrientation();

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
            onError: (data) => {
                this._output?.addOutput(data);
                if (this._pyReady && !this._swConsole) this._swConsoleHasNew = true;
            },
            onReady: async () => {
                this._output?.clearOutput();
                this._output?.addLog('Python Ready!');
                this._pyReady = true;
                this._canStep = this.runtime.canStep;
                this._readyResolve();
                if (canvasEl) {
                    this._offscreenCanvas = canvasEl.transferToOffscreen();
                    await this.runtime.setCanvas(this._offscreenCanvas);
                }
                const zip = this.getAttribute('zip');
                if (zip) await this.installFilesFromZip(zip);
                if (this.readyCode) {
                    await this.runtime.runSetup(this.readyCode);
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

    override connectedCallback() {
        super.connectedCallback();
        // If the element was temporarily detached (e.g. by jQuery wrapAll during a
        // DokuWiki page-edit form submission), cancel the deferred leaveSession so
        // the Pyodide runtime survives the DOM move.
        if (this._leaveSessionTimer !== undefined) {
            clearTimeout(this._leaveSessionTimer);
            this._leaveSessionTimer = undefined;
            window.addEventListener('bottom-storage-change', this._onStorageChange);
        }
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('bottom-storage-change', this._onStorageChange);
        clearTimeout(this._cloudSaveTimer);
        this._buttonRO?.disconnect();
        // Defer runtime teardown by one task. Synchronous DOM moves (jQuery wrapAll
        // etc.) fire disconnectedCallback + connectedCallback in the same task;
        // connectedCallback cancels this timer so the runtime is never touched.
        this._leaveSessionTimer = setTimeout(() => {
            this._leaveSessionTimer = undefined;
            if (this._memberCallbacks) {
                leaveSession(this.session || '__default__', this._memberCallbacks);
            }
        }, 0);
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

    private _parseErrorLine(traceback: string): number | null {
        const matches = [...traceback.matchAll(/File "<exec>", line (\d+)/g)];
        return matches.length ? parseInt(matches[matches.length - 1][1]) : null;
    }

    private _clearEditorDiagnostics() {
        if (!this._editor) return;
        this._editor.dispatch(setDiagnostics(this._editor.state, []));
    }

    private _setEditorDiagnostic(userLine: number, message: string) {
        if (!this._editor) return;
        const doc = this._editor.state.doc;
        if (userLine < 1 || userLine > doc.lines) return;
        const line = doc.line(userLine);
        const diag: Diagnostic = { from: line.from, to: line.to, severity: 'error', message };
        this._editor.dispatch(setDiagnostics(this._editor.state, [diag]));
    }

    private _prefixLines(): number {
        return (this.codePrefix.match(/\n/g) ?? []).length + this.transformLineOffset;
    }

    private _formatError(fullMsg: string): { display: string; userLine: number | null } {
        const prefixLines = this._prefixLines();
        const rawLine = this._parseErrorLine(fullMsg);
        const userLine = rawLine !== null ? rawLine - prefixLines : null;
        const lastNewline = fullMsg.lastIndexOf('\n', fullMsg.length - 2);
        const exceptionLine = lastNewline > 0 && fullMsg.includes('  File "<exec>"')
            ? fullMsg.substring(lastNewline + 1).trim()
            : fullMsg.trim();
        const docLines = this._editor?.state.doc.lines ?? 0;
        const validLine = userLine !== null && userLine >= 1 && userLine <= docLines ? userLine : null;
        return { display: validLine ? `Line ${validLine}: ${exceptionLine}` : exceptionLine, userLine: validLine };
    }

    private _updateStepLine(line: number | null, locals: Record<string, string> = {}) {
        if (!this._editor) return;
        this._editor.dispatch({ effects: setStepLine.of({ line, locals }) });
        if (line !== null && line >= 1) {
            const numLines = this._editor.state.doc.lines;
            if (line <= numLines) {
                const pos = this._editor.state.doc.line(line).from;
                this._editor.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'nearest' }) });
            }
        }
    }

    private get _fullSpeed() { return this._stepSpeed > MAX_STEP_SPEED; }

    private _doStep() {
        if (!this._stepPaused) return;
        this._stopPlay();
        this.runtime.step();
    }

    private _doPlay() {
        if (!this._stepping) return;
        if (this._stepPlaying) {
            const freeRunning = !this._stepPaused;
            this._stopPlay();
            if (freeRunning) this.runtime.stepPause();
        } else {
            this._stepPlaying = true;
            this._scheduleAutoStep();
        }
    }

    private _scheduleAutoStep() {
        clearTimeout(this._stepPlayTimer);
        if (!this._stepPlaying || !this._stepPaused) return;
        if (this._fullSpeed) {
            this._stepPaused = false;
            this._updateStepLine(null);
            this.runtime.stepContinue();
            return;
        }
        this._stepPlayTimer = setTimeout(() => {
            if (this._stepPlaying && this._stepPaused) this.runtime.step();
        }, Math.round(1000 / this._stepSpeed));
    }

    private _setStepSpeed(speed: number) {
        const wasFull = this._fullSpeed;
        this._stepSpeed = speed;
        if (!this._stepPlaying) return;
        if (wasFull && !this._fullSpeed && !this._stepPaused) this.runtime.stepPause();
        else this._scheduleAutoStep();
    }

    private _stopPlay() {
        clearTimeout(this._stepPlayTimer);
        this._stepPlaying = false;
    }

    private _stop() {
        if (!this._stepping) {
            this.runtime.interrupt();
            return;
        }
        // The step trace raises KeyboardInterrupt at the next line. If the code is
        // stuck inside a long library call it never gets there, so fall back.
        this._stopPlay();
        this.runtime.stepAbort();
        setTimeout(() => { if (this._stepping) this.runtime.interrupt(); }, 1500);
    }

    private _onStepUpdate(line: number, locals: Record<string, string>, energy: number) {
        const userLine = line - this._prefixLines();
        this._stepLocals = locals;
        this._energy = energy;
        this._stepPaused = true;
        this._updateStepLine(userLine, locals);
        // If playing, schedule the next step after the display delay.
        if (this._stepPlaying) this._scheduleAutoStep();
    }

    async evaluatePython() {
        if (!this._editor) return;
        this._output?.clearOutput();
        this._clearEditorDiagnostics();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
        const raw  = this.codePrefix + this._editor.state.doc.toString();
        const code = this.transformCode ? this.transformCode(raw) : raw;
        if (this._buttons) this._buttons.running = true;
        this._energy = null;
        const onStep = this._beginStepping();
        try {
            await this.runtime.run(
                code,
                (data: string) => {
                    this._output?.addOutput(data);
                    if (!this._swConsole) this._swConsoleHasNew = true;
                },
                this._extraFiles(),
                (energy: number) => { this._energy = energy; },
                onStep,
                { lineOffset: this._prefixLines(), countEnergy: this.stepmode || this.showenergy },
            );
            if (this.autofit) this._handleFitRequest();
        } catch (err: any) {
            const { display, userLine } = this._formatError(err?.toString() ?? String(err));
            this._output?.addOutput(display);
            if (userLine !== null) this._setEditorDiagnostic(userLine, display);
            if (!this._swConsole) this._swConsoleHasNew = true;
        } finally {
            if (this._buttons) this._buttons.running = false;
            if (this._offscreenCanvas && !this._swCanvas) this._swCanvasHasNew = true;
            this._endStepping();
        }
    }

    /** In stepmode, prepare the step buffer and return the per-line callback. */
    private _beginStepping() {
        if (!this.stepmode || !this._canStep) return undefined;
        this._stepping = true;
        this._stepPaused = false;
        this._stopPlay();
        this._updateStepLine(null);
        return (line: number, locals: Record<string, string>, energy: number) => this._onStepUpdate(line, locals, energy);
    }

    private _endStepping() {
        if (!this._stepping) return;
        this._stepping = false;
        this._stepPaused = false;
        this._stopPlay();
        this._updateStepLine(null);
    }

    /**
     * Run the editor's code, then run test assertions in the same Python
     * namespace. Returns a structured TestReport with per-assertion results.
     */
    async evaluateWithTests(tests: string, opts?: { countEnergy?: boolean }): Promise<TestReport> {
        if (!this._editor) {
            return { passed: false, results: [{ passed: false, test: '<error>', message: 'Editor not initialized' }] };
        }
        this._output?.clearOutput();
        this._clearEditorDiagnostics();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
        const raw  = this.codePrefix + this._editor.state.doc.toString();
        const code = this.transformCode ? this.transformCode(raw) : raw;
        if (this._buttons) this._buttons.running = true;
        this._energy = null;
        const onStep = this._beginStepping();
        try {
            const report = await this.runtime.runWithTests(code, tests, this.readyCode, (data: string) => {
                this._output?.addOutput(data);
                if (!this._swConsole) this._swConsoleHasNew = true;
            }, this._extraFiles(), {
                lineOffset: this._prefixLines(),
                countEnergy: this.stepmode || this.showenergy || !!opts?.countEnergy,
            }, onStep, () => this._endStepping());
            this._energy = report.energy ?? null;
            return report;
        } catch (err: any) {
            const { display, userLine } = this._formatError(err?.toString() ?? String(err));
            this._output?.addOutput(display);
            if (userLine !== null) this._setEditorDiagnostic(userLine, display);
            if (!this._swConsole) this._swConsoleHasNew = true;
            return { passed: false, results: [{ passed: false, test: '<user code>', message: display }] };
        } finally {
            if (this._buttons) this._buttons.running = false;
            if (this._offscreenCanvas && !this._swCanvas) this._swCanvasHasNew = true;
            this._endStepping();
        }
    }

    async installFilesFromZip(url: string) {
        this._output?.addLog(`Loading ${url}...`);
        const files = await this.runtime.loadZip(url);
        if (this._tabs.length === 0) return;
        // Zip files join the authored set. The user's saved edits and deletions win.
        if (this._editor) this._tabs[this._tabIdx].code = this._editor.state.doc.toString();
        const tabs = [...this._tabs];
        for (const f of files) {
            if (!this._initialTabs.some(t => t.name === f.name)) {
                this._initialTabs.push({ name: f.name, code: f.code, initialCode: f.code });
            }
            const open = tabs.find(t => t.name === f.name);
            if (open) open.initialCode = f.code;
            else if (!this._savedFileNames || this._savedFileNames.has(f.name)) {
                tabs.push({ name: f.name, code: f.code, initialCode: f.code });
            }
        }
        this._tabs = tabs;
    }

    async copyPermalink() {
        try {
            if (this.permalinkCallback) {
                await this.permalinkCallback();
            } else {
                // FIXME allow permalink base to be configured
                const url = new URL("https://bottom.ch/editor/stable/");
                if (this._tabs.length > 0) {
                    // Save current editor content into tabs before serialising.
                    if (this._editor) this._tabs[this._tabIdx].code = this._editor.state.doc.toString();
                    url.searchParams.set('files', JSON.stringify(
                        this._tabs.map(f => ({ name: f.name, code: f.code }))
                    ));
                } else {
                    url.searchParams.set('code', this.sourceCode);
                }
                const defaultLayout = this.showswitcher ? 'split' : 'console';
                if (this.layout !== defaultLayout) url.searchParams.set('layout', this.layout);
                const zip = this.getAttribute("zip");
                if (zip) url.searchParams.set('zip', zip);
                if (this.timeout !== '30') url.searchParams.set('timeout', this.timeout);
                if (this.stepmode)   url.searchParams.set('stepmode', '1');
                if (this.showenergy) url.searchParams.set('showenergy', '1');
                await navigator.clipboard.writeText(url.href);
            }
            this._shareState = 'copied';
        } catch {
            this._shareState = 'error';
        }
        setTimeout(() => this._shareState = 'idle', 2000);
    }

    /** Reset: clear canvas/output, re-run readyCode. Does not touch editor code. */
    async reset() {
        this._output?.clearOutput();
        this._clearEditorDiagnostics();
        if (this._offscreenCanvas) this.runtime.clearCanvas();
        if (this.readyCode) await this.runtime.runSetup(this.readyCode);
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
        if (this._swCanvas && !this._swConsole) { this._swConsole = true; this._swConsoleHasNew = false; return; }
        this._swCanvas = !this._swCanvas;
        if (this._swCanvas) this._swCanvasHasNew = false;
    }

    private _toggleSwConsole() {
        if (this._swConsole && !this._swCanvas) { this._swCanvas = true; this._swCanvasHasNew = false; return; }
        this._swConsole = !this._swConsole;
        if (this._swConsole) this._swConsoleHasNew = false;
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
                        <button class="sw-tab ${this._swCanvas ? 'open' : 'closed'} ${!this._swCanvas && this._swCanvasHasNew ? 'has-new' : ''}"
                                @click="${this._toggleSwCanvas}">▲ Canvas</button>
                        <button class="sw-tab ${this._swConsole ? 'open' : 'closed'} ${!this._swConsole && this._swConsoleHasNew ? 'has-new' : ''}"
                                @click="${this._toggleSwConsole}">Console ▼</button>
                    </div>
                    <bottom-editor-output
                        class="${this._swConsole ? '' : 'sw-hidden'}">
                    </bottom-editor-output>
                </div>`
            : html`
                ${hasCanvas ? html`<bottom-editor-canvas @bottom-fit="${this._handleFitRequest}"></bottom-editor-canvas>` : ''}
                ${hasOutput ? html`<bottom-editor-output></bottom-editor-output>` : ''}`;

        const tabBar = this._tabs.length > 0 ? html`
            <bottom-tabs>
                ${this._tabs.map((f, i) => html`
                    <bottom-tab
                        class="${i === this._tabIdx ? 'active' : ''}"
                        @click="${() => this._switchTab(i)}">
                        ${f.name}
                        ${this._tabs.length > 1 ? html`
                            <button class="tab-close" title="Delete file"
                                @click="${(e: Event) => { e.stopPropagation(); this._deleteTab(i); }}">×</button>
                        ` : ''}
                    </bottom-tab>
                `)}
                <button class="tab-add" title="Add file" @click="${() => this._addTab()}">+</button>
            </bottom-tabs>` : '';

        const stepBar = this.stepmode ? html`
            <bottom-stepbar>
                ${this._stepping ? html`
                    <button class="step-btn" @click="${this._doStep}" ?disabled="${!this._stepPaused}"
                            title="Run the highlighted line">${ICON_STEP} Step</button>
                    <button class="step-btn ${this._stepPlaying ? 'active' : ''}" @click="${this._doPlay}"
                            title="${this._stepPlaying ? 'Pause' : 'Keep stepping automatically'}">
                        ${this._stepPlaying ? html`${ICON_PAUSE} Pause` : html`${ICON_PLAY} Play`}</button>
                    <label class="step-speed" title="Play speed (lines per second)">
                        <span>${this._fullSpeed ? 'max' : `${this._stepSpeed}/s`}</span>
                        <input type="range" min="1" max="${MAX_STEP_SPEED + 1}" .value="${String(this._stepSpeed)}"
                               @input="${(e: InputEvent) => this._setStepSpeed(+(e.target as HTMLInputElement).value)}">
                    </label>
                ` : html`
                    <span class="step-hint">${this._canStep
                        ? 'Click Run to step through'
                        : 'Stepping needs a current browser (Chrome/Edge 137+, Firefox 153+, Safari 27+)'}</span>
                `}
                ${this._energy !== null ? html`
                    <span class="step-energy" title="Lines executed">⚡ ${this._energy}</span>
                ` : nothing}
            </bottom-stepbar>` : (this._energy !== null ? html`
            <bottom-stepbar>
                <span class="step-energy" title="Lines executed">⚡ ${this._energy}</span>
            </bottom-stepbar>` : nothing);

        return html`
            <bottom-editorarea>
                <bottom-codewrap>
                    ${tabBar}
                    <bottom-code id="code"></bottom-code>
                    ${stepBar}
                </bottom-codewrap>
                ${outputArea}
                <bottom-editor-buttons
                    part="buttons"
                    captionmode="${this.orientation === 'horizontal' ? 'hide'
                                : this.orientation === 'vertical'   ? 'show'
                                : 'auto'}"
                    ?showreset="${hasCanvas || this.showswitcher}"
                    ?showrevert="${this.showrevert}"
                    .permalink=${this.permalink}
                    .shareState=${this._shareState}
                    ?showsync="${this._syncAvailable()}"
                    syncbackend="${syncBackend}"
                    @bottom-run="${() => this.onRun ? this.onRun() : this.evaluatePython()}"
                    @bottom-stop="${this._stop}"
                    @bottom-reset="${this.reset}"
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
