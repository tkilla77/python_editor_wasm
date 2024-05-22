import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { BottomEditor } from './editor.js'
import { textToBase64, base64ToText } from './encoder.js'

@customElement('main-editor')
class MainEditor extends LitElement {
    static shadowRootOptions = {...LitElement.shadowRootOptions, mode: 'open'};

    @query('bottom-editor')
    _editor?: BottomEditor;

    private sourceCode : string = '';

    constructor() {
        super();
        const params = this.getParams();
        if (params.has('code')) {
            // Set editor contents and clear URL params.
            const code = params.get('code');
            if (code) {
                console.log(`Updating code from URL param: ${code}`);
                this.sourceCode = code;
            }
            let url = new URL(document.location.href);
            url.searchParams.delete('code');
            window.history.replaceState({}, '', url.href);
        }
    }

    getUrl() {
        let uri = new URL(document.location.href);
        if (uri.searchParams.size == 0 && window.location != window.parent.location) {
          // Attempt to read URL params from containing page.
          uri = new URL(document.referrer);
        }
        return uri;
    }
    
    getParams() {
        return this.getUrl().searchParams;
    }

    protected firstUpdated() {
        const params = this.getParams();
        if (params.has('code')) {
            // Set editor contents and clear URL params.
            const code = params.get('code');
            if (code && this._editor) {
                console.log(`Updating code from URL param: ${code}`);
                console.log(this._editor.sourceCode);
                console.log(this._editor.replaceDoc);
                this._editor.sourceCode = code;
                console.log(this._editor.sourceCode);
            }
            let url = new URL(document.location.href);
            url.searchParams.delete('code');
            window.history.replaceState({}, '', url.href);
        }
    }

    render() {
        return html`<bottom-editor code='${textToBase64(this.sourceCode)}'></bottom-editor>`;
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: row;
            flex: 1;
            height: 0;
        }
        bottom-editor {
            max-height: initial;
            flex: 1;
        }
    `
}


declare global {
    interface HTMLElementTagNameMap {
        'main-editor': MainEditor
    }
}