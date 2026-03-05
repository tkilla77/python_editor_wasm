import { loadPyodide } from 'pyodide';

type Msg = {
    type: string,
    indexURL?: string,
    code?: string,
    runId?: number,
    url?: string,
    canvas?: OffscreenCanvas,
    interruptBuffer?: any,
}

let py: any = null;
let stdoutBuffer = '';
let flushTimer: number | null = null;
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
    post('stdout', { data });
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

async function init(indexURL?: string) {
    try {
        py = await loadPyodide({ indexURL: indexURL || 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full' });
        py.setStdout({
            write: (buf: Uint8Array) => {
                const text = new TextDecoder().decode(buf);
                // accumulate in buffer and schedule periodic flush to avoid UI thrash
                stdoutBuffer += text;
                scheduleFlush();
                return buf.length;
            }
        });
        await py.loadPackage('micropip');
        // replace input with a stub that posts back — main thread can implement if desired
        await py.runPythonAsync(`\nfrom js import console\n`);
        post('ready');
    } catch (err: any) {
        post('error', { error: String(err) });
    }
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
    const msg = ev.data;
    try {
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
            await init(msg.indexURL);
            return;
        }

        if (msg.type === 'setCanvas' && py && msg.canvas) {
            try {
                // py.canvas is provided by pyodide; set a 2D canvas if available
                py.canvas.setCanvas2D(msg.canvas);
                post('log', { data: 'Canvas attached' });
            } catch (e) {
                post('log', { data: 'Canvas attach failed: ' + String(e) });
            }
            return;
        }

        if (msg.type === 'run') {
            if (!py) {
                post('error', { runId: msg.runId, error: 'Pyodide not initialized' });
                return;
            }
            const runId = msg.runId;
            try {
                try {
                    await py.runPythonAsync(msg.code || '');
                    // ensure all buffered stdout is flushed before signaling done
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    post('done', { runId });
                } catch (err: any) {
                    if (flushTimer !== null) {
                        (self as any).clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    flushStdout();
                    post('error', { runId, error: String(err) });
                }
            } catch (err: any) {
                if (flushTimer !== null) {
                    (self as any).clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushStdout();
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

export {};
