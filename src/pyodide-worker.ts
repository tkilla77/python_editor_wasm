
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
 * Restore globals to the snapshot saved before this editor's last run.
 * Removes names the editor added AND restores values it may have changed,
 * so other editors' state is preserved exactly as it was.
 * Falls back to __init_globals__ on the very first run (no snapshot yet).
 */
const SNAPSHOT_RESET = `
if '__session_snapshot__' in globals():
    __g = globals()
    __snap = __session_snapshot__
    for __k in [k for k in list(__g) if not k.startswith('__') and k not in __snap]:
        __g.pop(__k, None)
    __g.update(__snap)
    del __g, __snap
else:
    __g = globals()
    [__g.pop(k) for k in list(__g) if k not in __init_globals__ and not k.startswith('__')]
    del __g
`;

/** Save a shallow copy of all non-dunder globals as the baseline for the next re-run. */
const SNAPSHOT_SAVE = `__session_snapshot__ = {k: v for k, v in globals().items() if not k.startswith('__')}`;

/**
 * Replaces sys.stdout with a tee that forwards every write to the original
 * (so the output panel stays live) while also capturing into a StringIO buffer.
 * Must be run before user code; CAPTURE_INJECT must be run after.
 */
const CAPTURE_SETUP = `
import sys as __sys

def __make_tee(orig):
    # Factory keeps io and buf as closure variables so no double-underscore
    # names appear inside the class body (which would trigger Python's name
    # mangling and produce a NameError at instantiation time).
    import io
    buf = io.StringIO()
    class _Capture:
        encoding = 'utf-8'
        errors = 'strict'
        _orig = orig          # single-underscore: no mangling
        def write(self, text):
            orig.write(text)  # closure variable: no mangling
            buf.write(text)
            return len(text)
        def flush(self): pass
        def getvalue(self): return buf.getvalue()
    return _Capture()

__sys.stdout = __make_tee(__sys.stdout)
del __make_tee
`;

/**
 * Restores sys.stdout and injects output() / output_lines() / with_input()
 * helpers into the test namespace so assertions can check what the user's
 * code printed.
 * Must be run after user code completes (including after a flush).
 */
const CAPTURE_INJECT = `
__captured_output__ = __sys.stdout.getvalue()
__sys.stdout = __sys.stdout._orig
del __sys
__energy_val__ = globals().get('__step_energy__', 0)
def output():
    """Return everything printed by the user's code as a single string."""
    return __captured_output__
def output_lines():
    """Return each printed line as a list, stripping the trailing newline."""
    return __captured_output__.splitlines()
def energy():
    """Return the number of source lines executed by the user's code."""
    return __energy_val__
def memory():
    """Return the number of non-blank, non-comment lines in the user's code."""
    return sum(
        1 for l in __user_code__.splitlines()[globals().get('__energy_min_line__', 0):]
        if l.strip() and not l.strip().startswith('#')
    )
def with_input(*inputs):
    """Re-run the user's code with the given inputs queued for input() calls.

    Updates output() and output_lines() to reflect this run.
    Always returns True so it can be used in assert expressions:

        assert with_input("3", "5") and "15" in output_lines()[-1]
    """
    import sys, io, builtins
    global __captured_output__
    _queue = [str(x) for x in inputs]
    def _sync_input(prompt=''):
        if not _queue:
            raise EOFError('with_input: no more inputs provided')
        return _queue.pop(0)
    _code = __user_code__.replace('await input(', 'input(')
    _buf = io.StringIO()
    _orig_stdout = sys.stdout
    class _Cap:
        encoding = 'utf-8'; errors = 'strict'
        def write(self, text): _orig_stdout.write(text); _buf.write(text); return len(text)
        def flush(self): pass
    _orig_input = builtins.input
    sys.stdout = _Cap()
    builtins.input = _sync_input
    try:
        exec(compile(_code, '<rerun>', 'exec'), {})
    finally:
        sys.stdout = _orig_stdout
        builtins.input = _orig_input
    __captured_output__ = _buf.getvalue()
    return True
`;

/**
 * Restores sys.stdout when user code raises — leaves no dangling tee wrapper.
 */
const CAPTURE_RESTORE = `
try:
    import sys as __sys
    if hasattr(__sys.stdout, '_orig'):
        __sys.stdout = __sys.stdout._orig
    del __sys
except Exception:
    pass
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

// ---------------------------------------------------------------------------
// Energy / step-through trace
// ---------------------------------------------------------------------------

/** Lightweight trace: count executed lines in <exec> code only. */
const ENERGY_TRACE_SETUP = `
import sys as __sys_trace__
__step_energy__ = 0
__energy_on__ = False
__energy_min_line__ = 0
__energy_max_line__ = 0
def __line_trace__(frame, event, arg):
    global __step_energy__
    if event == 'line' and __energy_on__ and __energy_min_line__ < frame.f_lineno <= __energy_max_line__ and frame.f_code.co_filename == '<exec>':
        __step_energy__ += 1
    return __line_trace__
__sys_trace__.settrace(__line_trace__)
`;

const ENERGY_TRACE_TEARDOWN = `__sys_trace__.settrace(None)`;

/** Step trace: counts like the energy trace, and also pauses before each user
 *  line until the page sends a step command. Pausing uses JSPI (run_sync), so
 *  the worker returns to its event loop while waiting: messages arrive and the
 *  canvas repaints. Needs the code to run via runPythonAsync. */
const STEP_TRACE_SETUP = `
import sys as __sys_trace__, json as __json_trace__, re as __re_trace__
from pyodide.ffi import run_sync as __run_sync__
from js import _step_update as __step_update__, _step_wait as __step_wait__, _step_mode as __step_mode__, _step_yield as __step_yield__
__step_energy__ = 0
__energy_on__ = False
__energy_min_line__ = 0
__energy_max_line__ = 0
__default_obj__ = __re_trace__.compile(r'<(?:[\\w.]+\\.)?(\\w+) object at 0x[0-9a-fA-F]+>')
def __step_repr__(v):
    # A repr in angle brackets isn't a readable value (open files, turtles, plain
    # objects): use str() if that's readable, else just the type name. Inside
    # containers, shorten the default "<mod.Class object at 0x...>" to "<Class>".
    r = repr(v)
    if r.startswith('<') and r.endswith('>'):
        s = str(v)
        r = s if not (s.startswith('<') and s.endswith('>')) else '<' + type(v).__name__ + '>'
    r = __default_obj__.sub(r'<\\1>', r)
    return r if len(r) <= 120 else r[:117] + '...'
def __step_trace__(frame, event, arg):
    global __step_energy__
    if event == 'line' and __energy_on__ and __energy_min_line__ < frame.f_lineno <= __energy_max_line__ and frame.f_code.co_filename == '<exec>':
        __step_energy__ += 1
        mode = __step_mode__(frame.f_lineno)
        if mode == 'yield':
            __run_sync__(__step_yield__())
            mode = __step_mode__(frame.f_lineno)
        if mode == 'free':
            return __step_trace__
        if mode == 'abort':
            raise KeyboardInterrupt
        loc = {}
        for k, v in frame.f_locals.items():
            if (not k.startswith('_') and not callable(v) and k not in __init_globals__
                    and not isinstance(v, type(__sys_trace__))):
                try:
                    loc[k] = __step_repr__(v)
                except Exception:
                    loc[k] = '<?>'
        __step_update__(frame.f_lineno, __json_trace__.dumps(loc), __step_energy__)
        if __run_sync__(__step_wait__()) == 'abort':
            raise KeyboardInterrupt
    return __step_trace__
__sys_trace__.settrace(__step_trace__)
`;

const STEP_GLOBALS = ['__step_update__', '__step_wait__', '__step_mode__', '__step_yield__', '__run_sync__',
                      '__re_trace__', '__default_obj__', '__step_repr__'];

/** JSPI lets Python block on a promise without SharedArrayBuffer. */
const canStep = typeof (WebAssembly as any).Suspending === 'function';

let py: any = null;
let inputResolve: ((value: string) => void) | null = null;
/** 'off' = not stepping; 'wait' = pause before every line; 'free' = run, but yield now and then. */
let stepState: 'off' | 'wait' | 'free' = 'off';
let stepAborted = false;
let stepResolve: ((cmd: string) => void) | null = null;
let stepLastYield = 0;
/** Lines (in the worker's numbering) where a 'free' run stops. */
let stepBreakpoints = new Set<number>();
const STEP_YIELD_MS = 50; // at full speed, check this often for pause/stop messages

function stepBegin(start: 'wait' | 'free' = 'wait', breakpoints: number[] = []) {
    stepState = start;
    stepBreakpoints = new Set(breakpoints);
    stepAborted = false;
    stepLastYield = performance.now();
}

function stepEnd() {
    stepState = 'off';
    stepResolve = null;
}
// Per-editor canvas contexts, keyed by editorId.
const canvasCtxMap = new Map<string, OffscreenCanvasRenderingContext2D>();
// The context currently active (set before each run).
let canvasCtx: OffscreenCanvasRenderingContext2D | null = null;
let stdoutBuffer = '';
let flushTimer: number | null = null;
let currentRunId: number | undefined = undefined;
let syncRun = false;   // true while runPython (blocking) is active
let lastRunEditorId: string | undefined = undefined;
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

/** Write the editor's other file tabs to the FS. Modules imported from them in an
 *  earlier run are evicted from sys.modules so edits take effect. */
function writeExtraFiles(files: { name: string; code: string }[]) {
    const paths: string[] = [];
    for (const f of files) {
        const path = '/home/pyodide/' + f.name;
        try { py.FS.writeFile(path, f.code); paths.push(path); } catch {}
    }
    py.globals.set('__written__', py.toPy(paths));
    py.runPython(`
import sys as __s, importlib as __il
__w = set(__written__)
for __n in [__n for __n, __m in list(__s.modules.items()) if getattr(__m, '__file__', None) in __w]:
    del __s.modules[__n]
__il.invalidate_caches()
for __k in ['__s', '__il', '__w', '__n', '__written__']:
    globals().pop(__k, None)
`, { filename: '<bottom-init>' });
}

/** Text files in a zip (for the editor's file tabs); binaries, folders and hidden files are skipped. */
function listZipTextFiles(ab: ArrayBuffer): { name: string; code: string }[] {
    py.globals.set('__zip_bytes__', py.toPy(new Uint8Array(ab)));
    try {
        const json: string = py.runPython(`
import zipfile as __zf, io as __io, json as __js
__out = []
with __zf.ZipFile(__io.BytesIO(bytes(__zip_bytes__))) as __z:
    for __i in __z.infolist():
        __base = __i.filename.rsplit('/', 1)[-1]
        if __i.is_dir() or __i.filename.startswith('__MACOSX/') or __base.startswith('.') or __i.file_size > 200_000:
            continue
        try:
            __out.append({'name': __i.filename, 'code': __z.read(__i).decode('utf-8')})
        except UnicodeDecodeError:
            pass
__js.dumps(__out)
`, { filename: '<bottom-init>' });
        return JSON.parse(json);
    } finally {
        py.runPython(`for __k in ['__zip_bytes__', '__zf', '__io', '__js', '__out', '__z', '__i', '__base']:\n    globals().pop(__k, None)`);
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
        // Step-through JS globals: called from the Python step trace.
        (self as any)._step_update = (lineNo: number, localsJson: string, energy: number) => {
            flushStdout();
            let locals: Record<string, string> = {};
            try { locals = JSON.parse(localsJson); } catch {}
            post('stepUpdate', { runId: currentRunId, line: lineNo, locals, energy });
        };
        (self as any)._step_mode = (line: number) => {
            if (stepAborted) return 'abort';
            if (stepState === 'free' && stepBreakpoints.has(line)) stepState = 'wait';
            if (stepState !== 'free') return 'wait';
            const now = performance.now();
            if (now - stepLastYield < STEP_YIELD_MS) return 'free';
            stepLastYield = now;
            return 'yield';
        };
        (self as any)._step_yield = () => new Promise(r => setTimeout(r, 0));
        (self as any)._step_wait = () => new Promise<string>(r => { stepResolve = r; });
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
        // Own filename so the trace (which counts '<exec>' lines) skips these shims.
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
`, { filename: '<bottom-init>' });
        await py.runPythonAsync(`\nfrom js import console\n`);
        // Snapshot globals after init so RESET_GLOBALS knows what to preserve.
        await py.runPython(`__init_globals__ = frozenset(globals()) | {'__init_globals__'}`);
        post('ready', { canStep });
    } catch (err: any) {
        console.error('[pyodide-worker] init failed:', err);
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

        if (msg.type === 'setBreakpoints') {
            stepBreakpoints = new Set((msg as any).lines as number[]);
            return;
        }

        if (msg.type === 'stepCommand') {
            const cmd = (msg as any).cmd as 'step' | 'free' | 'pause' | 'abort';
            if (cmd === 'pause') { if (stepState === 'free') stepState = 'wait'; return; }
            if (cmd === 'free') stepState = 'free';
            if (cmd === 'abort') stepAborted = true;
            const resolve = stepResolve;
            stepResolve = null;
            resolve?.(cmd === 'abort' ? 'abort' : 'go');
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
            (self as any)._activeCanvasCtx = canvasCtx;
            // Write any extra files to the virtual FS before running (multi-file support).
            if (msg.extraFiles) writeExtraFiles(msg.extraFiles as { name: string; code: string }[]);
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
            // Same-editor re-run: restore globals to the snapshot from before the
            // last run so stale names/values don't persist. Different editor: just
            // save a new snapshot so this editor's future re-runs reset correctly.
            if (!msg.editorId || msg.editorId === lastRunEditorId) {
                try { py.runPython(SNAPSHOT_RESET); } catch {}
            }
            try { py.runPython(SNAPSHOT_SAVE); } catch {}
            // Reset default turtle state before each run so heading/position don't persist.
            if (py.runPython(`'turtle' in __import__('sys').modules`)) {
                py.runPython(`__import__('sys').modules['turtle']._reset_default()`);
            }
            // Rewrite bare input(...) calls to await input(...) so user code doesn't need to.
            const codeToRun = needsAsync
                ? code.replace(/\binput\s*\(/g, 'await input(')
                : code;
            // Stepping blocks via run_sync, which only works under runPythonAsync.
            const useStepTrace = canStep && !!(msg as any).step;
            syncRun = !needsAsync && !useStepTrace;
            const runFilename: string = (msg as any).filename ?? '<exec>';
            const runCode = needsAsync || useStepTrace
                ? (c: string) => py.runPythonAsync(c, { filename: runFilename })
                : (c: string) => Promise.resolve(py.runPython(c, { filename: runFilename }));
            // The trace slows every line, so only install it when someone reads the count.
            const countEnergy = useStepTrace || !!(msg as any).countEnergy;
            if (useStepTrace) stepBegin((msg as any).stepStart, (msg as any).breakpoints);
            if (countEnergy) {
                try { py.runPython(useStepTrace ? STEP_TRACE_SETUP : ENERGY_TRACE_SETUP); } catch {}
            }
            try {
                try {
                    py.globals.set('__energy_min_line__', (msg as any).lineOffset ?? 0);
                    py.globals.set('__energy_max_line__', codeToRun.split('\n').length);
                    py.globals.set('__energy_on__', true);
                    // Trailing `pass` stops Pyodide from rewriting a final expression
                    // into result-capture code, which emits a spurious line event.
                    try { await runCode(countEnergy ? codeToRun + '\npass' : codeToRun); }
                    finally { py.globals.set('__energy_on__', false); }
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
                    lastRunEditorId = msg.editorId;
                    try { py.runPython(ENERGY_TRACE_TEARDOWN); } catch {}
                    const runEnergy: number = py.globals.get('__step_energy__') ?? 0;
                    try { py.runPython(`for __k in ['__step_energy__','__sys_trace__','__json_trace__','__line_trace__','__step_trace__','__energy_on__','__energy_min_line__','__energy_max_line__',${STEP_GLOBALS.map(n => `'${n}'`).join(',')}]:\n    globals().pop(__k,None)\ndel __k`); } catch {}
                    stepEnd();
                    post('done', { runId, energy: countEnergy ? runEnergy : undefined });
                } catch (err: any) {
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    syncRun = false;
                    currentRunId = undefined;
                    try { py.runPython(ENERGY_TRACE_TEARDOWN); } catch {}
                    stepEnd();
                    const errStr = String(err);
                    const errorMsg = errStr.includes("'await' outside async function")
                        ? "SyntaxError: input() is only supported in top-level code, not inside functions."
                        : errStr;
                    post('error', { runId, error: errorMsg });
                }
            } catch (err: any) {
                if (flushTimer !== null) {
                    (self as any).clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushStdout();
                syncRun = false;
                currentRunId = undefined;
                try { py.runPython(ENERGY_TRACE_TEARDOWN); } catch {}
                stepEnd();
                const errStr = String(err);
                const errorMsg = errStr.includes("'await' outside async function")
                    ? "SyntaxError: input() is only supported in top-level code, not inside functions."
                    : errStr;
                post('error', { runId, error: errorMsg });
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
            (self as any)._activeCanvasCtx = canvasCtx;
            // Write any extra files to the virtual FS before running (multi-file support).
            if (msg.extraFiles) writeExtraFiles(msg.extraFiles as { name: string; code: string }[]);
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
            const useStepTrace = canStep && !!(msg as any).step;
            syncRun = !needsAsync && !useStepTrace;
            const runCode = needsAsync || useStepTrace
                ? (c: string) => py.runPythonAsync(c)
                : (c: string) => Promise.resolve(py.runPython(c));
            try {
                // Same editor re-running: reset to the snapshot taken before its
                // last run (removes its own stale names, keeps other editors' state).
                // Different editor: just save a new snapshot so the next re-run of
                // THIS editor resets to the current shared state.
                if (!msg.editorId || msg.editorId === lastRunEditorId) {
                    try { py.runPython(SNAPSHOT_RESET); } catch {}
                }
                try { py.runPython(SNAPSHOT_SAVE); } catch {}
                // Re-run readyCode (setup/shim) so its definitions are available to tests.
                // Suppress canvas drawing during this re-init: user code will draw
                // the final state anyway, so the setup draw is wasted work.
                if (msg.readyCode) {
                    try { py.runPython(`_kara_drawing_enabled = False`); } catch {}
                    try { await py.runPythonAsync(msg.readyCode, { filename: '<bottom-ready>' }); } catch {}
                    try { py.runPython(`_kara_drawing_enabled = True`); } catch {}
                }
                // Phase 1: run user code with stdout teed to capture buffer
                try { py.runPython(CAPTURE_SETUP, { filename: '<bottom-init>' }); } catch {}
                // Step through the user's code only; tests below run untraced.
                if (useStepTrace) stepBegin((msg as any).stepStart, (msg as any).breakpoints);
                const countEnergy = useStepTrace || !!(msg as any).countEnergy;
                if (countEnergy) {
                    try { py.runPython(useStepTrace ? STEP_TRACE_SETUP : ENERGY_TRACE_SETUP); } catch {}
                }
                try {
                    py.globals.set('__energy_min_line__', (msg as any).lineOffset ?? 0);
                    py.globals.set('__energy_max_line__', codeToRun.split('\n').length);
                    py.globals.set('__energy_on__', true);
                    // Trailing `pass` stops Pyodide from rewriting a final expression
                    // into result-capture code, which emits a spurious line event.
                    try { await runCode(countEnergy ? codeToRun + '\npass' : codeToRun); }
                    finally {
                        py.globals.set('__energy_on__', false);
                        if (useStepTrace) {
                            stepEnd();
                            post('stepDone', { runId });
                        }
                    }
                    await py.runPythonAsync('import canvas_shim; canvas_shim.apply_pending()');
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    syncRun = false;
                    try { py.runPython(ENERGY_TRACE_TEARDOWN); } catch {}
                } catch (userErr: any) {
                    // User code failed — restore stdout then re-throw so tests are skipped
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    syncRun = false;
                    try { py.runPython(ENERGY_TRACE_TEARDOWN); } catch {}
                    try { py.runPython(CAPTURE_RESTORE); } catch {}
                    const userErrStr = String(userErr);
                    throw userErrStr.includes("'await' outside async function")
                        ? "SyntaxError: input() is only supported in top-level code, not inside functions."
                        : userErr;
                }

                // Phase 2: inject output + energy + memory helpers, then run test harness
                try { py.runPython(CAPTURE_INJECT); } catch {}
                try {
                    py.globals.set('__test_source__', msg.tests || '');
                    py.globals.set('__user_code__', codeToRun);
                    const resultJson = await py.runPythonAsync(TEST_HARNESS);
                    const testResults = JSON.parse(resultJson);
                    const testEnergy: number = py.globals.get('__energy_val__') ?? py.globals.get('__step_energy__') ?? 0;
                    currentRunId = undefined;
                    lastRunEditorId = msg.editorId;
                    post('testResults', { runId, results: { ...testResults, energy: countEnergy ? testEnergy : undefined } });
                } catch (harnessErr: any) {
                    currentRunId = undefined;
                    lastRunEditorId = msg.editorId;
                    post('testResults', { runId, results: {
                        passed: false,
                        results: [{ passed: false, test: '<harness error>', message: String(harnessErr) }]
                    }});
                } finally {
                    try { py.runPython(`
for __k in ['__test_source__', '__user_code__', '__run_tests__', '__captured_output__',
            '__energy_val__', '__step_energy__', '__sys_trace__', '__json_trace__',
            '__line_trace__', '__step_trace__', '__energy_on__', '__energy_min_line__', '__energy_max_line__',
            ${STEP_GLOBALS.map(n => `'${n}'`).join(', ')},
            'output', 'output_lines', 'with_input', 'energy', 'memory']:
    try: del globals()[__k]
    except: pass
del __k
`); } catch {}
                }
            } catch (err: any) {
                // User code failed — tests skipped, error already flushed above
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
                post('zipLoaded', { url, files: [] });
                return;
            }
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('Failed to fetch zip: ' + resp.status);
                const ab = await resp.arrayBuffer();
                await py.unpackArchive(ab, 'zip');
                post('log', { data: 'Zip unpacked' });
                post('zipLoaded', { url, files: listZipTextFiles(ab) });
            } catch (e) {
                post('error', { error: String(e) });
                post('zipLoaded', { url, files: [] });
            }
            return;
        }

    } catch (e: any) {
        post('error', { error: String(e) });
    }
};

//export {};
