import { loadPyodide } from 'pyodide';


// Copied from https://pyodide.org/en/stable/usage/webworker.html
async function loadPyodideAndPackages() {
    let py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full' });
    py.setStdin({ stdin: () => prompt() });
    await py.loadPackage("micropip");

    self.pyodide = py
}
let pyodideReadyPromise = loadPyodideAndPackages();

async function evaluate(data) {
    // make sure loading is done
    await pyodideReadyPromise;
    // Don't bother yet with this line, suppose our API is built in such a way:
    const { id, python, ...context } = data;
    // The worker copies the context in its own "memory" (an object mapping name to values)
    for (const key of Object.keys(context)) {
        self[key] = context[key];
    }

    // Set up the write handler
    self.pyodide.setStdout({
        /* Implements the WriteHandler interface for pyodide.setStdout(). */
        write(buffer: Uint8Array) {
            let text = new TextDecoder().decode(buffer);
            self.postMessage({ output: text, id });
            return buffer.length;
        }
    });

    // Now is the easy part, the one that is similar to working in the main thread:
    try {
        await self.pyodide.loadPackagesFromImports(python);
        let results = await self.pyodide.runPythonAsync(python);
        self.postMessage({ results, id });
    } catch (error) {
        self.postMessage({ error: error.message, id });
    }
}
async function setInterruptBuffer(data) {
    await pyodideReadyPromise;
    self.pyodide.setInterruptBuffer(data.interruptBuffer)
}

/** Loads data files available from the working directory of the code. */
async function installFilesFromZip(url: string) {
    await pyodideReadyPromise;
    let zipResponse = await fetch(url);
    if (zipResponse.ok) {
        let zipBinary = await zipResponse.arrayBuffer();
        await self.pyodide.unpackArchive(zipBinary, "zip");
    } else {
        // TODO log
    }
}

self.onmessage = async (event) => {
    if (event.data.cmd == "evaluate") {
        evaluate(event.data);
    } else if (event.data.cmd == "setInterruptBuffer") {
        setInterruptBuffer(event.data);
    } else if (event.data.cmd == "installFiles") {
        installFilesFromZip(event.data);
    }
};