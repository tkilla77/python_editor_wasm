import { LitElement, css, html } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

import {EditorState} from "@codemirror/state"
import {basicSetup} from "codemirror"
import {EditorView, keymap} from "@codemirror/view"
import {defaultKeymap} from "@codemirror/commands"

@customElement('bottom-editor')
class BottomEditor extends LitElement {
    constructor() {
        super();
    }

    @query('#code')
    _code;
  
    @query('#output')
    _output;
  

    indent(cm) {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
        } else {
          cm.replaceSelection(cm.getOption("indentWithTabs")? "\t":
            Array(cm.getOption("indentUnit") + 1).join(" "), "end", "+input");
        }
    }
    unindent(cm) {
        cm.indentSelection("subtract");
    }
    
    run(cm) {
        evaluatePython();
    }  

    firstUpdated() {
        let editorState = EditorState.create({
            doc: "Hello World",
            extensions: [keymap.of(defaultKeymap)]
          })
          
        this._editor = new EditorView({
            state: editorState,
            extensions: [basicSetup],
            parent: this._code
          })
        // this._editor = CodeMirror.fromTextArea(this._code, {
        //     mode: {
        //         name: "python",
        //         version: 3,
        //         singleLineStringErrors: false,
        //     },
        //     theme: "eclipse",
        //     lineNumbers: true,
        //     indentUnit: 4,
        //     tabSize: 4,
        //     matchBrackets: true,
        //     extraKeys: {
        //       Tab: this.indent,
        //       'Shift-Tab': this.unindent,
        //       'Ctrl-Enter': this.run,
        //     },
        //   });
        this._output.value = "Initializing..."

              
        // run the main function
        this.pyodideReadyPromise = this.main();
    }

    async clearHistory() {
        this._output.value = ""
    }

    // Add pyodide returned value to the output
    addToOutput(stdout) {
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
            let code = this._editor.state.doc.text;
            let result = pyodide.runPython(code);
            let stdout = pyodide.runPython("sys.stdout.getvalue()");
            this.addToOutput(stdout);
        } catch (err) {
            // Drop uninteresting output from runPython
            err = err.toString();
            let debug_idx = err.indexOf('  File "<exec>"');
            if (debug_idx > 0) {
            err = err.substring(debug_idx);
            }
            this.addToOutput(err);
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
            background-color: #f5f5f5;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5rem;
        }
        bottom-output {
            display: grid;
            height: 33%;
            background-color: #f5f5f5;
            border: 1px #d4d4d4 solid;
            border-radius: 0.5rem;
        }
        bottom-output textarea {
            font-family: monospace;
            resize: none;
            padding: 0.5rem;
            color: #404040;
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
}

declare global {
    interface HTMLElementTagNameMap {
      'bottom-editor': BottomEditor
    }
}