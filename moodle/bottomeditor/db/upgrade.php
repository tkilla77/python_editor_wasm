<?php
defined('MOODLE_INTERNAL') || die();

function xmldb_bottomeditor_upgrade(int $oldversion): bool {
    global $DB;
    $dbman = $DB->get_manager();

    if ($oldversion < 2026103000) {
        $table = new xmldb_table('bottomeditor');
        $fields = [
            new xmldb_field('stepmode',   XMLDB_TYPE_INTEGER, '1',  null, XMLDB_NOTNULL, null, '0', 'enablesolution'),
            new xmldb_field('showenergy', XMLDB_TYPE_INTEGER, '1',  null, XMLDB_NOTNULL, null, '0', 'stepmode'),
            new xmldb_field('maxenergy',  XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0', 'showenergy'),
            new xmldb_field('maxmemory',  XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0', 'maxenergy'),
            new xmldb_field('multifile',  XMLDB_TYPE_INTEGER, '1',  null, XMLDB_NOTNULL, null, '0', 'maxmemory'),
        ];
        foreach ($fields as $field) {
            if (!$dbman->field_exists($table, $field)) {
                $dbman->add_field($table, $field);
            }
        }
        upgrade_mod_savepoint(true, 2026103000, 'bottomeditor');
    }

    if ($oldversion < 2026103001) {
        $table = new xmldb_table('bottomeditor');
        $field = new xmldb_field('nodebug', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'multifile');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026103001, 'bottomeditor');
    }

    return true;
}
