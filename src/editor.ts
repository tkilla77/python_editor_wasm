import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, gutter, lineNumbers } from "@codemirror/view"
import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import { indentUnit, bracketMatching } from "@codemirror/language"
import { python } from "@codemirror/lang-python"

import { loadPyodide } from 'pyodide';

@customElement('bottom-editor')
class BottomEditor extends LitElement {
    private _editor?: EditorView
    private pyodideReadyPromise?: Promise<any>

    constructor() {
        super();
    }

    @query('#code')
    _code?: Element;

    @query('#output')
    _output?: HTMLTextAreaElement;

    firstUpdated() {
        // Get any immediate child texts of our editor element and use them as initial text content.
        let text = Array.from(this.childNodes)
                .filter(child => child.nodeType == Node.TEXT_NODE)
                .map(child => child.textContent)
                .join() || "";
        let editorState = EditorState.create({
            doc: text,
            extensions: [
                basicSetup,
                python(),
                EditorState.tabSize.of(4),
                indentUnit.of('    '),
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
            pyodide.runPython(`
            import io
            sys.stdout = io.StringIO()
            `);
            let code = this._editor.state.doc.toString();
            pyodide.runPython(code);
            let stdout = pyodide.runPython("sys.stdout.getvalue()");
            this.addToOutput(stdout);
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

    async main() {
        const py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full' });
        py.runPython(`
            import sys
            sys.version
        `);
        this.clearHistory();
        this.addToOutput("Python Ready!\n");
        return py;
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
                    <!-- Cleaning the output section -->
                    <button id="clear" @click="${this.clearHistory}" type="button">Clear Output</button>
                    <!-- permalink to editor contents - FIXME: implement -->
                    <button id="permalink" type="button">Copy Permalink</button>
                </bottom-buttons>
            </bottom-container>`
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .cm-editor {
            height: 100%;
        }
        bottom-container {
            font-family: system-ui;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            padding: 0 0.25rem;
            margin-top: 0.25rem;
            flex-grow: 1;
        }
        bottom-editorarea {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            height: 83%;
        }
        bottom-code {
            height: 66%;
            background-color: white;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5rem;
            overflow: hidden;
        }
        bottom-output {
            display: grid;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5rem;
            height: 33%;
            overflow: hidden;
        }
        bottom-output:focus-within {
            outline: 2px Highlight solid;
        }
        @media (min-width: 768px) {
            bottom-editorarea {
                flex-direction: row;
            }
            bottom-code {
                height:100%;
                width: 66%;
            }
            bottom-output {
                height:100%;
                width: 33%;
            }
        }
        bottom-output textarea {
            font-family: monospace;
            border: none;
            resize: none;
            box-shadow: none;
            padding: 0.5rem;
            color: #404040;
            background-color: #f5f5f5;
        }
        bottom-output textarea:focus {
            border: none;
            resize: none;
            box-shadow: none;
            outline: none;
        }
        bottom-buttons {
            height: fit-content;
            margin-block: 0.5rem;
        }
        bottom-buttons button {
            margin-inline-end: 0.5rem;
            margin-block: 0.5rem;
            min-height: 1rem;
            padding-inline: 0.75rem;
            padding-block: 0.25rem;
            border: 3px solid transparent;
            border-radius: 0.375rem;
            color: white;
            font-weight: 700;
            font-size: 1rem;
            line-height: 1.5rem;
        }
        bottom-buttons button:hover {
            opacity: 75%;
        }
        bottom-buttons button:focus {
            outline: solid 2px Highlight;
        }
        bottom-buttons button#run {
            background-color: rgb(21 128 61);
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