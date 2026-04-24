<?php
defined('MOODLE_INTERNAL') || die();

class filter_bottomeditor extends moodle_text_filter {

    // Injected once per page request across all filter() calls.
    private static bool $injected = false;

    private const TAGS = ['bottom-exercise', 'bottom-editor', 'kara-editor'];

    public function filter($text, array $options = []): string {
        if (self::$injected || !is_string($text)) {
            return $text;
        }
        foreach (self::TAGS as $tag) {
            if (stripos($text, "<$tag") !== false) {
                self::$injected = true;
                return $text . $this->scripts();
            }
        }
        return $text;
    }

    private function scripts(): string {
        $base = rtrim(
            get_config('filter_bottomeditor', 'base_url') ?: 'https://bottom.ch/editor/stable',
            '/'
        );
        $ex = json_encode($base . '/bottom-exercise.js');
        $ka = json_encode($base . '/kara-editor-page.js');
        // window.__bottomEditorLoaded guards against a second load when the
        // author also added an explicit <script> tag (e.g. a different version).
        return <<<HTML

<script>
(function () {
    if (window.__bottomEditorLoaded) return;
    window.__bottomEditorLoaded = true;
    [{$ex}, {$ka}].forEach(function (src) {
        var s = document.createElement('script');
        s.type = 'module';
        s.src  = src;
        document.head.appendChild(s);
    });
}());
</script>
HTML;
    }
}
