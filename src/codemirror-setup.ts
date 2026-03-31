import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, gutter, lineNumbers } from "@codemirror/view"
import { defaultKeymap, indentWithTab } from "@codemirror/commands"
import { indentUnit, bracketMatching } from "@codemirror/language"
import { python } from "@codemirror/lang-python"

/** Creates a CodeMirror Python editor mounted into `parent`. */
export function createPythonEditor(
    parent: Element,
    doc: string,
    onRun: () => void,
): EditorView {
    const runKeymap = keymap.of([{
        key: "Ctrl-Enter",
        run: () => { onRun(); return true; },
    }]);
    const state = EditorState.create({
        doc,
        extensions: [
            basicSetup,
            python(),
            EditorState.tabSize.of(4),
            indentUnit.of('    '),
            runKeymap,
            keymap.of(defaultKeymap),
            keymap.of([indentWithTab]),
            lineNumbers(),
            bracketMatching(),
            gutter({ class: "cm-mygutter" }),
        ],
    });
    return new EditorView({ state, parent });
}
