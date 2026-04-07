import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import styles from './bottom-editor-buttons.css?inline';

@customElement('bottom-editor-buttons')
export class BottomEditorButtons extends LitElement {
    static styles = unsafeCSS(styles);

    @property({ type: Boolean, reflect: true }) running = false;
    @property({ type: Boolean, reflect: true }) vertical = false;
    @property({ type: Boolean, reflect: true }) showclear = false;
    @property({ type: Boolean, reflect: true }) resetmode = false;

    private fire(name: string) {
        this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    }

    render() {
        return html`
            <button id="run"       @click="${() => this.fire('bottom-run')}"       type="button" title="Run (Ctrl+Enter)"><span class="caption">Run</span></button>
            <button id="stop"      @click="${() => this.fire('bottom-stop')}"      type="button" title="Stop"><span class="caption">Stop</span></button>
            ${this.showclear ? html`<button id="clear" @click="${() => this.fire('bottom-clear')}" type="button" title="${this.resetmode ? 'Reset' : 'Clear Output'}"><span class="caption">${this.resetmode ? 'Reset' : 'Clear'}</span></button>` : ''}
            <button id="permalink" @click="${() => this.fire('bottom-permalink')}" type="button" title="Copy Permalink"><span class="caption">Link</span></button>`;
    }
}
