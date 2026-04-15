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
    @property({ type: Boolean }) permalink = true;
    @property({ type: Boolean }) showrevert = false;
    /** Show the cloud-sync button. Set when at least one cloud backend is configured. */
    @property({ type: Boolean, reflect: true }) showsync = false;
    /** Active cloud backend: 'local' | 'google' | 'microsoft' */
    @property({ reflect: true }) syncbackend: string = 'local';

    private fire(name: string) {
        this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    }

    private _syncTitle(): string {
        if (this.syncbackend === 'google')    return 'Cloud sync: Google Drive (click to disconnect)';
        if (this.syncbackend === 'microsoft') return 'Cloud sync: OneDrive (click to disconnect)';
        return 'Enable cloud sync';
    }

    private _syncCaption(): string {
        if (this.syncbackend === 'google')    return 'Drive';
        if (this.syncbackend === 'microsoft') return 'OneDrive';
        return 'Sync';
    }

    render() {
        return html`
            <button id="run"       @click="${() => this.fire('bottom-run')}"       type="button" title="Run (Ctrl+Enter)"><span class="caption">Run</span></button>
            <button id="stop"      @click="${() => this.fire('bottom-stop')}"      type="button" title="Stop"><span class="caption">Stop</span></button>
            ${this.showclear ? html`<button id="clear" @click="${() => this.fire('bottom-clear')}" type="button" title="${this.resetmode ? 'Reset' : 'Clear Output'}"><span class="caption">${this.resetmode ? 'Reset' : 'Clear'}</span></button>` : ''}
            ${this.showrevert ? html`<button id="revert" @click="${() => this.fire('bottom-revert')}" type="button" title="Revert to initial code"><span class="caption">Revert</span></button>` : ''}
            ${this.permalink ? html`<button id="permalink" @click="${() => this.fire('bottom-permalink')}" type="button" title="Copy Permalink"><span class="caption">Link</span></button>` : ''}
            ${this.showsync ? html`<button id="sync" class="${this.syncbackend !== 'local' ? 'active' : ''}" @click="${() => this.fire('bottom-sync')}" type="button" title="${this._syncTitle()}"><span class="caption">${this._syncCaption()}</span></button>` : ''}`;
    }
}
