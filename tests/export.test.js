'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { BZ, FIELD } = require('./load');

function bestFor(chassis) {
  const robot = BZ.defaultRobot();
  robot.chassis = chassis;
  const opt = new BZ.Optimizer(FIELD, robot, BZ.defaultGame(), { seed: 3, popSize: 40 });
  for (let i = 0; i < 15; i++) opt.step();
  const r = opt.bestResult();
  const startText = BZ.describeStart(opt.world, r.plan.start, robot);
  return { robot, r, startText };
}

function hasJavac() {
  try { execFileSync('javac', ['-version'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

for (const chassis of ['mecanum', 'tank']) {
  test(`export Java (${chassis}) : 3 variables + compile`, (t) => {
    const { robot, r, startText } = bestFor(chassis);
    const java = BZ.exportJava(r, robot, { startText });
    for (const v of ['MS_PAR_METRE', 'MS_POUR_180_DEG', 'PUISSANCE_TIR']) {
      assert.match(java, new RegExp(`public static double ${v} = `));
    }
    assert.match(java, /@Autonomous/);
    if (chassis === 'tank') assert.doesNotMatch(java, /deplacer\(/);
    if (!hasJavac()) { t.skip('javac absent'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bzjava-'));
    const pkg = path.join(dir, 'org', 'firstinspires', 'ftc', 'teamcode');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'AutoBiobuzzIA.java'), java);
    const stubs = path.join(__dirname, 'ftc_stubs');
    const files = [path.join(pkg, 'AutoBiobuzzIA.java')];
    (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(p); } })(stubs);
    execFileSync('javac', ['-encoding', 'UTF-8', '-d', path.join(dir, 'out')].concat(files), { stdio: 'pipe' });
  });

  test(`export Blockly (${chassis}) : XML valide + 3 variables`, () => {
    const { robot, r, startText } = bestFor(chassis);
    const blk = BZ.exportBlockly(r, robot, { startText });
    const [xmlPart, extra] = blk.split("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>");
    assert.match(extra, /flavor="AUTONOMOUS"/);
    for (const v of ['MS_PAR_METRE', 'MS_POUR_180_DEG', 'PUISSANCE_TIR']) {
      assert.match(xmlPart, new RegExp(`<variable id="[^"]+">${v}</variable>`));
    }
    // Vérifie la bonne formation XML avec le parseur Python (strict).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bzblk-'));
    const f = path.join(dir, 'a.xml');
    fs.writeFileSync(f, xmlPart);
    execFileSync('python3', ['-I', '-c', 'import sys, xml.dom.minidom as m; m.parse(sys.argv[1])', f]);
    // Uniquement des types de blocs vus dans de vrais fichiers .blk FTC
    const known = new Set(['procedures_defnoreturn', 'procedures_callnoreturn', 'variables_set', 'variables_get', 'math_number',
      'math_arithmetic', 'comment', 'dcMotor_setProperty_Number', 'dcMotor_setDualProperty_Number', 'dcMotor_setProperty_Direction',
      'dcMotor_typedEnum_direction', 'linearOpMode_sleep_Number', 'linearOpMode_waitForStart', 'controls_if', 'linearOpMode_opModeIsActive']);
    for (const m of xmlPart.matchAll(/type="([^"]+)"/g)) assert.ok(known.has(m[1]), 'bloc inconnu ' + m[1]);
    // ids uniques
    const ids = [...xmlPart.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const varIds = new Set([...xmlPart.matchAll(/<variable id="([^"]+)"/g)].map((m) => m[1]));
    const blockIds = ids.filter((i) => !varIds.has(i));
    assert.strictEqual(new Set(blockIds).size, blockIds.length, "ids de blocs uniques");
  });
}
