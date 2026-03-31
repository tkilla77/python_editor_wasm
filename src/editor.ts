import { LitElement, css, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, gutter, lineNumbers } from "@codemirror/view"
import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import { indentUnit, bracketMatching } from "@codemirror/language"
import { python } from "@codemirror/lang-python"
import { base64ToText } from './encoder.js'
import { PyodideRuntime } from './pyodide-runtime.js';

// Pyodide is loaded inside a dedicated web worker (see src/pyodide-worker.ts)

// Set up an input handler JS function
declare global {
  function input_fixed(msg: string): string | null;
}
globalThis.input_fixed = (msg: string) => prompt(msg);

@customElement('bottom-editor')
export class BottomEditor extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };

    private _editor?: EditorView
    private runtime!: PyodideRuntime

    constructor() {
        super();
    }

    @property({ attribute: 'sourcecode' })
    set sourceCode(code: string) {
        this.replaceDoc(code);
    };
    get sourceCode() {
        return this._editor?.state.doc.toString() || '';
    }

    @query('#code')
    _code?: Element;

    @query('#output')
    _output?: HTMLTextAreaElement;

    @query('#canvas')
    _canvas?: HTMLCanvasElement;

    @query('#log')
    _log?: HTMLElement;

    @query('bottom-buttons')
    _buttons?: HTMLElement;

    private getSourceCode(): string {
        // First prio: code attribute, base64 encoded
        let code = this.getAttribute("code");
        if (code) {
            return base64ToText(code);
        }

        // Second prio: immediate text children, unencoded.
        // Get any immediate child texts of our editor element and use them as initial text content.
        return Array.from(this.childNodes)
            .filter(child => child.nodeType == Node.TEXT_NODE)
            .map(child => child.textContent)
            .join().replace(/^\s*\n/g, "") || "";

    }

    /** Returns true if the source code is at least 6 lines long. */
    private useVerticalMode(source: string) {
        return source.split('\n', 6).length > 5;
    }

    firstUpdated() {
        let text = this.getSourceCode();
        if (this.useVerticalMode(text)) {
            this._buttons?.classList.add('vertical');
        }
        let runCode = keymap.of([{
            key: "Ctrl-Enter",
            run: () => { this.evaluatePython(); return true }
        }]);
        let editorState = EditorState.create({
            doc: text,
            extensions: [
                basicSetup,
                python(),
                EditorState.tabSize.of(4),
                indentUnit.of('    '),
                runCode,
                keymap.of(defaultKeymap),
                keymap.of([indentWithTab]),
                lineNumbers(),
                bracketMatching(),
                gutter({ class: "cm-mygutter" })
            ]
        })

        this._editor = new EditorView({
            state: editorState,
            parent: this._code
        })
        this.addToLog("Initializing...");

        this.runtime = new PyodideRuntime({
            onStdout: (data) => this.addToOutput(data),
            onLog: (data) => this.addToLog(data),
            onError: (data) => this.addToOutput(data),
            onReady: () => {
                this.clearHistory();
                this.addToLog('Python Ready!');
            },
        });
        this.runtime.start();

        if (this.hasAttribute("autorun")) {
            let autorun = this.getAttribute("autorun");
            if (!(autorun === 'false' || autorun === '0')) {
                this.evaluatePython();
            }
        }
    }

    public replaceDoc(text: string) {
        let state = this._editor?.state;
        let replaceDoc = state?.update({ changes: { from: 0, to: state.doc.length, insert: text } });
        if (replaceDoc) {
            this._editor?.dispatch(replaceDoc);
        }
    }

    async clearHistory() {
        if (this._output) {
            this._output.value = ""
        }
    }

    // Add pyodide returned value to the output
    // Add pyodide returned value to the output and enforce local buffer limits
    addToOutput(stdout: string) {
        if (!this._output) return;
        const MAX_OUTPUT_LINES = 100;
        const MAX_OUTPUT_CHARS = 5000;

        // Combine existing output and new stdout
        let current = this._output.value + stdout;

        // If a previous trim notice exists at the very start, remove it before re-calculating
        if (current.startsWith('...[output trimmed:')) {
            const firstNewline = current.indexOf('\n');
            if (firstNewline > 0) current = current.slice(firstNewline + 1);
        }

        let noticeParts: string[] = [];

        // Enforce line limit
        const lines = current.split(/\r?\n/);
        if (lines.length > MAX_OUTPUT_LINES) {
            const removed = lines.length - MAX_OUTPUT_LINES;
            current = lines.slice(-MAX_OUTPUT_LINES).join('\n');
            noticeParts.push(`${removed} lines`);
        }

        // Enforce char limit
        if (current.length > MAX_OUTPUT_CHARS) {
            const removedChars = current.length - MAX_OUTPUT_CHARS;
            current = current.slice(-MAX_OUTPUT_CHARS);
            const firstNewline = current.indexOf('\n');
            if (firstNewline > 0) current = current.slice(firstNewline + 1);
            noticeParts.push(`~${removedChars} chars`);
        }

        if (noticeParts.length > 0) {
            const notice = `...[output trimmed: ${noticeParts.join(', ')}]...\n`;
            this._output.value = notice + current;
        } else {
            this._output.value = current;
        }
    }

    // Add information to the system log panel
    addToLog(s: any) {
        if (!this._log) return;
        this._log.textContent += s.toString() + '\n';
        this._log.scrollTop = this._log.scrollHeight;
    }

    async evaluatePython() {
        if (!this._editor) return;
        this.clearHistory();
        const code = this._editor.state.doc.toString();
        this.setRunning(true);
        try {
            await this.runtime.run(code);
        } catch (err: any) {
            let error_text = err?.toString() || String(err);
            const debug_idx = error_text.indexOf('  File "<exec>"');
            if (debug_idx > 0) error_text = error_text.substring(debug_idx);
            this.addToOutput(error_text);
        } finally {
            this.setRunning(false);
        }
    }

    async installFilesFromZip(url: string) {
        this.addToLog(`Loading ${url}... `);
        await this.runtime.loadZip(url);
    }

    public interruptRun() {
        this.runtime.interrupt();
    }

    private setRunning(running: boolean) {
        if (this._buttons) {
            if (running) this._buttons.classList.add('running');
            else this._buttons.classList.remove('running');
        }
    }

    getPermaUrl() {
        // FIXME make baseurl configurable
        return new URL("https://bottom.ch/ksr/ed/");
    }

    async copyPermalink() {
        const code = this.sourceCode;
        let url = this.getPermaUrl();
        url.searchParams.set('code', code);
        if (this.hasAttribute("zip")) {
            let zip_url = this.getAttribute("zip");
            if (zip_url) {
                url.searchParams.set('zip', zip_url)
            }
        }
        navigator.clipboard.writeText(url.href);
    }

    render() {
        return html`
            <bottom-container>
                <bottom-editorarea>
                    <bottom-code id="code">
                        <!-- our code editor, where codemirror renders it's editor -->
                    </bottom-code>
                    <bottom-output>
                        <!-- output section where we show the stdout of the python code execution -->
                        <textarea readonly id="output" name="output"></textarea>
                        <details id="log-details">
                            <summary title="System log">
                                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M1 2.5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M6 8.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </summary>
                            <div id="log"></div>
                        </details>
                    </bottom-output>
                    <bottom-buttons part="buttons">
                        <!-- Run button to pass the code to pyodide.runPython() -->
                        <button id="run" @click="${this.evaluatePython}" type="button" title="Run (Ctrl+Enter)"><span class="caption">Run</span></button>
                        <!-- Stop button to interrupt execution -->
                        <button id="stop" @click="${this.interruptRun}" type="button" title="Stop"><span class="caption">Stop</span></button>
                        <!-- Cleaning the output section -->
                        <button id="clear" @click="${this.clearHistory}" type="button" title="Clear Output"><span class="caption">Clear</span></button>
                        <!-- permalink to editor contents -->
                        <button id="permalink" @click="${this.copyPermalink}" type="button" title="Copy Permalink"><span class="caption">Link</span></button>
                    </bottom-buttons>
                </bottom-editorarea>

                <!-- <bottom-canvas>
                    <canvas id="canvas" width="600" height="0" style="cursor: default;"></canvas>
                </bottom-canvas> -->
            </bottom-container>`
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            max-height: 25lh;
        }
        .cm-editor {
            height: 100%;
        }
        bottom-container {
            font-family: system-ui;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            flex: 1;
            height: 100%;
            margin-bottom: 0.4em;
        }
        bottom-editorarea {
            display: grid;
            grid-template-columns: 1fr;
            gap: 0.5em;
            flex: 1;
            height: 0;
        }
        bottom-canvas {
            height: fit-content;
            margin-block: 0.5em;
        }
        bottom-code {
            background-color: white;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5em;
            overflow: hidden;
            flex: 2;
        }
        bottom-output {
            display: grid;
            height: auto;
            overflow: hidden;
            flex: 1;
            min-height: 5lh;
            position: relative;
        }
        #log-details {
            position: absolute;
            bottom: 0.35em;
            right: 0.35em;
            z-index: 5;
        }
        #log-details summary {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 1.4em;
            height: 1.4em;
            cursor: pointer;
            list-style: none;
            color: #888;
            background: rgba(200,200,200,0.5);
            border-radius: 0.25em;
            transition: color 120ms, background 120ms;
        }
        #log-details summary::-webkit-details-marker { display: none; }
        #log-details summary:hover,
        #log-details[open] summary {
            color: #333;
            background: rgba(180,180,180,0.8);
        }
        #log-details #log {
            position: absolute;
            bottom: 1.7em;
            right: 0;
            width: 22em;
            max-height: 10em;
            overflow-y: auto;
            background: #1e1e1e;
            color: #ccc;
            font-family: monospace;
            font-size: 0.75em;
            white-space: pre-wrap;
            padding: 0.4em 0.5em;
            border-radius: 0.3em;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        @media (min-width: 768px) {
            bottom-editorarea {
                grid-template-columns: 2fr auto 1fr;                
            }
            bottom-output {
                grid-column: 3/4;
                min-height: 2lh;
            }
            bottom-buttons {
                grid-row: 1/2;
                grid-column: 2/3;
            }
            bottom-buttons.vertical {
                flex-direction: column;
            }
            button span.caption {
                display: none;
            }
        }

        bottom-output textarea {
            font-family: monospace;
            resize: none;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5em;
            box-shadow: none;
            padding: 0.5em;
            color: #404040;
            background-color: #f5f5f5;
        }
        bottom-buttons {
            height: fit-content;
            margin-block: 0.2em;
            display: flex;
            gap: 0.4em;
            position: relative;
        }
        bottom-buttons button {
            min-height: 2.2em;
            padding-inline: 0.4em;
            padding-block: 0.25em;
            border: 2px solid transparent;
            border-radius: 0.2em;
            color: white;
            font-weight: 700;
            font-size: 1em;
            line-height: 1.5em;
            display: flex;
            align-items: center;
            gap: 0.4em;
        }
        bottom-buttons button:hover {
            opacity: 75%;
        }
        bottom-buttons button:focus {
            border: solid 2px rgb(1 95 204)	;
        }
        bottom-buttons button::before {
            width:1lh;
            height:1lh;
            content: '';
            background-repeat: no-repeat;
        }
        bottom-buttons button#run {
            background-color: #15803da3;
        }
        bottom-buttons button#run::before {
            background-image: url('data:image/svg+xml;charset=UTF-8,<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21ZM12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23Z" fill="white"/><path d="M16 12L10 16.3301V7.66987L16 12Z" fill="white" /></svg>');
        }
        bottom-buttons button#clear {
            background-color: #7f1d1da3;
        }
        bottom-buttons button#clear::before {
            background-image: url('data:image/svg+xml;charset=UTF-8,<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.9644 4.63379H3.96442V6.63379H15.9644V4.63379Z" fill="white" /><path d="M15.9644 8.63379H3.96442V10.6338H15.9644V8.63379Z" fill="white" /><path d="M3.96442 12.6338H11.9644V14.6338H3.96442V12.6338Z" fill="white" /><path d="M12.9645 13.7093L14.3787 12.295L16.5 14.4163L18.6213 12.2951L20.0355 13.7093L17.9142 15.8305L20.0356 17.9519L18.6214 19.3661L16.5 17.2447L14.3786 19.3661L12.9644 17.9519L15.0858 15.8305L12.9645 13.7093Z" fill="white" /></svg>');
        }
        bottom-buttons button#permalink {
            background-color: #374151a3;
        }
        bottom-buttons button#stop {
            background-color: #b45309a3;
        }
        bottom-buttons button#stop::before {
            background-image: url('data:image/svg+xml;charset=UTF-8,<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6H18V18H6V6Z" fill="white"/></svg>');
        }
        /* Smooth swap between Run and Stop buttons */
        bottom-buttons button {
            transition: opacity 180ms ease, transform 180ms ease;
        }
        /* Default: Stop is taken out of flow (absolute) so it doesn't occupy space when hidden */
        bottom-buttons button#stop {
            opacity: 0;
            transform: scale(0.92);
            pointer-events: none;
            position: absolute;
            left: 0;
            top: 0;
            z-index: 1;
        }
        /* When running, place Stop back into flow and remove Run from flow */
        bottom-buttons.running button#stop {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
            position: static;
            z-index: 2;
        }
        bottom-buttons.running button#run {
            opacity: 0;
            transform: scale(0.92);
            pointer-events: none;
            position: absolute;
            left: 0;
            top: 0;
            z-index: 1;
        }
        bottom-buttons button#run {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
            position: static;
            z-index: 2;
        }
        bottom-buttons button#permalink::before {
            background-image: url('data:image/svg+xml;charset=UTF-8,<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.8284 12L16.2426 13.4142L19.071 10.5858C20.6331 9.02365 20.6331 6.49099 19.071 4.9289C17.509 3.3668 14.9763 3.3668 13.4142 4.9289L10.5858 7.75732L12 9.17154L14.8284 6.34311C15.6095 5.56206 16.8758 5.56206 17.6568 6.34311C18.4379 7.12416 18.4379 8.39049 17.6568 9.17154L14.8284 12Z" fill="white" /><path d="M12 14.8285L13.4142 16.2427L10.5858 19.0711C9.02372 20.6332 6.49106 20.6332 4.92896 19.0711C3.36686 17.509 3.36686 14.9764 4.92896 13.4143L7.75739 10.5858L9.1716 12L6.34317 14.8285C5.56212 15.6095 5.56212 16.8758 6.34317 17.6569C7.12422 18.4379 8.39055 18.4379 9.1716 17.6569L12 14.8285Z" fill="white" /><path d="M14.8285 10.5857C15.219 10.1952 15.219 9.56199 14.8285 9.17147C14.4379 8.78094 13.8048 8.78094 13.4142 9.17147L9.1716 13.4141C8.78107 13.8046 8.78107 14.4378 9.1716 14.8283C9.56212 15.2188 10.1953 15.2188 10.5858 14.8283L14.8285 10.5857Z" fill="white" /></svg>');
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor': BottomEditor
    }
}