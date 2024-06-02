const pyodideWorker = new Worker(new URL('./pyodide_ww.ts', import.meta.url), {
  type: 'module'
});

// Copied  from https://pyodide.org/en/stable/usage/webworker.html
type Callback = (...args: any) => void;
const callbacks : { [key: number]: Callback; }  = {};
const writers : { [key: number]: Callback; }  = {};

pyodideWorker.onmessage = (event) => {
  const { id, ...data } = event.data;
  if (data.output) {
    const writer = writers[id];
    writer(data.output)
  } else {
    const onSuccess = callbacks[id];
    delete callbacks[id];
    delete writers[id];
    onSuccess(data);
  }
};

let id = 0; // identify a Promise
export function asyncRun(script: string, context: any, write: Callback) {
  // the id could be generated more carefully
  id = (id + 1) % Number.MAX_SAFE_INTEGER;
  return new Promise((onSuccess) => {
    writers[id] = write;
    callbacks[id] = onSuccess;
    pyodideWorker.postMessage({
      ...context,
      python: script,
      id,
    });
  });
}
