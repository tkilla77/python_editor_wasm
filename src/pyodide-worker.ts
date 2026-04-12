
console.log("worker loaded!")

type Msg = {
    type: string,
    baseURL: string,
    indexURL: string,
    code?: string,
    tests?: string,
    runId?: number,
    url?: string,
    canvas?: OffscreenCanvas,
    interruptBuffer?: any,
    x?: number,
    y?: number,
    editorId?: string,
    value?: string,
    prompt?: string,
}

/**
 * Clear user-defined names from globals before each exercise run so that
 * state from a previous run cannot leak into the next one.
 * Keeps dunder names (__builtins__, etc.) and everything in builtins.
 */
const RESET_GLOBALS = `
import builtins as __bi
__g = globals()
[__g.pop(k) for k in list(__g) if k not in dir(__bi) and not k.startswith('__')]
del __bi, __g
`;

/**
 * Python test harness that runs each top-level statement from __test_source__
 * individually, collecting structured pass/fail results as JSON.
 * Assumes user code has already been executed in the same namespace.
 */
const TEST_HARNESS = `
def __run_tests__():
    import ast, json
    results = []
    try:
        tree = ast.parse(__test_source__)
    except SyntaxError as e:
        return json.dumps({"results": [{"passed": False, "test": "<parse error>", "message": str(e)}], "passed": False})

    for node in tree.body:
        source = ast.get_source_segment(__test_source__, node)
        if source is None:
            try:
                source = ast.unparse(node)
            except Exception:
                source = "<test>"
        code = compile(ast.Module(body=[node], type_ignores=[]), '<test>', 'exec')
        try:
            exec(code, globals())
            results.append({"passed": True, "test": source})
        except AssertionError as e:
            msg = str(e)
            results.append({"passed": False, "test": source, "message": msg if msg else None})
        except Exception as e:
            results.append({"passed": False, "test": source, "message": f"{type(e).__name__}: {e}"})

    return json.dumps({"results": results, "passed": all(r["passed"] for r in results)})

__run_tests__()
`;

let py: any = null;
let inputResolve: ((value: string) => void) | null = null;
// Per-editor canvas contexts, keyed by editorId.
const canvasCtxMap = new Map<string, OffscreenCanvasRenderingContext2D>();
// The context currently active (set before each run).
let canvasCtx: OffscreenCanvasRenderingContext2D | null = null;
let stdoutBuffer = '';
let flushTimer: number | null = null;
let currentRunId: number | undefined = undefined;
let syncRun = false;   // true while runPython (blocking) is active
const FLUSH_INTERVAL_MS = 100;
// Buffer limits (configurable): keep at most these many lines/chars (last N)
const MAX_OUTPUT_LINES = 100;
const MAX_OUTPUT_CHARS = 5000;
let trimmedNotice: string | null = null;

function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = (self as any).setTimeout(() => {
        flushTimer = null;
        flushStdout();
    }, FLUSH_INTERVAL_MS);
}

function flushStdout() {
    if (!stdoutBuffer && !trimmedNotice) return;
    const data = (trimmedNotice ? (trimmedNotice + stdoutBuffer) : stdoutBuffer);
    post('stdout', { runId: currentRunId, data });
    stdoutBuffer = '';
    trimmedNotice = null;
}

function enforceBufferLimits() {
    // Trim to last MAX_OUTPUT_LINES
    const lines = stdoutBuffer.split(/\r?\n/);
    if (lines.length > MAX_OUTPUT_LINES) {
        const removed = lines.length - MAX_OUTPUT_LINES;
        const tail = lines.slice(-MAX_OUTPUT_LINES);
        stdoutBuffer = tail.join('\n');
        trimmedNotice = `...[output trimmed: ${removed} lines]...\n`;
    }
    // Trim to last MAX_OUTPUT_CHARS
    if (stdoutBuffer.length > MAX_OUTPUT_CHARS) {
        const removedChars = stdoutBuffer.length - MAX_OUTPUT_CHARS;
        stdoutBuffer = stdoutBuffer.slice(-MAX_OUTPUT_CHARS);
        // If we trimmed in the middle of a line, drop the partial first line
        const firstNewline = stdoutBuffer.indexOf('\n');
        if (firstNewline > 0) {
            stdoutBuffer = stdoutBuffer.slice(firstNewline + 1);
        }
        // If there was already a trimmedNotice, preserve it and append info, otherwise set new
        const charsNotice = `...[output trimmed: ~${removedChars} chars]...\n`;
        trimmedNotice = trimmedNotice ? (trimmedNotice + charsNotice) : charsNotice;
    }
}

function post(type: string, payload: any = {}) {
    (self as any).postMessage({ type, ...payload });
}

import { loadPyodide } from 'pyodide';
import turtleShim from './turtle-shim.py?raw';
import canvasShim from './canvas-shim.py?raw';
async function init(baseURL: string, indexURL: string) {
    (self as any).baseURL = baseURL

    try {

        post('log', { data: 'Loading pyodide...' });
        py = await loadPyodide({ indexURL });
        post('log', { data: 'Pyodide loaded, loading micropip...' });
        // Expose write callback as a JS global so Python can call it directly,
        // bypassing TextIOWrapper buffering (reconfigure(write_through=True) is
        // unreliable on Pyodide's custom stream wrapper).
        (self as any)._pyWrite = (text: string) => {
            stdoutBuffer += text;
            if (syncRun) { enforceBufferLimits(); flushStdout(); }
            else scheduleFlush();
        };
        (self as any)._pyInput = (prompt: string): Promise<string> => {
            flushStdout();
            return new Promise<string>(resolve => {
                inputResolve = resolve;
                post('input', { prompt });
            });
        };
        await py.loadPackage('micropip', { messageCallback: (msg: string) => post('log', { data: msg }) });
        py.FS.writeFile('/home/pyodide/turtle.py', turtleShim);
        py.FS.writeFile('/home/pyodide/canvas_shim.py', canvasShim);
        await py.runPythonAsync(`import canvas_shim`);
        // Replace sys.stdout with a thin wrapper that calls _pyWrite directly,
        // so every write (including print(..., end='')) is sent to JS immediately.
        // Also override builtins.input to use _pyInput (async, routed to main thread).
        await py.runPythonAsync(`
import sys, builtins
from js import _pyWrite, _pyInput
class _Stdout:
    encoding = 'utf-8'
    errors = 'strict'
    def write(self, text):
        if text: _pyWrite(text)
        return len(text)
    def flush(self): pass
sys.stdout = _Stdout()
async def _input(prompt=''):
    result = await _pyInput(str(prompt))
    return result.to_py() if hasattr(result, 'to_py') else str(result) if result is not None else ''
builtins.input = _input
`);
        await py.runPythonAsync(`\nfrom js import console\n`);
        post('ready');
    } catch (err: any) {
        post('error', { error: String(err) });
    }
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
    const msg = ev.data;
    try {
        if (msg.type === 'inputResponse') {
            if (inputResolve) {
                const resolve = inputResolve;
                inputResolve = null;
                resolve(typeof msg.value === 'string' ? msg.value : '');
            }
            return;
        }

        if (msg.type === 'interrupt') {
            // Try to signal Pyodide to interrupt execution if supported.
            try {
                // Preferred API: py.interrupt() if exposed
                if (py && typeof (py as any).interrupt === 'function') {
                    (py as any).interrupt();
                    post('interrupted');
                    return;
                }

                // Fallback: attempt to call underlying wasm module abort function if available
                if (py && (py as any)._module) {
                    const m = (py as any)._module;
                    if (typeof m.pyodide_interrupt === 'function') {
                        (m as any).pyodide_interrupt();
                        post('interrupted');
                        return;
                    }
                    if (typeof m.abort === 'function') {
                        try { (m as any).abort(); post('interrupted'); return; } catch(e) { }
                    }
                }

                // If we get here, interrupt isn't supported from inside worker
                post('interrupt-unavailable');
            } catch (e: any) {
                post('error', { error: String(e) });
            }
            return;
        }
        if (msg.type === 'setInterruptBuffer') {
            try {
                let buf = msg.interruptBuffer;
                if (buf instanceof SharedArrayBuffer) {
                    buf = new Uint8Array(buf);
                }
                if (py && typeof (py as any).setInterruptBuffer === 'function') {
                    (py as any).setInterruptBuffer(buf);
                    post('log', { data: 'Interrupt buffer set' });
                } else {
                    post('log', { data: 'py.setInterruptBuffer not available' });
                }
            } catch (e: any) {
                post('error', { error: String(e) });
            }
            return;
        }

        if (msg.type === 'init') {
            await init(msg.baseURL, msg.indexURL);
            return;
        }

        if (msg.type === 'setCanvas' && py && msg.canvas && msg.editorId) {
            try {
                const ctx = msg.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
                if (!ctx) {
                    post('log', { data: 'Canvas context is null — OffscreenCanvas not supported?' });
                    return;
                }
                canvasCtxMap.set(msg.editorId, ctx);
                post('log', { data: 'Canvas attached' });
            } catch (e) {
                post('log', { data: 'Canvas attach failed: ' + String(e) });
            }
            return;
        }

        if (msg.type === 'clearCanvas' && msg.editorId) {
            const ctx = canvasCtxMap.get(msg.editorId);
            if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            return;
        }

        if (msg.type === 'samplePixel') {
            const ctx = msg.editorId ? canvasCtxMap.get(msg.editorId) : canvasCtx;
            if (!ctx || msg.x === undefined || msg.y === undefined) {
                post('pixelSample', { r: 0, g: 0, b: 0, a: 0 });
                return;
            }
            const [r, g, b, a] = ctx.getImageData(msg.x, msg.y, 1, 1).data;
            post('pixelSample', { r, g, b, a });
            return;
        }

        if (msg.type === 'requestFit') {
            const ctx = msg.editorId ? canvasCtxMap.get(msg.editorId) : canvasCtx;
            if (!ctx) { post('fitBounds', { found: false }); return; }
            const { width, height } = ctx.canvas;
            const data = ctx.getImageData(0, 0, width, height).data;
            let minX = width, minY = height, maxX = -1, maxY = -1;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (data[(y * width + x) * 4 + 3] > 0) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX < 0) {
                post('fitBounds', { found: false });
            } else {
                post('fitBounds', { found: true, minX, minY, maxX: maxX + 1, maxY: maxY + 1 });
            }
            return;
        }

        if (msg.type === 'run') {
            if (!py) {
                post('error', { runId: msg.runId, error: 'Pyodide not initialized' });
                return;
            }
            const runId = msg.runId;
            currentRunId = runId;
            // Switch the active canvas to this editor's canvas (if any).
            canvasCtx = (msg.editorId && canvasCtxMap.get(msg.editorId)) || null;
            if (canvasCtx) py.canvas.setCanvas2D(canvasCtx.canvas);
            // Expand `repeat <expr>:` → `for _ in range(<expr>):` (webtigerpython compat).
            // Line-by-line substitution preserves line numbers in tracebacks.
            const code = (msg.code || '')
                // One-liners: `repeat 3: body`
                .replace(/^(\s*)repeat(\s+)(.+?)\s*:([ \t]+[^#\s].*)$/gm,
                         '$1for _ in range($3):$4')
                // Block headers: `repeat 3:` (optional trailing comment)
                .replace(/^(\s*)repeat(\s+)(.+?)\s*:(\s*(?:#.*)?)$/gm,
                         '$1for _ in range($3):$4');
            // Use the faster synchronous runPython when the code has no top-level
            // awaits (turtle/kara steps, micropip installs). Fall back to
            // runPythonAsync when await is present.
            const needsAsync = /\bawait\b|import turtle\b|from turtle\b|\binput\s*\(/.test(code);
            // Reset default turtle state before each run so heading/position don't persist.
            if (py.runPython(`'turtle' in __import__('sys').modules`)) {
                py.runPython(`__import__('sys').modules['turtle']._reset_default()`);
            }
            // Rewrite bare input(...) calls to await input(...) so user code doesn't need to.
            const codeToRun = needsAsync
                ? code.replace(/\binput\s*\(/g, 'await input(')
                : code;
            syncRun = !needsAsync;
            const runCode = needsAsync
                ? (c: string) => py.runPythonAsync(c)
                : (c: string) => Promise.resolve(py.runPython(c));
            try {
                try {
                    await runCode(codeToRun);
                    // Patch any libraries installed via micropip during this run.
                    await py.runPythonAsync('import canvas_shim; canvas_shim.apply_pending()');
                    // ensure all buffered stdout is flushed before signaling done
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    syncRun = false;
                    currentRunId = undefined;
                    post('done', { runId });
                } catch (err: any) {
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    syncRun = false;
                    currentRunId = undefined;
                    post('error', { runId, error: String(err) });
                }
            } catch (err: any) {
                if (flushTimer !== null) {
                    (self as any).clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushStdout();
                syncRun = false;
                currentRunId = undefined;
                post('error', { runId, error: String(err) });
            }
            return;
        }

        if (msg.type === 'runWithTests') {
            if (!py) {
                post('error', { runId: msg.runId, error: 'Pyodide not initialized' });
                return;
            }
            const runId = msg.runId;
            currentRunId = runId;
            canvasCtx = (msg.editorId && canvasCtxMap.get(msg.editorId)) || null;
            if (canvasCtx) py.canvas.setCanvas2D(canvasCtx.canvas);
            const code = (msg.code || '')
                .replace(/^(\s*)repeat(\s+)(.+?)\s*:([ \t]+[^#\s].*)$/gm,
                         '$1for _ in range($3):$4')
                .replace(/^(\s*)repeat(\s+)(.+?)\s*:(\s*(?:#.*)?)$/gm,
                         '$1for _ in range($3):$4');
            const needsAsync = /\bawait\b|import turtle\b|from turtle\b|\binput\s*\(/.test(code);
            if (py.runPython(`'turtle' in __import__('sys').modules`)) {
                py.runPython(`__import__('sys').modules['turtle']._reset_default()`);
            }
            const codeToRun = needsAsync
                ? code.replace(/\binput\s*\(/g, 'await input(')
                : code;
            syncRun = !needsAsync;
            const runCode = needsAsync
                ? (c: string) => py.runPythonAsync(c)
                : (c: string) => Promise.resolve(py.runPython(c));
            try {
                // Reset globals so state from a previous run can't leak in.
                try { py.runPython(RESET_GLOBALS); } catch {}
                // Phase 1: run user code
                await runCode(codeToRun);
                await py.runPythonAsync('import canvas_shim; canvas_shim.apply_pending()');
                if (flushTimer !== null) {
                    (self as any).clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushStdout();
                syncRun = false;

                // Phase 2: run test harness in the same namespace
                try {
                    py.globals.set('__test_source__', msg.tests || '');
                    const resultJson = await py.runPythonAsync(TEST_HARNESS);
                    const testResults = JSON.parse(resultJson);
                    currentRunId = undefined;
                    post('testResults', { runId, results: testResults });
                } catch (harnessErr: any) {
                    currentRunId = undefined;
                    post('testResults', { runId, results: {
                        passed: false,
                        results: [{ passed: false, test: '<harness error>', message: String(harnessErr) }]
                    }});
                } finally {
                    try { py.runPython("del __test_source__, __run_tests__"); } catch {}
                }
            } catch (err: any) {
                // User code failed — don't run tests
                if (flushTimer !== null) {
                    (self as any).clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushStdout();
                syncRun = false;
                currentRunId = undefined;
                post('error', { runId, error: String(err) });
            }
            return;
        }

        if (msg.type === 'loadZip') {
            if (!py) {
                post('error', { error: 'Pyodide not initialized' });
                return;
            }
            const url = msg.url;
            if (!url) {
                post('error', { error: 'No URL provided for loadZip' });
                return;
            }
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('Failed to fetch zip: ' + resp.status);
                const ab = await resp.arrayBuffer();
                await py.unpackArchive(ab, 'zip');
                post('log', { data: 'Zip unpacked' });
            } catch (e) {
                post('error', { error: String(e) });
            }
            return;
        }

    } catch (e: any) {
        post('error', { error: String(e) });
    }
};

//export {};
