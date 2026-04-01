import { LitElement, html, unsafeCSS } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import styles from './bottom-editor-canvas.css?inline';

@customElement('bottom-editor-canvas')
export class BottomEditorCanvas extends LitElement {
    static styles = unsafeCSS(styles);

    @query('canvas')
    private _canvas?: HTMLCanvasElement;

    transferToOffscreen(): OffscreenCanvas {
        if (!this._canvas) throw new Error('Canvas not ready');
        return this._canvas.transferControlToOffscreen();
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
