import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './editor.js'

type Layout = 'console' | 'canvas' | 'split';

@customElement('bottom-editor-page')
class BottomEditorPage extends LitElement {
    static shadowRootOptions = {...LitElement.shadowRootOptions, mode: "closed" as const};

    private sourceCode : string = '';
    private autoRun: boolean = false;
    private zipUrl: string = '';

    @state() private showCanvas  = false;
    @state() private showConsole = true;

    private get layout(): Layout {
        if (this.showCanvas && this.showConsole) return 'split';
        if (this.showCanvas) return 'canvas';
        return 'console';
    }

    constructor() {
        super();
        const params = this.getParams();
        if (params.has('code')) {
            const code = params.get('code');
            if (code) this.sourceCode = code;
            const url = new URL(document.location.href);
            url.searchParams.delete('code');
            window.history.replaceState({}, '', url.href);
        }
        if (params.has('autorun')) {
            const autorun = params.get('autorun');
            this.autoRun = !(autorun === 'false' || autorun === '0');
            const url = new URL(document.location.href);
            url.searchParams.delete('autorun');
            window.history.replaceState({}, '', url.href);
        }
        if (params.has('zip')) {
            this.zipUrl = params.get('zip') ?? '';
        }
        if (params.has('layout')) {
            const l = params.get('layout') as Layout;
            if (l === 'canvas') { this.showCanvas = true;  this.showConsole = false; }
            if (l === 'split')  { this.showCanvas = true;  this.showConsole = true;  }
        }
    }

    private getUrl() {
        const uri = new URL(document.location.href);
        if (uri.searchParams.size === 0 && window.location !== window.parent.location) {
            return new URL(document.referrer);
        }
        return uri;
    }

    private getParams() {
        return this.getUrl().searchParams;
    }

    private _toggleCanvas() {
        // Never collapse both — toggling the only visible panel opens the other instead.
        if (this.showCanvas && !this.showConsole) { this.showConsole = true; return; }
        this.showCanvas = !this.showCanvas;
    }

    private _toggleConsole() {
        if (this.showConsole && !this.showCanvas) { this.showCanvas = true; return; }
        this.showConsole = !this.showConsole;
    }

    render() {
        const canvasOpen  = this.showCanvas;
        const consoleOpen = this.showConsole;
        return html`
            <bottom-editor
                exportparts="buttons"
                .sourceCode=${this.sourceCode}
                ?autorun=${this.autoRun}
                zip='${this.zipUrl}'
                layout='${this.layout}'
                showclear
            ></bottom-editor>
            <aside>
                <div class="panel ${canvasOpen ? 'open' : 'closed'}"
                     title="${canvasOpen ? 'Collapse canvas' : 'Show canvas'}"
                     @click=${this._toggleCanvas}>
                    <span>Canvas</span>
                </div>
                <div class="panel ${consoleOpen ? 'open' : 'closed'}"
                     title="${consoleOpen ? 'Collapse console' : 'Show console'}"
                     @click=${this._toggleConsole}>
                    <span>Console</span>
                </div>
            </aside>`;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: row;
            flex: 1;
            min-height: 0;
        }
        bottom-editor {
            max-height: initial;
            flex: 1;
            min-width: 0;
            min-height: 0;
            container-type: inline-size;
        }
        @container (min-width: 768px) {
            bottom-editor::part(buttons) {
                flex-direction: column;
            }
        }
        aside {
            display: flex;
            flex-direction: column;
            width: 1.4em;
            gap: 2px;
            padding-block: 2px;
            background: #f1f5f9;
            border-left: 1px solid #e2e8f0;
            flex-shrink: 0;
        }
        .panel {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 0 0.3em 0.3em 0;
            transition: background 0.15s, flex 0.2s;
            overflow: hidden;
            min-height: 0;
            user-select: none;
        }
        .panel.open {
            flex: 1;
            background: #e2e8f0;
        }
        .panel.closed {
            flex: 0 0 1.2em;
            background: #cbd5e1;
        }
        .panel:hover {
            background: #94a3b8;
        }
        .panel span {
            writing-mode: vertical-lr;
            font-size: 0.65em;
            font-family: system-ui;
            font-weight: 600;
            color: #475569;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            rotate: 180deg;
        }
        .panel.closed span {
            font-size: 0.55em;
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor-page': BottomEditorPage
    }
}
