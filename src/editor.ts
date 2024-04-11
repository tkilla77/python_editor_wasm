import { LitElement, css, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

import {EditorState} from "@codemirror/state"
import {basicSetup} from "codemirror"
import {EditorView, keymap, gutter, lineNumbers, KeyBinding} from "@codemirror/view"
import {defaultKeymap, indentWithTab} from "@codemirror/commands"
import {indentUnit, bracketMatching, codeFolding} from "@codemirror/language"
import {python, localCompletionSource} from "@codemirror/lang-python"
import {espresso} from 'thememirror';


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
    _output?: Element;
  

    indent(cm) {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
        } else {
          cm.replaceSelection(cm.getOption("indentWithTabs")? "\t":
            Array(cm.getOption("indentUnit") + 1).join(" "), "end", "+input");
        }
    }
    unindent(cm) {
        this.indentSelection("subtract");
    }
    
    run(cm) {
        this.evaluatePython();
    }  

    firstUpdated() {
        let editorState = EditorState.create({
            doc: "print(42)",
            extensions: [
                basicSetup,
                python(),
                EditorState.tabSize.of(4),
                indentUnit.of('    '),
                keymap.of(defaultKeymap),
                keymap.of([indentWithTab]),
                lineNumbers(),
                bracketMatching(),
                gutter({class: "cm-mygutter"}),
                espresso
            ]
          })
          
        this._editor = new EditorView({
            state: editorState,
            parent: this._code
          })
        this._output.value = "Initializing..."

              
        // run the main function
        this.pyodideReadyPromise = this.main();
    }

    async clearHistory() {
        this._output.value = ""
    }

    // Add pyodide returned value to the output
    addToOutput(stdout: string) {
        this._output.value += stdout;
    }
    
    // Add information to the log
    addToLog(s) {
        // for now, put log and program output into the same area
        this.addToOutput(s);
    }
        
    // pass the editor value to the pyodide.runPython function and show the result in the output section
    async evaluatePython() {
        let pyodide = await this.pyodideReadyPromise;
        this.clearHistory();
        try {
            pyodide.runPython(`
            import io
            sys.stdout = io.StringIO()
            `);
            let code = this._editor.state.doc.toString();
            let result = pyodide.runPython(code);
            let stdout = pyodide.runPython("sys.stdout.getvalue()");
            this.addToOutput(stdout);
        } catch (err) {
            // Drop uninteresting output from runPython
            let error_text = err?.toString();
            let debug_idx = error_text.indexOf('  File "<exec>"');
            if (debug_idx > 0) {
                error_text = error_text.substring(debug_idx);
            }
            this.addToOutput(error_text);
        }
    }
    
    async main() {
        let pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
        });
        pyodide.runPython(`
            import sys
            sys.version
        `);
        this.clearHistory();
        this.addToOutput("Python Ready!\n");
        return pyodide;
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
        bottom-container {
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
        }
        bottom-output {
            display: grid;
            height: 33%;
        }
        bottom-output textarea {
            font-family: monospace;
            resize: none;
            padding: 0.5rem;
            color: #404040;
            background-color: #f5f5f5;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5rem;
        }
        bottom-buttons {
            height: fit-content;
            margin-block: 0.5rem; 
        }
        bottom-buttons button {
            margin-inline-end: 0.5rem;
            margin-block: 0.5rem;
            height: 2rem;
            padding-inline: 0.75rem;
            padding-block: 0.25rem;
            border: 1px solid transparent;
            border-radius: 0.25rem;
            color: slategray;
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
      'bottom-editor': BottomEditor
    }
}