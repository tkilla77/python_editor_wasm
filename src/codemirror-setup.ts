import { EditorState } from "@codemirror/state"
import {
    EditorView, keymap, gutter, lineNumbers,
    highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
    rectangularSelection, crosshairCursor, highlightActiveLine,
} from "@codemirror/view"
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands"
import {
    indentUnit, bracketMatching, indentOnInput,
    syntaxHighlighting, defaultHighlightStyle,
} from "@codemirror/language"
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { lintGutter, lintKeymap } from "@codemirror/lint"
import { python } from "@codemirror/lang-python"

// Equivalent to codemirror's `basicSetup`, minus foldGutter() and
// foldKeymap — code folding is just distraction in a student editor.
const basicSetupNoFold = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
    ]),
];

/** Creates a CodeMirror Python editor mounted into `parent`. */
export function createPythonEditor(
    parent: Element,
    doc: string,
    onRun: () => void,
    onChange?: () => void,
): EditorView {
    const runKeymap = keymap.of([{
        key: "Ctrl-Enter",
        run: () => { onRun(); return true; },
    }]);
    const state = EditorState.create({
        doc,
        extensions: [
            basicSetupNoFold,
            python(),
            EditorState.tabSize.of(4),
            indentUnit.of('    '),
            runKeymap,
            keymap.of(defaultKeymap),
            keymap.of([indentWithTab]),
            lineNumbers(),
            bracketMatching(),
            gutter({ class: "cm-mygutter" }),
            lintGutter(),
            ...(onChange ? [EditorView.updateListener.of(u => { if (u.docChanged) onChange(); })] : []),
        ],
    });
    return new EditorView({ state, parent });
}
