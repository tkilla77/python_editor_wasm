# H5P.BottomExercise — Python Exercise

An H5P content type that embeds an interactive Python coding exercise powered by
[bottom.ch/editor](https://bottom.ch/editor) — a browser-based Python editor that runs entirely
client-side via Pyodide (WebAssembly), with no server required for code execution.

## Features

- Live Python execution in the browser (no backend)
- Optional test assertions with per-test pass/fail feedback
- Optional starter code and model solution (shown on demand)
- Scored xAPI statements (`answered` / `completed`)
- Student code persisted via H5P server-side state (Moodle gradebook compatible)

## Usage

Author exercises in the H5P editor: provide a prompt, starter code, test
assertions, and an optional solution. Students run their code directly in
the browser and receive instant feedback.

## Source & License

Source: <https://github.com/tkilla77/python_editor_wasm>  
License: MIT  
Powered by [bottom.ch](https://bottom.ch/editor)
