import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './editor.js'

const LAYOUTS = ['console', 'canvas', 'split'] as const;
type Layout = typeof LAYOUTS[number];

@customElement('bottom-editor-page')
class BottomEditorPage extends LitElement {
    static shadowRootOptions = {...LitElement.shadowRootOptions, mode: "closed" as const};

    private sourceCode : string = '';
    private autoRun: boolean = false;
    private zipUrl: string = '';
    @state() private layout: Layout = 'console';

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
            if (LAYOUTS.includes(l)) this.layout = l;
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

    private _setLayout(l: Layout) {
        this.layout = l;
    }

    render() {
        return html`
            <nav>
                ${LAYOUTS.map(l => html`
                    <button ?active=${this.layout === l} @click=${() => this._setLayout(l)}>
                        ${l}
                    </button>`)}
            </nav>
            <bottom-editor exportparts="buttons" .sourceCode=${this.sourceCode} ?autorun=${this.autoRun} zip='${this.zipUrl}' layout='${this.layout}'></bottom-editor>`;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
        }
        nav {
            display: flex;
            gap: 0.3em;
            padding: 0.3em 0.3em 0;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }
        nav button {
            padding: 0.2em 0.7em;
            border: 1px solid #cbd5e1;
            border-bottom: none;
            border-radius: 0.3em 0.3em 0 0;
            background: #f1f5f9;
            color: #475569;
            font-size: 0.8em;
            cursor: pointer;
        }
        nav button[active] {
            background: white;
            color: #0f172a;
            font-weight: 600;
            border-color: #94a3b8;
        }
        bottom-editor {
            max-height: initial;
            flex: 1;
            min-height: 0;
            container-type: inline-size;
        }
        @container (min-width: 768px) {
            bottom-editor::part(buttons) {
                flex-direction: column;
            }
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor-page': BottomEditorPage
    }
}
