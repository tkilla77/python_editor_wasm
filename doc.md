# bottom-editor — Embedding Guide

A self-contained Python editor web component powered by
[Pyodide](https://pyodide.org). Runs entirely in the browser — no server
required.

**Source:** [github.com/tkilla77/python_editor_wasm](https://github.com/tkilla77/python_editor_wasm)

---

## Quick start

Load the component script, then drop `<bottom-editor>` anywhere on the page.
The initial Python code goes as text content of the element.

```html
<script type="module" src="https://bottom.ch/editor/stable/bottom-editor.js"></script>

<bottom-editor>
print("Hello, world!")
</bottom-editor>
```

---

## Attributes

| Attribute | Values | Default | Description |
|-----------|--------|---------|-------------|
| `layout` | `console` \| `canvas` \| `split` | `console` | Which output panel(s) to show |
| `autorun` | boolean | off | Run code automatically on load |
| `showclear` | boolean | off | Show a Clear output button |
| `showswitcher` | boolean | off | Show canvas/console toggle rail (used by the standalone page) |
| `orientation` | `auto` \| `horizontal` \| `vertical` | `auto` | Force layout direction regardless of container width |
| `session` | string | — | Share a Pyodide worker with other editors that use the same session name |
| `zip` | URL | — | Zip archive to unpack into the virtual filesystem before running |
| `timeout` | seconds or `inf` | `30` | Maximum run time in seconds; `inf` disables the timeout |
| `sourcecode` | string | — | Set code programmatically (property, not reflected attribute) |

---

## Basic example

```html
<bottom-editor autorun showclear>
for i in range(5):
    print(i ** 2)
</bottom-editor>
```

<bottom-editor autorun showclear>
for i in range(5):
    print(i ** 2)
</bottom-editor>

---

## Turtle graphics

Set `layout="canvas"` to show only the canvas, or `layout="split"` for
canvas and console side by side.

```html
<bottom-editor layout="canvas" autorun>
import turtle

t = turtle.Turtle()
t.speed(6)
colors = ['red', 'orange', 'gold', 'green', 'blue', 'purple']
for i in range(90):
    t.pencolor(colors[i % len(colors)])
    t.forward(i * 0.5)
    t.left(59)
</bottom-editor>
```

<bottom-editor layout="canvas" autorun>
import turtle

t = turtle.Turtle()
t.speed(6)
colors = ['red', 'orange', 'gold', 'green', 'blue', 'purple']
for i in range(90):
    t.pencolor(colors[i % len(colors)])
    t.forward(i * 0.5)
    t.left(59)
</bottom-editor>

---

## Matplotlib

`plt.show()` renders the figure to the canvas.

```html
<bottom-editor layout="canvas" autorun>
import micropip
await micropip.install('matplotlib')

import matplotlib.pyplot as plt
import math

x = [i * 0.1 for i in range(63)]
plt.figure(figsize=(5, 4))
plt.plot(x, [math.sin(v) for v in x], label='sin')
plt.plot(x, [math.cos(v) for v in x], label='cos')
plt.legend()
plt.title('Trigonometric functions')
plt.tight_layout()
plt.show()
</bottom-editor>
```

<bottom-editor layout="canvas" autorun>
import micropip
await micropip.install('matplotlib')

import matplotlib.pyplot as plt
import math

x = [i * 0.1 for i in range(63)]
plt.figure(figsize=(5, 4))
plt.plot(x, [math.sin(v) for v in x], label='sin')
plt.plot(x, [math.cos(v) for v in x], label='cos')
plt.legend()
plt.title('Trigonometric functions')
plt.tight_layout()
plt.show()
</bottom-editor>

---

## Shared sessions

Editors with the same `session` attribute share a single Pyodide worker.
Functions or variables defined in one editor are immediately available in
the other.

```html
<bottom-editor session="demo" autorun>
def greet(name):
    print(f"Hi, {name}!")
</bottom-editor>

<bottom-editor session="demo" autorun>
greet("World")
</bottom-editor>
```

<bottom-editor session="demo" autorun>
def greet(name):
    print(f"Hi, {name}!")
</bottom-editor>

<bottom-editor session="demo" autorun>
greet("World")
</bottom-editor>

---

## Orientation

By default the layout switches from vertical (code above, output below) to
horizontal (code left, output right) when the container is wider than 768 px.
Use `orientation="horizontal"` or `orientation="vertical"` to lock it.

```html
<bottom-editor orientation="horizontal" autorun>
print("Always side by side")
</bottom-editor>
```

<bottom-editor orientation="horizontal" autorun>
print("Always side by side")
</bottom-editor>

---

## Timeout

The default run timeout is 30 s. Set `timeout="inf"` for long-running code,
or a lower value for stricter sandboxing.

```html
<bottom-editor timeout="5" autorun>
# will be interrupted after 5 s
while True:
    pass
</bottom-editor>
```

<bottom-editor timeout="5" autorun>
# will be interrupted after 5 s
while True:
    pass
</bottom-editor>

---

## CSS theming

Four custom properties can be set on the element or any ancestor:

| Property | Default | Description |
|----------|---------|-------------|
| `--be-border` | `1px solid #d4d4d4` | Border of editor, console, and canvas boxes |
| `--be-border-radius` | `0.5em` | Corner radius of those boxes |
| `--be-editor-bg` | `white` | Background of the code editor and canvas |
| `--be-output-bg` | `#f5f5f5` | Background of the console output |

```html
<style>
  .dark-editor {
    --be-border: none;
    --be-border-radius: 0.25em;
    --be-editor-bg: #1e1e1e;
    --be-output-bg: #1e1e1e;
    color-scheme: dark;
  }
</style>

<bottom-editor class="dark-editor" autorun>
print("Dark theme")
</bottom-editor>
```

<style>
  .dark-editor {
    --be-border: none;
    --be-border-radius: 0.25em;
    --be-editor-bg: #1e1e1e;
    --be-output-bg: #111;
  }
</style>

<bottom-editor class="dark-editor" autorun>
print("Dark theme")
</bottom-editor>

---

## Programmatic use

The element exposes a few properties and methods:

```js
const editor = document.querySelector('bottom-editor');

// Wait for Pyodide to be ready
await editor.ready;

// Read / set source code
console.log(editor.sourceCode);
editor.sourceCode = 'print(42)';

// Run programmatically
await editor.evaluatePython();

// Read last output
console.log(editor.outputText);
```
