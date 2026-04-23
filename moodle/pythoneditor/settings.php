<?php
defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    $settings->add(new admin_setting_configtext(
        'mod_pythoneditor/scriptbaseurl',
        get_string('scriptbaseurl',      'mod_pythoneditor'),
        get_string('scriptbaseurl_desc', 'mod_pythoneditor'),
        'https://bottom.ch/editor/stable',
        PARAM_URL
    ));
}
