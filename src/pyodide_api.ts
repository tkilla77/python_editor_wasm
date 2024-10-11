import { v4 as uuidv4 } from 'uuid';

const pyodideWorker = new Worker(new URL('./pyodide_ww.ts', import.meta.url), {
  type: 'module'
});

// Copied  from https://pyodide.org/en/stable/usage/webworker.html
type Callback = (...args: any) => void;
class Execution {
  onSuccess?: Callback;
  onError?: Callback;
  writer: Callback;
  id: string;

  constructor(writer: Callback) {
    this.id = uuidv4();
    this.writer = writer;
  }

  start(script: string) {
    return new Promise((onSuccess, onError) => {
      this.onSuccess = onSuccess;
      this.onError = onError;
      pyodideWorker.postMessage({
        python: script,
        cmd: "evaluate",
        id: this.id,
      });
    });
  }
}
const executions : { [key: string]: Execution; }  = {}; 

pyodideWorker.onmessage = (event) => {
  const { id, ...data } = event.data;
  if (data.output) {
    executions[id].writer(data.output);
  } else if (data.error) {
    const execution = executions[id];
    delete executions[id];
    if (execution.onError) {
      execution.onError(data.error);
    }
  } else {
    const execution = executions[id];
    delete executions[id];
    if (execution.onSuccess) {
      execution.onSuccess(data);
    }
  }
};

let interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
pyodideWorker.postMessage({ cmd: "setInterruptBuffer", interruptBuffer });
export function interrupt() {
  // 2 stands for SIGINT.
  interruptBuffer[0] = 2;
}

export function installFiles(url: string) {
  pyodideWorker.postMessage({ cmd: "installFiles", url });
}

export function asyncRun(script: string, write: Callback) {
  // reset interrupt to "run things"
  interruptBuffer[0] = 0;
  const execution = new Execution(write);
  executions[execution.id] = execution;
  return execution.start(script);
}
