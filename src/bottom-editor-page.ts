import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import './editor.js'

@customElement('bottom-editor-page')
class BottomEditorPage extends LitElement {
    static shadowRootOptions = {...LitElement.shadowRootOptions, mode: "closed" as const};

    private sourceCode : string = '';
    private autoRun: boolean = false;
    private zipUrl: string = ''

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

    render() {
        return html`<bottom-editor exportparts="buttons" .sourceCode=${this.sourceCode} ?autorun=${this.autoRun} zip='${this.zipUrl}'></bottom-editor>`;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
        }
        bottom-editor {
            max-height: initial;
            flex: 1;
            min-height: 0;
        }
        bottom-editor::part(buttons) {
            flex-direction: column;
        }
    `
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor-page': BottomEditorPage
    }
}
