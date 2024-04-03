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

    render() {
        return html`
            <div class="h-full flex flex-col overflow-hidden px-1 mt-1">
                <div class="h-5/6 grow flex md:flex-row flex-col gap-2">
                    <div id="code" class="grid h-2/3 md:h-full md:w-2/3 bg-neutral-100 border border-1 border-neutral-300 rounded p-px">
                        <!-- our code editor, where codemirror renders it's editor -->
                    </div>
                    <div class="grid h-1/3 md:h-full md:w-1/3 bg-neutral-100 m-0 border border-1 border-neutral-300 rounded p-px">
                        <!-- output section where we show the stdout of the python code execution -->
                        <textarea readonly style="font-family:monospace; resize:none;" class="p-2 text-neutral-700 bg-neutral-100" id="output"
                            name="output"></textarea>
                    </div>
                </div>
                <div class="h-fit my-2">
                    <!-- Run button to pass the code to pyodide.runPython() -->
                    <button id="run" @click="${this.evaluatePython}" type="button" title="Ctrl+Enter"
                        class="me-1 my-2 h-8 px-3 py-1 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-700 hover:bg-green-900 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-green-700 text-slate-300">Run</button>
                    <!-- Cleaning the output section -->
                    <button id="clear" @click="${this.clearHistory}" type="button"
                        class="me-1 my-2 h-8 px-3 py-1 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-red-700 hover:bg-red-900 focus:outline-none focus:ring-1   focus:ring-offset-2 focus:ring-red-700 text-slate-300">Clear
                    Output</button>
                    <button id="permalink" type="button"
                        class="ms-1 my-2 h-8 px-3 py-1 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-gray-700 hover:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-gray-700 text-slate-300">Copy
                        Permalink</button>
                </div>
            </div>`
    }

    static styles = css`
        :host {
            /* display: block; */
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
      'bottom-editor': BottomEditor
    }
}