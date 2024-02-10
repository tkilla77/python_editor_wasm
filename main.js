// find the output element
const output = document.getElementById("output");
// initializing the codemirror and pass configuration to support python and dracula theme
const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
              mode: {
                  name: "python",
                  version: 3,
                  singleLineStringErrors: false,
              },
              theme: "eclipse",
              lineNumbers: true,
              indentUnit: 4,
              matchBrackets: true,
            });
output.value = "Initializing...\n";

// Add pyodide returned value to the output
function addToOutput(stdout) {
  output.value += stdout;
}

// Clean the output section
function clearHistory() {
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
  addToOutput("Python Ready!");
  return pyodide;
}

// run the main function
preInit();
let pyodideReadyPromise = main();
init();

/** Loads data files available from the working directory of the code. */
async function installFilesFromZip(url) {
  let pyodide = await pyodideReadyPromise;
  let zipResponse = await fetch(url);
  let zipBinary = await zipResponse.arrayBuffer();
  await pyodide.unpackArchive(zipBinary, "zip");
  console.log(`Loaded files from '${url}!`)
}

/** Loads single files available as imports. */
async function installFileFromUri(url) {
  let filename = url.split('/').pop();
  let pyodide = await pyodideReadyPromise;
  await pyodide.runPythonAsync(`
    from pyodide.http import pyfetch
    response = await pyfetch("${url}")

    with open("${filename}", "wb") as f:
      f.write(await response.bytes())
  `);
  console.log(`Loaded files from '${url}!`)
}


/** Returns the containing page (if accessible) or iframe's search params. */
function getParams() {
  const uri = new URL((window.location != window.parent.location)
      ? document.referrer
      : document.location.href);
  return uri.searchParams;
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
  const params = getParams();
  for (let fileUri of params.getAll('zip')) {
    try {
      await installFilesFromZip(fileUri);
    } catch (err) {
      addToOutput(`Unable to load ${fileUri}: ${err}`);
    }
  }
  for (let fileUri of params.getAll('file')) {
    try {
      await installFileFromUri(fileUri);
    } catch (err) {
      addToOutput(`Unable to load ${fileUri}: ${err}`);
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
    code = code.replaceAll('\t', '    ');
    editor.setValue(code);
    let result = pyodide.runPython(code);
    let stdout = pyodide.runPython("sys.stdout.getvalue()");
    addToOutput(stdout);
  } catch (err) {
    addToOutput(err);
  }
}

async function copyPermalink() {
  const code = editor.getValue();
  const encoded = encodeURIComponent(code);
  let url = new URL(document.location.href);
  url.searchParams.set('code', code);
  navigator.clipboard.writeText(url.href);
}