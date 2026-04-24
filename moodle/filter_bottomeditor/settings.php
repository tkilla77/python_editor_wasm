<?php
defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    $settings->add(new admin_setting_configtext(
        'filter_bottomeditor/base_url',
        get_string('base_url', 'filter_bottomeditor'),
        get_string('base_url_desc', 'filter_bottomeditor'),
        'https://bottom.ch/editor/stable',
        PARAM_URL
    ));
}
