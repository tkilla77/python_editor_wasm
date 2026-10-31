import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './editor.js'
import type { FileSpec } from './editor.js'
import { readFileTemplates, mergeFiles } from './file-templates.js'
import karaShimSrc from './kara-shim.py?raw'

// Minimal container — needs a name so the browser treats it as a block element
// and `querySelector('kara-world')` resolves it correctly.
if (!customElements.get('kara-world')) {
    customElements.define('kara-world', class extends HTMLElement {});
}

import { dedentWorld } from './kara-world.js'

const DEFAULT_WORLD = `
###########
#.........#
#....>....#
#.........#
###########
`.trim();

const PERMALINK_BASE = 'https://bottom.ch/editor/stable/kara.html';

@customElement('kara-editor')
export class KaraEditor extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };

    /** Animation step delay in milliseconds (0 = instant). */
    @property({ type: Number }) step      = 200;
    @property({ type: Boolean }) autorun  = false;
    @property({ type: Boolean }) showclear = false;
    @property() timeout                   = '30';
    @property() storage                   = '';
    @property({ type: Boolean }) stepmode   = false;
    @property({ type: Boolean }) showenergy = false;
    @property({ type: Boolean }) nodebug    = false;
    /** Show file tabs even without <template filename> children. */
    @property({ type: Boolean }) multifile  = false;
    /** Tab name of the main file in multi-file mode. */
    @property() mainfile                    = '';
    /** Current contents of extra files (from a permalink), overriding the templates. */
    @property({ attribute: false }) files: FileSpec[] = [];

    // Each instance gets its own isolated Pyodide runtime.
    private readonly _sessionId = `kara-${crypto.randomUUID()}`;

    private _worldStr = DEFAULT_WORLD;
    private _userCode = '';
    private _fileTemplates: { name: string; code: string }[] = [];
    private _editorFiles?: FileSpec[];

    connectedCallback() {
        super.connectedCallback();
        this._parse();
    }

    private _parse() {
        const worldEl = this.querySelector('kara-world');
        if (worldEl) {
            if (worldEl.children.length > 0) {
                console.warn(
                    'kara-world: unexpected child elements detected — the world text likely ' +
                    'contains an unescaped < character. Use &lt; for Kara facing left in HTML.'
                );
            }
            this._worldStr = dedentWorld(worldEl.textContent ?? '') || DEFAULT_WORLD;
        }

        // User code = direct text-node children (outside <kara-world>).
        // Guard: don't overwrite a value already set programmatically (e.g. via
        // Lit's .code binding, which fires before connectedCallback).
        const domCode = Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent ?? '')
            .join('')
            .replace(/^\s*\n/, '');
        if (domCode.trim()) this._userCode = domCode;
        this._fileTemplates = readFileTemplates(this);
    }

    /** Files for the inner editor ([] = single file). Computed once: a new array would reset its tabs. */
    private _filesForEditor(): FileSpec[] {
        if (this._editorFiles) return this._editorFiles;
        if (!this.multifile && this._fileTemplates.length === 0 && this.files.length === 0) {
            return this._editorFiles = [];
        }
        return this._editorFiles = [
            { name: this.mainfile || 'main.py', code: this._userCode },
            ...mergeFiles(this._fileTemplates, this.files),
        ];
    }

    /** Set world programmatically (overrides <kara-world> child). */
    set world(w: string) { if (w) { this._worldStr = w; this.requestUpdate(); } }
    get world()          { return this._worldStr; }

    /** Set user code programmatically (overrides text-node children). */
    set code(c: string)  { if (c) { this._userCode = c; this.requestUpdate(); } }
    get code()           { return this._userCode; }

    private get _prefix(): string {
        const world = this._worldStr.replace(/"""/g, "'''");
        return karaShimSrc + `\n_kara_setup("""${world}""", ${this.step})\n`;
    }

    private get _prefixLineCount(): number {
        return (this._prefix.match(/\n/g) ?? []).length;
    }

    // Stable reference — Lit won't diff-update bottom-editor on every render.
    private readonly _transform = (editorCode: string): string => {
        return this._prefix + editorCode;
    };

    private get _readyCode(): string {
        return this._prefix;
    }

    private readonly _permalink = async () => {
        const url = new URL(PERMALINK_BASE);
        url.searchParams.set('world', this._worldStr);
        // Read live editor content rather than the stale initial value.
        const editor = this.renderRoot?.querySelector('bottom-editor') as any;
        const currentCode = editor?.sourceCode ?? this._userCode;
        if (currentCode.trim()) url.searchParams.set('code', currentCode);
        const extra = (editor?.sharedFiles() ?? []).slice(1);
        if (extra.length) url.searchParams.set('files', JSON.stringify(extra));
        if (this.multifile) url.searchParams.set('multifile', '1');
        if (this.mainfile)  url.searchParams.set('mainfile', this.mainfile);
        if (this.step !== 200)    url.searchParams.set('step', String(this.step));
        if (this.timeout !== '30') url.searchParams.set('timeout', this.timeout);
        if (this.stepmode)   url.searchParams.set('stepmode', '1');
        if (this.showenergy) url.searchParams.set('showenergy', '1');
        if (this.nodebug)    url.searchParams.set('nodebug', '1');
        await navigator.clipboard.writeText(url.href);
        return url.href;
    };

    render() {
        return html`
            <bottom-editor
                layout="split"
                .sourceCode=${this._userCode}
                .transformCode=${this._transform}
                .asyncRun=${true}
                .transformLineOffset=${this._prefixLineCount}
                .readyCode=${this._readyCode}
                .permalinkCallback=${this._permalink}
                ?autorun=${this.autorun}
                ?autofit=${true}
                session=${this._sessionId}
                timeout=${this.timeout}
                id=${this.id || nothing}
                storage=${this.storage || nothing}
                ?showrevert=${this.showclear}
                ?stepmode=${this.stepmode}
                ?showenergy=${this.showenergy}
                ?nodebug=${this.nodebug}
                ?multifile=${this.multifile}
                mainfile=${this.mainfile || nothing}
                .files=${this._filesForEditor()}
            ></bottom-editor>`;
    }

    static styles = css`
        :host { display: block; }
        bottom-editor {
            max-height: initial;
            --be-output-row: calc(2lh + 1em + 4px);
            --be-output-min-height: calc(2lh + 1em + 4px);
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        'kara-editor': KaraEditor
    }
}
