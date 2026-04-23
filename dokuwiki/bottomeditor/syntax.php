<?php
/**
 * DokuWiki Plugin bottomeditor — Syntax Component
 *
 * Passes <bottom-editor>, <bottom-exercise>, and <kara-editor> tags through
 * to the rendered page as raw HTML. The web components themselves are loaded
 * via <script type="module"> tags injected by the companion action plugin.
 *
 * Usage in wiki pages: write the tags exactly as you would in plain HTML,
 * including any attributes and child <template> elements. DokuWiki markup
 * inside the tags is intentionally not processed.
 *
 * @license MIT
 * @author  Tom Hofmann <tom+bottom@scheidweg.net>
 */

if (!defined('DOKU_INC')) die();

class syntax_plugin_bottomeditor extends DokuWiki_Syntax_Plugin {

    public function getType() {
        // 'protected' prevents DokuWiki from processing content inside the tags.
        return 'protected';
    }

    public function getPType() {
        return 'block';
    }

    public function getSort() {
        return 195;
    }

    public function connectTo($mode) {
        $this->Lexer->addEntryPattern(
            '<(?:bottom-editor|bottom-exercise|kara-editor)\b[^>]*>',
            $mode,
            'plugin_bottomeditor'
        );
    }

    public function getEndPattern() {
        return '</(?:bottom-editor|bottom-exercise|kara-editor)>';
    }

    /**
     * Store state + raw matched text; no transformation needed.
     */
    public function handle($match, $state, $pos, Doku_Handler $handler) {
        return [$state, $match];
    }

    /**
     * Emit each piece (opening tag, content, closing tag) verbatim as HTML.
     */
    public function render($mode, Doku_Renderer $renderer, $data) {
        if ($mode !== 'xhtml') return false;
        [$state, $match] = $data;
        $renderer->doc .= $match;
        return true;
    }
}
