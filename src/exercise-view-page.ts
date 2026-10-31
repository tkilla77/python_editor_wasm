import './exercise.js'; // registers <bottom-exercise>
import type { BottomExercise } from './exercise.js';
import { decodeExercise, sanitizeHtml } from './exercise-permalink.js';

async function main() {
    const param = new URLSearchParams(location.search).get('x');
    if (!param) { showError(); return; }

    try {
        const state = await decodeExercise(param);
        const ex = document.createElement('bottom-exercise') as BottomExercise;

        // Attributes forwarded from permalink state
        if (state.layout)      ex.setAttribute('layout',      state.layout);
        if (state.zip)         ex.setAttribute('zip',         state.zip);
        if (state.timeout)     ex.setAttribute('timeout',     state.timeout);
        if (state.showswitcher) ex.setAttribute('showswitcher', '');
        if (state.multifile)    ex.setAttribute('multifile', '');
        if (state.mainfile)     ex.setAttribute('mainfile', state.mainfile);
        if (state.files?.length) {
            // Authored files become templates (their original text is the Revert target);
            // the current contents, including user-added files, override them.
            for (const f of state.files) {
                if (f.initial === null) continue;
                const t = document.createElement('template');
                t.setAttribute('filename', f.name);
                t.content.textContent = f.initial ?? f.code;
                ex.appendChild(t);
            }
            ex.files = state.files;
        }
        if (state.stepmode)     ex.setAttribute('stepmode', '');
        if (state.showenergy)   ex.setAttribute('showenergy', '');
        if (state.nodebug)      ex.setAttribute('nodebug', '');
        if (state.maxenergy)    ex.setAttribute('maxenergy', String(state.maxenergy));
        if (state.maxmemory)    ex.setAttribute('maxmemory', String(state.maxmemory));
        // Student's code (may differ from starter; becomes initial editor content)
        if (state.code) ex.code = state.code;

        // Prompt HTML — sanitized before injection
        if (state.prompt) {
            const div = document.createElement('div');
            div.slot = 'prompt';
            div.innerHTML = sanitizeHtml(state.prompt);
            ex.appendChild(div);
            const heading = div.querySelector('h1,h2,h3');
            if (heading?.textContent) document.title = heading.textContent.trim();
        }

        // Starter code (used as Reset target)
        if (state.starter) {
            const t = document.createElement('template') as HTMLTemplateElement;
            t.dataset.type = 'starter';
            t.content.textContent = state.starter;
            ex.appendChild(t);
        }

        // Test assertions
        if (state.tests) {
            const t = document.createElement('template') as HTMLTemplateElement;
            t.dataset.type = 'test';
            t.content.textContent = state.tests;
            ex.appendChild(t);
        }

        // Solutions: the main file's, then one per extra file
        if (state.solution) {
            const t = document.createElement('template') as HTMLTemplateElement;
            t.dataset.type = 'solution';
            t.content.textContent = state.solution;
            ex.appendChild(t);
        }
        for (const f of state.solutions ?? []) {
            const t = document.createElement('template') as HTMLTemplateElement;
            t.dataset.type = 'solution';
            t.setAttribute('filename', f.name);
            t.content.textContent = f.code;
            ex.appendChild(t);
        }

        document.getElementById('container')!.appendChild(ex);
    } catch (err) {
        console.error('Exercise permalink decode failed:', err);
        showError();
    }
}

function showError() {
    (document.getElementById('error') as HTMLElement).hidden = false;
}

main();
