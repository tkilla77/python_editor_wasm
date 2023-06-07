// find the output element
const output = document.getElementById("output");
// initializing the codemirror and pass configuration to support python and dracula theme
const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
              mode: {
                  name: "python",
                  version: 3,
                  singleLineStringErrors: false,
              },
              theme: "dracula",
              lineNumbers: true,
              indentUnit: 4,
              matchBrackets: true,
            });
output.value = "Initializing...\n";

// Add pyodide returned value to the output
function addToOutput(stdout) {
  output.value = stdout;
}

// Clean the output section
function clearHistory() {
  output.value = "";
}


// init Pyodide and show sys.version when it's loaded successfully
async function main() {
  let pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.2/full/",
  });
  pyodide.runPython(`
      import sys
      sys.version
  `);
  addToOutput("Python Ready !");
  return pyodide;
}

// run the main function
preInit();
let pyodideReadyPromise = main();
init();

async function installFilesFromZip(url) {
  let pyodide = await pyodideReadyPromise;
  let zipResponse = await fetch(url);
  let zipBinary = await zipResponse.arrayBuffer();
  await pyodide.unpackArchive(zipBinary, "zip");
  console.log("files written!")
}

// Runs initialization before pyodide initialization
async function preInit() {
  const queryString = window.location.search;
  const params = new URLSearchParams(queryString);
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
  await installFilesFromZip('files/2m.zip');
  evaluatePython();
}

// pass the editor value to the pyodide.runPython function and show the result in the output section
async function evaluatePython() {
  let pyodide = await pyodideReadyPromise;
  try {
    pyodide.runPython(`
      import io
      sys.stdout = io.StringIO()
      `);
    let code = editor.getValue();
    code = code.replace('\t', '    ');
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