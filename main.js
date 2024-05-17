// find the output element
const output = document.getElementById("output");
// initializing the codemirror and pass configuration to support python and dracula theme
function indent(cm) {
  if (cm.somethingSelected()) {
    cm.indentSelection("add");
  } else {
    cm.replaceSelection(cm.getOption("indentWithTabs")? "\t":
      Array(cm.getOption("indentUnit") + 1).join(" "), "end", "+input");
  }
}
function unindent(cm) {
  cm.indentSelection("subtract");
}
function run(cm) {
  evaluatePython();
}

const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
              mode: {
                  name: "python",
                  version: 3,
                  singleLineStringErrors: false,
              },
              theme: "eclipse",
              lineNumbers: true,
              indentUnit: 4,
              tabSize: 4,
              matchBrackets: true,
              extraKeys: {
                Tab: indent,
                'Shift-Tab': unindent,
                'Ctrl-Enter': run,
              },
            });

output.value = "Initializing...\n";

// Add pyodide returned value to the output
function addToOutput(stdout) {
  output.value += stdout;
}

// Add information to the log
function addToLog(s) {
  // for now, put log and program output into the same area
  addToOutput(s);
}

// Clean the output section
async function clearHistory() {
  output.value = "";
}


// init Pyodide and show sys.version when it's loaded successfully
async function main() {
  let pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
  });
  pyodide.runPython(`
      import sys
      sys.version
      
  `);
  clearHistory();
  addToOutput("Python Ready!\n");
  return pyodide;
}

// run the main function
preInit();
let pyodideReadyPromise = main();
init();

/** Loads data files available from the working directory of the code. */
async function installFilesFromZip(url) {
  let pyodide = await pyodideReadyPromise;
  addToLog(`Loading ${url}... `)
  let zipResponse = await fetch(url);
  if (zipResponse.ok) {
    let zipBinary = await zipResponse.arrayBuffer();
    await pyodide.unpackArchive(zipBinary, "zip");
    addToLog(`Done!\n`);
  } else {
    addToLog('Failed!\n');
  }
}

/** Loads single files available as imports. */
async function installFileFromUri(url) {
  let filename = url.split('/').pop();
  let pyodide = await pyodideReadyPromise;

  addToLog(`Loading ${url}... `)
  await pyodide.runPythonAsync(`
    from pyodide.http import pyfetch
    response = await pyfetch("${url}")

    with open("${filename}", "wb") as f:
      f.write(await response.bytes())
  `);
  addToLog(`Done!\n`)
}


/** Returns the containing page (if accessible) or iframe's search params. */
function getUrl() {
  let uri = new URL(document.location.href);
  if (uri.searchParams.size == 0 && window.location != window.parent.location) {
    // Attempt to read URL params from containing page.
    uri = new URL(document.referrer);
  }
  return uri;
}
function getParams() {
  return getUrl().searchParams;
}

// Runs initialization before pyodide initialization
async function preInit() {
  const params = getParams();
  if (params.has('code')) {
    // Set editor contents and clear URL params.
    const code = params.get('code');
    editor.setValue(code);
    let url = new URL(document.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.href);
  } else {
    editor.setValue("print('Hello, world!')");
  }
}

// Runs initialization after pyodide initialization
async function init() {
  // run everything sequentially...
  const params = getParams();
  for (let fileUri of params.getAll('zip')) {
    try {
      await installFilesFromZip(fileUri);
    } catch (err) {
      addToLog(`Unable to load ${fileUri}: ${err}\n`);
    }
  }
  for (let fileUri of params.getAll('file')) {
    try {
      await installFileFromUri(fileUri);
    } catch (err) {
      addToLog(`Unable to load ${fileUri}: ${err}\n`);
    }
  }

  if (params.has('autorun')) {
    evaluatePython();
  }
}

// pass the editor value to the pyodide.runPython function and show the result in the output section
async function evaluatePython() {
  let pyodide = await pyodideReadyPromise;
  clearHistory();
  try {
    pyodide.runPython(`
      import io
      sys.stdout = io.StringIO()
      `);
    let code = editor.getValue();
    let result = pyodide.runPython(code);
    let stdout = pyodide.runPython("sys.stdout.getvalue()");
    addToOutput(stdout);
  } catch (err) {
    // Drop uninteresting output from runPython
    err = err.toString();
    let debug_idx = err.indexOf('  File "<exec>"');
    if (debug_idx > 0) {
      err = err.substring(debug_idx);
    }
    addToOutput(err);
  }
}

function getPermaUrl() {
  let uri = new URL(document.location.href);
  if (uri.pathname.endsWith("embed.html")) {
    uri.pathname = uri.pathname.replace("/embed.html", "");
  }
  return uri;
}

async function copyPermalink() {
  const code = editor.getValue();
  const encoded = encodeURIComponent(code);
  let url = getPermaUrl();
  url.searchParams.set('code', code);
  navigator.clipboard.writeText(url.href);
}