import { LitElement, html, unsafeCSS } from 'lit'
import { customElement } from 'lit/decorators.js'
import styles from './bottom-editor-canvas.css?inline';

@customElement('bottom-editor-canvas')
export class BottomEditorCanvas extends LitElement {
    static styles = unsafeCSS(styles);

    transferToOffscreen(): OffscreenCanvas {
        // Always replace the existing canvas with a fresh element so this method
        // can be called again after a worker restart (transferControlToOffscreen
        // is a one-shot operation — the transferred canvas can't be reused).
        const fresh = document.createElement('canvas');
        fresh.width = 400;
        fresh.height = 400;
        const existing = this.shadowRoot!.querySelector('canvas');
        if (existing) existing.replaceWith(fresh);
        return fresh.transferControlToOffscreen();
    }

    render() {
        return html`<canvas width="400" height="400"></canvas>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'bottom-editor-canvas': BottomEditorCanvas
    }
}
