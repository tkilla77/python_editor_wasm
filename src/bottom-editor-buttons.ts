import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import styles from './bottom-editor-buttons.css?inline';

@customElement('bottom-editor-buttons')
export class BottomEditorButtons extends LitElement {
    static styles = unsafeCSS(styles);

    @property({ type: Boolean, reflect: true }) running = false;
    @property({ type: Boolean, reflect: true }) vertical = false;
    /** 'auto' (default) | 'show' | 'hide' — overrides container-query caption logic */
    @property({ reflect: true }) captionmode: string = 'auto';
    /** Show the Reset button (gray arrow — clears canvas/output, re-runs readyCode). */
    @property({ type: Boolean, reflect: true }) showreset = false;
    /** Show the Revert button (red eraser — resets editor code to initial + performs reset). */
    @property({ type: Boolean, reflect: true }) showrevert = false;
    @property({ type: Boolean }) permalink = true;
    @property() shareState: 'idle' | 'copied' | 'error' = 'idle';
    /** Show the cloud-sync button. Set when at least one cloud backend is configured. */
    @property({ type: Boolean, reflect: true }) showsync = false;
    /** Active cloud backend: 'local' | 'google' | 'microsoft' */
    @property({ reflect: true }) syncbackend: string = 'local';

    private fire(name: string) {
        this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    }

    private _syncTitle(): string {
        if (this.syncbackend === 'syncing')   return 'Cloud sync: loading…';
        if (this.syncbackend === 'google')    return 'Cloud sync: Google Drive (click to disconnect)';
        if (this.syncbackend === 'microsoft') return 'Cloud sync: OneDrive (click to disconnect)';
        return 'Enable cloud sync';
    }

    private _syncCaption(): string {
        if (this.syncbackend === 'syncing')   return '…';
        if (this.syncbackend === 'google')    return 'Drive';
        if (this.syncbackend === 'microsoft') return 'OneDrive';
        return 'Sync';
    }

    private _syncClass(): string {
        if (this.syncbackend === 'syncing')   return 'syncing';
        if (this.syncbackend !== 'local')     return 'active';
        return '';
    }

    render() {
        return html`
            <button id="run"      @click="${() => this.fire('bottom-run')}"      type="button" title="Run (Ctrl+Enter)"><span class="caption">Run</span></button>
            <button id="stop"     @click="${() => this.fire('bottom-stop')}"     type="button" title="Stop"><span class="caption">Stop</span></button>
            ${this.showreset  ? html`<button id="reset"  @click="${() => this.fire('bottom-reset')}"  type="button" title="Reset world"><span class="caption">Reset</span></button>`  : ''}
            ${this.showrevert ? html`<button id="revert" @click="${() => this.fire('bottom-revert')}" type="button" title="Revert to initial code"><span class="caption">Revert</span></button>` : ''}
            ${this.permalink ? html`<button id="permalink" class="${this.shareState !== 'idle' ? this.shareState : ''}" @click="${() => this.fire('bottom-permalink')}" type="button" title="Copy share link"><span class="caption">${this.shareState === 'copied' ? 'Copied!' : this.shareState === 'error' ? 'Failed' : 'Share'}</span></button>` : ''}
            ${this.showsync ? html`<button id="sync" class="${this._syncClass()}" @click="${() => this.fire('bottom-sync')}" type="button" title="${this._syncTitle()}"><span class="caption">${this._syncCaption()}</span></button>` : ''}`;
    }
}
