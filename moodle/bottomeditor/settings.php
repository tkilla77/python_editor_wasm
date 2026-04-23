<?php
defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    $settings->add(new admin_setting_configtext(
        'mod_bottomeditor/scriptbaseurl',
        get_string('scriptbaseurl',      'mod_bottomeditor'),
        get_string('scriptbaseurl_desc', 'mod_bottomeditor'),
        'https://bottom.ch/editor/stable',
        PARAM_URL
    ));
}
