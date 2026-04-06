import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './editor.js'
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
    @property({ type: Number }) step     = 200;
    @property({ type: Boolean }) autorun = false;
    @property() timeout                  = '30';

    // Each instance gets its own isolated Pyodide runtime.
    private readonly _sessionId = `kara-${crypto.randomUUID()}`;

    private _worldStr = DEFAULT_WORLD;
    private _userCode = '';

    connectedCallback() {
        super.connectedCallback();
        this._parse();
    }

    private _parse() {
        const worldEl = this.querySelector('kara-world');
        if (worldEl) {
            this._worldStr = dedentWorld(worldEl.textContent ?? '') || DEFAULT_WORLD;
        }

        // User code = direct text-node children (outside <kara-world>).
        this._userCode = Array.from(this.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent ?? '')
            .join('')
            .replace(/^\s*\n/, '');
    }

    /** Set world programmatically (overrides <kara-world> child). */
    set world(w: string) { this._worldStr = w; }
    get world()          { return this._worldStr; }

    /** Set user code programmatically (overrides text-node children). */
    set code(c: string)  { this._userCode = c; }
    get code()           { return this._userCode; }

    // Stable reference — Lit won't diff-update bottom-editor on every render.
    private readonly _transform = (editorCode: string): string => {
        const world = this._worldStr.replace(/"""/g, "'''");
        const prefix = karaShimSrc + `\n_kara_setup("""${world}""", ${this.step})\n`;
        // Auto-insert `await` before kara action calls so novices don't need it.
        const userCode = editorCode.replace(
            /\b(kara\.(move|turnLeft|turnRight|putLeaf|removeLeaf))\s*\(/g,
            'await $1('
        );
        return prefix + userCode;
    };

    private get _readyCode(): string {
        const world = this._worldStr.replace(/"""/g, "'''");
        return karaShimSrc + `\n_kara_setup("""${world}""", ${this.step})\n`;
    }

    private readonly _permalink = () => {
        const url = new URL(PERMALINK_BASE);
        url.searchParams.set('world', this._worldStr);
        if (this._userCode.trim()) url.searchParams.set('code', this._userCode);
        if (this.step !== 200)    url.searchParams.set('step', String(this.step));
        if (this.timeout !== '30') url.searchParams.set('timeout', this.timeout);
        navigator.clipboard.writeText(url.href);
    };

    render() {
        return html`
            <bottom-editor
                layout="split"
                .sourceCode=${this._userCode}
                .transformCode=${this._transform}
                .readyCode=${this._readyCode}
                .permalinkCallback=${this._permalink}
                ?autorun=${this.autorun}
                ?autofit=${true}
                session=${this._sessionId}
                timeout=${this.timeout}
                showclear
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
