import { LitElement, css, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, gutter, lineNumbers } from "@codemirror/view"
import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import { indentUnit, bracketMatching } from "@codemirror/language"
import { python } from "@codemirror/lang-python"
import { base64ToText } from './encoder.js'

import { asyncRun, interrupt, installFiles } from './pyodide_api.js'

@customElement('bottom-editor')
export class BottomEditor extends LitElement {
    static shadowRootOptions = {...LitElement.shadowRootOptions, mode: 'closed'};

    private _editor?: EditorView

    constructor() {
        super();
    }

    @property({attribute: 'sourcecode'})
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

    private getSourceCode() : string {
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
                .join() || "";
        
    }

    firstUpdated() {
        let text = this.getSourceCode();
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
        
        if (this.hasAttribute("autorun")) {
            let autorun = this.getAttribute("autorun");
            if (!(autorun === 'false' || autorun === '0')) {
                this.evaluatePython();
            }
        }
    }

    public replaceDoc(text: string) {
        let state = this._editor?.state;
        let replaceDoc = state?.update({ changes: {from: 0, to:state.doc.length, insert: text}});
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
        if (!this._editor) {
            return;
        }
        this.clearHistory();
        try {
            let code = this._editor.state.doc.toString();
            console.log("Evaluating Python...")
            await asyncRun(code, (output: string) => this.addToOutput(output));
            console.log("Python evaluated...")
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

    /** Loads data files available from the working directory of the code. */
    async installFilesFromZip(url: string) {
        if (!this._editor) {
            return;
        }
        this.addToLog(`Loading ${url}... `)
        await installFiles(url);
        this.addToLog(`Done!\n`);
    }

    /* Implements the WriteHandler interface for pyodide.setStdout(). */
    write(buffer: Uint8Array) {
        this.addToOutput(new TextDecoder().decode(buffer));
        return buffer.length;
    }

    getPermaUrl() {
        // FIXME make baseurl configurable
        return new URL("https://bottom.ch/ksr/ed/");
    }
      
    async copyPermalink() {
        const code = this.sourceCode;
        let url = this.getPermaUrl();
        url.searchParams.set('code', code);
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
                </bottom-editorarea>
                <bottom-buttons>
                    <!-- Run button to pass the code to pyodide.runPython() -->
                    <button id="run" @click="${this.evaluatePython}" type="button" title="Ctrl+Enter">Run</button>
                    <!-- interrupt python - FIXME: implement -->
                    <button id="interrupt" @click="${interrupt}" type="button">Stop</button>
                    <!-- Cleaning the output section -->
                    <button id="clear" @click="${this.clearHistory}" type="button">Clear Output</button>
                    <!-- permalink to editor contents - FIXME: implement -->
                    <button id="permalink" @click="${this.copyPermalink}" type="button">Copy Permalink</button>
                </bottom-buttons>
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
        }
        bottom-editorarea {
            display: flex;
            flex-direction: column;
            gap: 0.5em;
            flex: 1;
            height: 0;
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
                flex-direction: row;
            }
            bottom-code {
                width: 66%;
            }
            bottom-output {
                width: 33%;
                min-height: 2lh;
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
            margin-block: 0.5em;
        }
        bottom-buttons button {
            margin-inline-end: 0.5em;
            margin-block: 0.5em;
            min-height: 1em;
            padding-inline: 0.75em;
            padding-block: 0.25em;
            border: 2px solid transparent;
            border-radius: 0.375em;
            color: white;
            font-weight: 700;
            font-size: 1em;
            line-height: 1.5em;
        }
        bottom-buttons button:hover {
            opacity: 75%;
        }
        bottom-buttons button:focus {
            border: solid 2px rgb(1 95 204)	;
        }
        bottom-buttons button#run {
            background-color: rgb(21 128 61);
        }
        bottom-buttons button#interrupt {
            background-color: red;
        }
        bottom-buttons button#clear {
            background-color: #7f1d1d;
        }
        bottom-buttons button#permalink {
            background-color: #374151;
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor': BottomEditor
    }
}