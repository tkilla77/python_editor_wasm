<?php
/**
 * DokuWiki Plugin bottomeditor — Action Component
 *
 * Injects the bottom-exercise.js and kara-editor-page.js script bundles into
 * every page head. Both are ES modules loaded from bottom.ch/editor/stable
 * (configurable). Loading the stub scripts is cheap; the heavy editor bundle
 * is only fetched by the browser when a matching custom element is found on
 * the page.
 *
 * @license MIT
 * @author  Tom Hofmann <tom+bottom@scheidweg.net>
 */

if (!defined('DOKU_INC')) die();

class action_plugin_bottomeditor extends DokuWiki_Action_Plugin {

    public function register(Doku_Event_Handler $controller) {
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE', $this, 'addScripts');
    }

    public function addScripts(Doku_Event $event) {
        $base = rtrim($this->getConf('base_url'), '/');

        $event->data['script'][] = [
            'type'  => 'module',
            'src'   => $base . '/bottom-exercise.js',
            '_data' => '',
        ];
        $event->data['script'][] = [
            'type'  => 'module',
            'src'   => $base . '/kara-editor-page.js',
            '_data' => '',
        ];
    }
}
