import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './kara-editor.js'
import './kara-exercise.js'
import type { KaraEditor } from './kara-editor.js'
import { decodeExercise, type ExercisePermalinkState } from './exercise-permalink.js'

@customElement('kara-editor-page')
export class KaraEditorPage extends LitElement {
    static shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'closed' as const };

    // Plain editor params (no ?x=)
    private _world   = '';
    private _code    = '';
    private _step    = 200;
    private _autorun = false;
    private _timeout = '30';

    // Exercise mode: decoded from ?x=
    @state() private _decoded?: ExercisePermalinkState;
    @state() private _decoding = false;

    constructor() {
        super();
        const params = this._getParams();
        if (!params.has('x')) {
            if (params.has('world'))   this._world   = params.get('world')!;
            if (params.has('code'))    this._code    = params.get('code')!;
            if (params.has('step'))    this._step    = parseInt(params.get('step')!);
            if (params.has('timeout')) this._timeout = params.get('timeout')!;
            if (params.has('autorun')) {
                const v = params.get('autorun');
                this._autorun = !(v === 'false' || v === '0');
            }
        }
    }

    override async connectedCallback() {
        super.connectedCallback();
        const x = this._getParams().get('x');
        if (!x) return;
        // Set flag synchronously — first render sees _decoding=true and renders nothing,
        // avoiding a flash of the plain <kara-editor> before the blob is ready.
        this._decoding = true;
        try {
            this._decoded = await decodeExercise(x);
        } catch (e) {
            console.error('Kara permalink decode failed', e);
        } finally {
            this._decoding = false;
        }
    }

    private _getParams() {
        const uri = new URL(document.location.href);
        if (uri.searchParams.size === 0 && window.location !== window.parent.location)
            return new URL(document.referrer).searchParams;
        return uri.searchParams;
    }

    override firstUpdated() {
        // Only needed in plain editor mode — in exercise mode the decoded state
        // is passed via Lit property bindings directly in render().
        if (!this._decoded && !this._decoding) {
            const el = this.renderRoot.querySelector('kara-editor') as KaraEditor | null;
            if (el) {
                if (this._world) el.world = this._world;
                if (this._code)  el.code  = this._code;
            }
        }
    }

    override render() {
        if (this._decoding) return html``;

        const s = this._decoded;
        if (s) {
            return html`
                <kara-exercise
                    step=${s.step ?? 200}
                    timeout=${s.timeout ?? '30'}
                    .world=${s.world ?? ''}
                    .code=${s.code ?? ''}
                    .solution=${s.solution ?? ''}
                    .testCode=${s.tests ?? ''}
                ></kara-exercise>`;
        }

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
        kara-editor, kara-exercise {
            flex: 1;
            min-height: 0;
            container-type: inline-size;
            --be-code-max-height: none;
            --be-canvas-max-height: none;
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        'kara-editor-page': KaraEditorPage
    }
}
