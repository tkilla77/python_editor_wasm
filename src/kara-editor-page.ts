import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import './kara-editor.js'
import type { KaraEditor } from './kara-editor.js'

@customElement('kara-editor-page')
export class KaraEditorPage extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };

    private _world  = '';
    private _code   = '';
    private _step   = 200;
    private _autorun = false;
    private _timeout = '30';

    constructor() {
        super();
        const params = this._getParams();
        if (params.has('world'))   this._world   = params.get('world')!;
        if (params.has('code'))    this._code    = params.get('code')!;
        if (params.has('step'))    this._step    = parseInt(params.get('step')!);
        if (params.has('timeout')) this._timeout = params.get('timeout')!;
        if (params.has('autorun')) {
            const v = params.get('autorun');
            this._autorun = !(v === 'false' || v === '0');
        }
    }

    private _getParams() {
        const uri = new URL(document.location.href);
        if (uri.searchParams.size === 0 && window.location !== window.parent.location)
            return new URL(document.referrer).searchParams;
        return uri.searchParams;
    }

    firstUpdated() {
        const el = this.renderRoot.querySelector('kara-editor') as KaraEditor | null;
        if (!el) return;
        if (this._world) el.world = this._world;
        if (this._code)  el.code  = this._code;
    }

    render() {
        return html`
            <kara-editor
                step=${this._step}
                timeout=${this._timeout}
                ?autorun=${this._autorun}
            ></kara-editor>`;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        kara-editor {
            flex: 1;
            min-height: 0;
            container-type: inline-size;
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        'kara-editor-page': KaraEditorPage
    }
}
