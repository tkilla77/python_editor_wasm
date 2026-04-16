# bottom-editor — Embedding Guide

A self-contained Python editor web component powered by
[Pyodide](https://pyodide.org) and [Codemirror](https://codemirror.net/). Runs entirely in the browser — no server
required. No code is ever passed to the server, there is no login or account feature, so the component is safe to use from exam systems such
as [SafeExamBrowser](https://safeexambrowser.org/) or [isTest2](https://istest2.ch/).

**Source:** [github.com/tkilla77/python_editor_wasm](https://github.com/tkilla77/python_editor_wasm)

**See also:** [Kara grid world →](kara.html)

---

## Quick start

Load the component script, then drop `<bottom-editor>` anywhere on the page. The initial Python code goes as text content of the element.


```html
<script type="module" src="https://bottom.ch/editor/stable/bottom-editor.js"></script>

<bottom-editor autorun>
for i in range(5):
    print(i ** 2, end=' ')
</bottom-editor>
```

<bottom-editor autorun>
for i in range(5):
    print(i ** 2, end=' ')
</bottom-editor>


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
| `id` | string | — | Enables localStorage persistence; code is saved and restored on reload (see [Editor persistence](#editor-persistence)) |
| `storage` | `local` \| `none` | `local` when `id` set | Storage backend; `none` opts out even when `id` is present |
| `sourcecode` | string | — | Set code programmatically (property, not reflected attribute) |

---

## Turtle graphics

Set `layout="canvas"` to show only the canvas, or `layout="split"` for
canvas and console side by side.

```html
<bottom-editor layout="canvas" showclear>
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

<bottom-editor layout="canvas">
import turtle

t = turtle.Turtle()
t.speed(9)
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
<bottom-editor layout="canvas">
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

<bottom-editor layout="canvas">
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
<bottom-editor orientation="vertical">
print("lways fills horizontally.")
</bottom-editor>
```

<bottom-editor orientation="vertical">
print("Always fills horizontally.")
</bottom-editor>

---

## Timeout

The default run timeout is 30 s. Set `timeout="inf"` for long-running code,
or a lower value for stricter sandboxing.

```html
<bottom-editor timeout="5" session="timeout-demo">
# will be interrupted after 5 s
while True:
    pass
</bottom-editor>
```

<bottom-editor timeout="5" session="timeout-demo">
# will be interrupted after 5 s
while True:
    pass
</bottom-editor>

---

## Exercises

`<bottom-exercise>` wraps `<bottom-editor>` with exercise semantics: a prompt,
starter code, test assertions, and a results panel. The Run button runs the tests;
the Reset button restores the starter code. Progress is saved in `localStorage`
automatically — no exercise ID required.

Load `bottom-exercise.js` **instead of** (or alongside) `bottom-editor.js`:

```html
<script type="module" src="https://bottom.ch/editor/stable/bottom-exercise.js"></script>
```

### Template syntax

Place starter code and tests in `<template>` elements inside the component.
The prompt goes in a `<div slot="prompt">`:

```html
<bottom-exercise>
  <div slot="prompt">
    <p>Write a function <code>sum_to(n)</code> that returns 1 + 2 + … + n.</p>
  </div>
  <template data-type="starter">
def sum_to(n):
    pass
  </template>
  <template data-type="test">
assert sum_to(5) == 15, "sum_to(5) should be 15"
assert sum_to(1) == 1
assert sum_to(0) == 0
  </template>
</bottom-exercise>
```

<bottom-exercise>
<div slot="prompt">
<p>Write a function <code>sum_to(n)</code> that returns 1 + 2 + … + n.
Return 0 for n ≤ 0.</p>
</div>
<template data-type="starter">
def sum_to(n):
    pass
</template>
<template data-type="test">
assert sum_to(5) == 15, "sum_to(5) should be 15"
assert sum_to(1) == 1, "sum_to(1) should be 1"
assert sum_to(0) == 0, "sum_to(0) should be 0"
</template>
</bottom-exercise>

### CMS-friendly syntax

Some CMS platforms strip `<template>` elements, or wrap the whole block in `<p>`
which the HTML parser uses to eject block-level children. Use
`<script type="text/x-starter">` / `<script type="text/x-test">` instead — they
are phrasing content and survive both problems. For the prompt, use inline text
rather than a `<div>` for the same reason:

```html
<bottom-exercise>
  Write a function <code>fizzbuzz(n)</code> that returns <code>"Fizz"</code>,
  <code>"Buzz"</code>, <code>"FizzBuzz"</code>, or the number as a string.
  <script type="text/x-starter">
def fizzbuzz(n):
    pass
  </script>
  <script type="text/x-test">
assert fizzbuzz(3) == "Fizz"
assert fizzbuzz(5) == "Buzz"
assert fizzbuzz(15) == "FizzBuzz"
assert fizzbuzz(7) == "7"
  </script>
</bottom-exercise>
```

<bottom-exercise>
Write a function <code>fizzbuzz(n)</code> that returns <code>"Fizz"</code> if divisible
by 3, <code>"Buzz"</code> if divisible by 5, <code>"FizzBuzz"</code> if both, or the
number as a string otherwise.
<script type="text/x-starter">
def fizzbuzz(n):
    pass
</script>
<script type="text/x-test">
assert fizzbuzz(3) == "Fizz", f"fizzbuzz(3) should be 'Fizz', got {fizzbuzz(3)!r}"
assert fizzbuzz(5) == "Buzz", f"fizzbuzz(5) should be 'Buzz', got {fizzbuzz(5)!r}"
assert fizzbuzz(15) == "FizzBuzz", f"fizzbuzz(15) should be 'FizzBuzz', got {fizzbuzz(15)!r}"
assert fizzbuzz(7) == "7", f"fizzbuzz(7) should be '7', got {fizzbuzz(7)!r}"
</script>
</bottom-exercise>

### Testing printed output

Each test statement runs as a separate Python assertion in the same namespace as
the user's code. Two helpers are automatically available for exercises where the
student prints output rather than returning a value:

| Helper | Returns |
|--------|---------|
| `output()` | Everything the code printed, as a single string (newlines included) |
| `output_lines()` | `output().splitlines()` — each printed line as a clean string |

Output is still shown in the output panel as normal — the helpers just provide
a second view of the same text for assertions.

```html
<bottom-exercise>
  <div slot="prompt"><p>Print the numbers 1 to 5, one per line.</p></div>
  <template data-type="starter">
# your code here
  </template>
  <template data-type="test">
assert output_lines() == ["1", "2", "3", "4", "5"], \
    f"Expected lines 1–5, got {output_lines()!r}"
  </template>
</bottom-exercise>
```

<bottom-exercise>
<div slot="prompt"><p>Print the numbers 1 to 5, one per line.</p></div>
<template data-type="starter">
# your code here
</template>
<template data-type="test">
assert output_lines() == ["1", "2", "3", "4", "5"], \
    f"Expected lines 1–5, got {output_lines()!r}"
</template>
</bottom-exercise>

Other useful patterns:

```python
assert "hello" in output().lower()           # substring check
assert len(output_lines()) == 10             # line count
assert output().strip() == "42"             # ignore trailing newline
```

### Solutions

Add a `<template data-type="solution">` (or `<script type="text/x-solution">`) to
provide a model solution. A **Show solution** button appears and requires a
confirmation click before replacing the editor contents.

```html
<bottom-exercise>
  ...
  <template data-type="solution">
def sum_to(n):
    return n * (n + 1) // 2
  </template>
</bottom-exercise>
```

For embedding in a CMS, the `solution` attribute accepts plain text or a
[data URL](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs)
(useful for multi-line code encoded as base64):

```html
<!-- plain text (simple cases) -->
<bottom-exercise solution="return n * (n + 1) // 2">...</bottom-exercise>

<!-- base64 (multi-line, no escaping needed) -->
<bottom-exercise solution="data:text/plain;base64,ZGVmIHN1bV90...">...</bottom-exercise>
```

`solved` and `viewed-solution` are both terminal states: showing the solution
after solving keeps the `solved` badge; passing tests after viewing the solution
keeps the `viewed-solution` badge.

### Test-free exercises

Tests are optional. Without a `<template data-type="test">` block, the Run
button simply executes the code and shows output — useful for turtle graphics,
open-ended prompts, or stages where students haven't learned functions yet.
A solution can still be provided.

```html
<bottom-exercise id="turtle-square">
  <div slot="prompt"><p>Draw a square with side length 100.</p></div>
  <template data-type="starter">
import turtle
t = turtle.Turtle()
# your code here
  </template>
  <template data-type="solution">
import turtle
t = turtle.Turtle()
for _ in range(4):
    t.forward(100)
    t.right(90)
  </template>
</bottom-exercise>
```

### Exercise attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `id` | — | localStorage key for persistence; page-scoped (same as `<bottom-editor>`). Without `id`, nothing is saved. |
| `layout` | `console` | Which output panel(s) to show (`console` \| `canvas` \| `split`) |
| `session` | — | Share a Pyodide worker with other editors on the page |
| `orientation` | `auto` | Layout direction (`auto` \| `horizontal` \| `vertical`) |
| `timeout` | `30` | Run timeout in seconds; `inf` disables it |
| `zip` | — | Zip archive to pre-load into the virtual filesystem |

### Persistence

Add an `id` attribute to save exercise state to `localStorage`. The key is
page-scoped (using `<link rel="canonical">` or `location.pathname+search`,
same as `<bottom-editor>`), so the same `id` on different pages is safe and
a review chapter always starts fresh.

The state machine:

```
pristine → started → attempted ──→ solved
                               ↘→ viewed-solution
```

`solved` and `viewed-solution` are terminal. For test-free exercises the state
only advances to `started`.

---

## Editor persistence

Add an `id` attribute to persist editor contents in `localStorage`. The code is restored on the next page load. A **Revert** button appears automatically in the toolbar, restoring the original code and clearing the saved entry.

```html
<bottom-editor id="hello-world">
print("Hello, world!")
</bottom-editor>
```

The storage key combines the page URL and the element id, so reusing the same `id` on different pages is safe.

**Opt out** on a specific editor with `storage="none"`:

```html
<bottom-editor id="demo" storage="none">...</bottom-editor>
```

**Site-wide default** — set `window.BottomEditorConfig` before the script tag to configure all editors on the page (useful for a site-wide include):

```html
<script>window.BottomEditorConfig = { storage: 'none' }</script>
<script type="module" src="bottom-editor.js"></script>
```

**Page identity** — the storage key uses `<link rel="canonical">` (pathname + search) if present, falling back to `location.pathname + location.search`. Fragments are excluded so anchor-link navigation never orphans saved state. CMS systems that identify pages by query parameter (e.g. `?id=mypage`) work correctly when a canonical tag is present.

---

## Cloud sync (`<bottom-exercise>`)

When the deployed build includes cloud credentials, a **Sync** button appears in every `<bottom-exercise>`. Students can connect Google Drive or OneDrive so their progress follows them across devices and browsers.

Cloud state is layered on top of localStorage: every edit is written locally first; cloud writes are debounced by 2 s. On page load, localStorage is applied immediately and the cloud copy is fetched in the background.

### Restricting available backends

The build may support multiple cloud providers, but a site administrator or page author can limit which ones are offered — useful when a school mandates a specific provider.

**Site-wide** (e.g. in a shared header include):

```html
<script>
window.BottomEditorConfig = {
    storageBackends: ['microsoft'],   // only OneDrive; omit key to allow all compiled-in backends
}
</script>
<script type="module" src="https://bottom.ch/editor/stable/bottom-editor.js"></script>
```

**Page-wide** (same pattern, just on one page):

```html
<script>
window.BottomEditorConfig = { storageBackends: ['google'] }
</script>
```

`storageBackends` is the subset of `['google', 'microsoft']` to offer. Providers not compiled into the build are silently ignored. Omitting the key (or setting it to a non-array) shows all compiled-in backends.

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

<bottom-editor class="dark-editor">
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

<bottom-editor class="dark-editor">
print("Dark theme")
</bottom-editor>

---

## Loading files with `zip`

Use the `zip` attribute to pre-load a `.zip` archive into the virtual
filesystem before the editor runs. Useful for distributing helper modules
or data files alongside an exercise.

```html
<bottom-editor zip="https://example.com/exercises.zip" autorun>
import mymodule
mymodule.run()
</bottom-editor>
```

The archive is unpacked into `/home/pyodide/` (the default Python path),
so any `.py` files inside are directly importable.

> **CORS required.** The server hosting the zip must send `Access-Control-Allow-Origin: *` (or the page origin).

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
