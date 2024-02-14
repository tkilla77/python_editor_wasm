# Running Python in the Browser with WebAssembly

A code editor that runs Python in the browser using Pyodide, CodeMirror and WebAssembly.

Copied from https://github.com/amirtds/python_editor_wasm

## Goal

Provide a simple-most but usable python environment for novice programmers.

Properties:
1. Client-only mode (no server-side execution necessary, though possible for some features).
2. Support for turtle graphics, possibly a grid-based environment similar to Kara.
3. Usable in kiosk-mode browsers (e.g. locked down test environments such as isTest2).
   * Ability to disable any in-app sharing with other users.
5. Ability to preload source code and file content via deep linking schmeme.
6. Multi-file support (hidden in the initial setup).
7. Simple debugging support.

## Related Projects

 * https://pyodide.org/
   * The basis for client-side python execution
 * https://console.basthon.fr/
   * [x] supports deep links
   * [x] turtle
   * [x] pyiodide-based
   * [ ] no additional files / modules
 * https://futurecoder.io/course/
   * [x] Editor OK
   * [ ] no turtle
   * [ ] no deep links (?)
   * [ ] no multi-file
   * [x] Really elaborate tutoring, step completion etc.
   * [x] features 'birds-eye' view

## Want to use this project?

TBD
