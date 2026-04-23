<?php
/**
 * DokuWiki Plugin bottomeditor — Syntax Component
 *
 * Passes <bottom-editor>, <bottom-exercise>, and <kara-editor> tags through
 * to the rendered page as raw HTML. The web components are loaded via
 * <script type="module"> tags injected by the companion action plugin.
 *
 * Usage: write the tags exactly as you would in plain HTML, including
 * attributes and child <template> elements. DokuWiki markup inside the
 * tags is intentionally not processed.
 *
 * @license MIT
 * @author  Tom Hofmann <tom+bottom@scheidweg.net>
 */

if (!defined('DOKU_INC')) die();

class syntax_plugin_bottomeditor extends DokuWiki_Syntax_Plugin {

    const ELEMENT_PATTERN = '<(bottom-editor|bottom-exercise|kara-editor)\b[^>]*>[\s\S]*?<\/\1>';

    public function getType() {
        // 'substition': single-pattern match; the whole element is one token.
        return 'substition';
    }

    public function getPType() {
        return 'block';
    }

    public function getSort() {
        return 195;
    }

    public function connectTo($mode) {
        $this->Lexer->addSpecialPattern(self::ELEMENT_PATTERN, $mode, 'plugin_bottomeditor');
    }

    /**
     * Return the raw matched HTML unchanged.
     */
    public function handle($match, $state, $pos, Doku_Handler $handler) {
        return $match;
    }

    /**
     * Emit the element verbatim into the HTML output.
     */
    public function render($mode, Doku_Renderer $renderer, $data) {
        if ($mode !== 'xhtml') return false;
        $renderer->doc .= $data;
        return true;
    }
}
