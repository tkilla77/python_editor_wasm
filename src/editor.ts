import { LitElement, css, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, gutter, lineNumbers } from "@codemirror/view"
import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import { indentUnit, bracketMatching } from "@codemirror/language"
import { python } from "@codemirror/lang-python"
import { base64ToText } from './encoder.js'

import { loadPyodide } from 'pyodide';

@customElement('bottom-editor')
export class BottomEditor extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };

    private _editor?: EditorView
    private pyodideReadyPromise?: Promise<any>

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
        this.clearHistory();
        this.addToOutput("Initializing...");

        // run the main function
        this.pyodideReadyPromise = this.main();

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
    addToOutput(stdout: string) {
        if (this._output) {
            this._output.value += stdout;
        }
    }

    // Add information to the log
    addToLog(s: any) {
        // for now, put log and program output into the same area
        this.addToOutput(s.toString());
    }

    // pass the editor value to the pyodide.runPython function and show the result in the output section
    async evaluatePython() {
        let pyodide = await this.pyodideReadyPromise;
        if (!this._editor) {
            return;
        }
        this.clearHistory();
        try {
            let code = this._editor.state.doc.toString();
            await pyodide.runPythonAsync(code);
        } catch (err: any) {
            // Drop uninteresting output from runPython
            let error_text = err.toString();
            let debug_idx = error_text.indexOf('  File "<exec>"');
            if (debug_idx > 0) {
                error_text = error_text.substring(debug_idx);
            }
            this.addToOutput(error_text);
        }
    }

    /* Implements the WriteHandler interface for pyodide.setStdout(). */
    write(buffer: Uint8Array) {
        this.addToOutput(new TextDecoder().decode(buffer));
        return buffer.length;
    }

    /** Loads data files available from the working directory of the code. */
    async installFilesFromZip(url: string) {
        let pyodide = await this.pyodideReadyPromise;
        if (!this._editor) {
            return;
        }
        this.addToLog(`Loading ${url}... `)
        let zipResponse = await fetch(url);
        if (zipResponse.ok) {
            let zipBinary = await zipResponse.arrayBuffer();
            await pyodide.unpackArchive(zipBinary, "zip");
            this.addToLog(`Done!\n`);
        } else {
            this.addToLog(`Error while downloading ${url}: ${zipResponse.status}`);
        }
    }

    private async main() {
        const py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full' });
        py.setStdin({ stdin: () => prompt() });
        py.setStdout(this);
        await py.loadPackage("micropip");
        if (this._canvas) {
            // await py.loadPackage("pygame-ce");
            py.canvas.setCanvas2D(this._canvas);
        }

        if (this.hasAttribute("zip")) {
            let zip_url = this.getAttribute("zip");
            if (zip_url) {
                this.installFilesFromZip(zip_url);
            }
        }

        this.clearHistory();
        this.addToOutput("Python Ready!\n");
        return py;
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
                    </bottom-output>
                <bottom-buttons part="buttons">
                    <!-- Run button to pass the code to pyodide.runPython() -->
                    <button id="run" @click="${this.evaluatePython}" type="button" title="Run (Ctrl+Enter)">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21ZM12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23Z" fill="currentColor"/><path d="M16 12L10 16.3301V7.66987L16 12Z" fill="currentColor" /></svg>
                    <span class="caption">Run</span>
                    </button>
                    <!-- Cleaning the output section -->
                    <button id="clear" @click="${this.clearHistory}" type="button" title="Clear Output"><svg
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>
  <path d="M15.9644 4.63379H3.96442V6.63379H15.9644V4.63379Z" fill="currentColor" />
  <path d="M15.9644 8.63379H3.96442V10.6338H15.9644V8.63379Z" fill="currentColor" />
  <path d="M3.96442 12.6338H11.9644V14.6338H3.96442V12.6338Z" fill="currentColor" />
  <path
    d="M12.9645 13.7093L14.3787 12.295L16.5 14.4163L18.6213 12.2951L20.0355 13.7093L17.9142 15.8305L20.0356 17.9519L18.6214 19.3661L16.5 17.2447L14.3786 19.3661L12.9644 17.9519L15.0858 15.8305L12.9645 13.7093Z"
    fill="currentColor"
  />
</svg>                    <span class="caption">Clear</span>
</button>
                    <!-- permalink to editor contents -->
                    <button id="permalink" @click="${this.copyPermalink}" type="button" title="Copy Permalink"><svg
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>
  <path
    d="M14.8284 12L16.2426 13.4142L19.071 10.5858C20.6331 9.02365 20.6331 6.49099 19.071 4.9289C17.509 3.3668 14.9763 3.3668 13.4142 4.9289L10.5858 7.75732L12 9.17154L14.8284 6.34311C15.6095 5.56206 16.8758 5.56206 17.6568 6.34311C18.4379 7.12416 18.4379 8.39049 17.6568 9.17154L14.8284 12Z"
    fill="currentColor"
  />
  <path
    d="M12 14.8285L13.4142 16.2427L10.5858 19.0711C9.02372 20.6332 6.49106 20.6332 4.92896 19.0711C3.36686 17.509 3.36686 14.9764 4.92896 13.4143L7.75739 10.5858L9.1716 12L6.34317 14.8285C5.56212 15.6095 5.56212 16.8758 6.34317 17.6569C7.12422 18.4379 8.39055 18.4379 9.1716 17.6569L12 14.8285Z"
    fill="currentColor"
  />
  <path
    d="M14.8285 10.5857C15.219 10.1952 15.219 9.56199 14.8285 9.17147C14.4379 8.78094 13.8048 8.78094 13.4142 9.17147L9.1716 13.4141C8.78107 13.8046 8.78107 14.4378 9.1716 14.8283C9.56212 15.2188 10.1953 15.2188 10.5858 14.8283L14.8285 10.5857Z"
    fill="currentColor"
  />
</svg><span class="caption">Link</span></button>
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
        }
        bottom-buttons button {
            min-height: 1em;
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
        bottom-buttons button#run {
            background-color: #15803da3;
        }
        bottom-buttons button#clear {
            background-color: #7f1d1da3;
        }
        bottom-buttons button#permalink {
            background-color: #374151a3;
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor': BottomEditor
    }
}