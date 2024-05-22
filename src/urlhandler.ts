import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { BottomEditor } from './editor.js'

@customElement('main-editor')
class MainEditor extends LitElement {
    static shadowRootOptions = {...LitElement.shadowRootOptions, mode: 'closed'};

    render() {
        return html`<bottom-editor></bottom-editor>`;
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