// Charge les scripts du navigateur dans Node (ils s'attachent à globalThis.BZ).
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['geometry', 'robot', 'rules', 'planner', 'sim', 'optimizer', 'export_java', 'export_blockly']) {
  require(path.join(ROOT, 'js', f + '.js'));
}
module.exports = { BZ: globalThis.BZ, FIELD: require(path.join(ROOT, 'data', 'field_layout.js')), ROOT };
