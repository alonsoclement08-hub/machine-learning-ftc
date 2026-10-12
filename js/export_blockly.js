// Export du meilleur plan en fichier .blk pour FTC Blocks (Blockly).
// Même logique que le Java : 3 variables MS_PAR_METRE, MS_POUR_180_DEG, PUISSANCE_TIR en tête,
// tous les temps de déplacement sont calculés à partir d'elles.
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  BZ.exportBlockly = function (result, robot, opts) {
    opts = opts || {};
    const steps = BZ.exportSteps(result);
    const m = robot.moteurs;
    const mec = robot.chassis !== 'tank';
    const feeder = m.alimentation && m.alimentation.trim() ? m.alimentation.trim() : m.intake;
    let idn = 0;
    const id = () => 'bz' + (++idn).toString(36) + Math.random().toString(36).slice(2, 8);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const num = (v) => `<shadow type="math_number" id="${id()}"><field name="NUM">${+(+v).toFixed(4)}</field></shadow>`;

    const VARS = { MS_PAR_METRE: id(), MS_POUR_180_DEG: id(), PUISSANCE_TIR: id() };
    const getVar = (n) => `<block type="variables_get" id="${id()}"><field name="VAR" id="${VARS[n]}">${n}</field></block>`;
    const mul = (n, k) => `<block type="math_arithmetic" id="${id()}"><field name="OP">MULTIPLY</field>` +
      `<value name="A"><shadow type="math_number" id="${id()}"><field name="NUM">1</field></shadow>${getVar(n)}</value>` +
      `<value name="B">${num(k)}</value></block>`;

    // Chaque instruction est une chaîne XML d'un bloc "statement" sans balise <next>.
    const setVar = (n, v) => `<block type="variables_set" id="${id()}"><field name="VAR" id="${VARS[n]}">${n}</field><value name="VALUE"><block type="math_number" id="${id()}"><field name="NUM">${v}</field></block></value>`;
    const comment = (t) => `<block type="comment" id="${id()}"><field name="COMMENT">${esc(t)}</field>`;
    const power = (motor, valueXml) => `<block type="dcMotor_setProperty_Number" id="${id()}"><field name="IDENTIFIER">${esc(motor)}AsDcMotor</field><field name="PROP">Power</field><data>{"IDENTIFIER":"${esc(motor)}"}</data><value name="VALUE">${valueXml}</value>`;
    const dual = (m1, v1, m2, v2) => `<block type="dcMotor_setDualProperty_Number" id="${id()}"><field name="PROP">Power</field><field name="IDENTIFIER1">${esc(m1)}AsDcMotor</field><field name="IDENTIFIER2">${esc(m2)}AsDcMotor</field><data>{"IDENTIFIER1":"${esc(m1)}","IDENTIFIER2":"${esc(m2)}"}</data><value name="VALUE1">${num(v1)}</value><value name="VALUE2">${num(v2)}</value>`;
    const direction = (motor) => `<block type="dcMotor_setProperty_Direction" id="${id()}"><field name="IDENTIFIER">${esc(motor)}AsDcMotor</field><field name="PROP">Direction</field><data>{"IDENTIFIER":"${esc(motor)}"}</data><value name="VALUE"><shadow type="dcMotor_typedEnum_direction" id="${id()}"><field name="DIRECTION">REVERSE</field></shadow></value>`;
    const sleepXml = (valueXml) => `<block type="linearOpMode_sleep_Number" id="${id()}"><value name="MILLISECONDS"><shadow type="math_number" id="${id()}"><field name="NUM">0</field></shadow>${valueXml}</value>`;
    const sleepNum = (ms) => `<block type="linearOpMode_sleep_Number" id="${id()}"><value name="MILLISECONDS">${num(ms)}</value>`;
    const call = (name) => `<block type="procedures_callnoreturn" id="${id()}"><mutation name="${esc(name)}"/>`;

    // Enchaîne des blocs : [a, b, c] -> a<next>b<next>c</next></block></next></block></block>
    const chain = (blocks) => {
      if (!blocks.length) return '';
      let xml = '';
      for (let i = blocks.length - 1; i >= 0; i--) {
        xml = blocks[i] + (xml ? `<next>${xml}</next>` : '') + '</block>';
      }
      return xml;
    };

    const wheels = (ag, ad, arg, ard) => mec
      ? [dual(m.avantGauche, ag, m.avantDroit, ad), dual(m.arriereGauche, arg, m.arriereDroit, ard)]
      : [dual(m.gauche, ag, m.droit, ad)];

    const seq = [];
    seq.push(comment('--- Séquence trouvée par l\'IA BIOBUZZ ---'));
    for (const s of steps) {
      if (s.label) seq.push(comment(`t=${s.t} ${s.label}`));
      if (s.op === 'move') {
        const P = robot.puissanceRoues;
        const tA = Math.abs(s.f), tC = mec ? Math.abs(s.s) / robot.facteurCrabe : 0;
        const k = Math.max(tA, tC); // durée = MS_PAR_METRE x k
        if (k <= 0) continue;
        const a = P * Math.sign(s.f) * (tA / k), c = P * Math.sign(s.s) * (tC / k);
        seq.push(comment(mec ? `deplacer avant ${s.f} m, crabe ${s.s} m` : `avancer ${s.f} m`));
        seq.push(...wheels(a - c, a + c, a + c, a - c));
        seq.push(sleepXml(mul('MS_PAR_METRE', k)));
        seq.push(call('stopRoues'));
      } else if (s.op === 'turn') {
        const p = robot.puissanceRotation * Math.sign(s.deg);
        seq.push(comment(`tourner ${s.deg} degres (positif = gauche)`));
        seq.push(...wheels(-p, p, -p, p));
        seq.push(sleepXml(mul('MS_POUR_180_DEG', Math.abs(s.deg) / 180)));
        seq.push(call('stopRoues'));
      } else if (s.op === 'wait') {
        seq.push(sleepNum(s.ms));
      } else if (s.op === 'feed') {
        seq.push(power(feeder, num(1)));
        seq.push(sleepNum(s.n * robot.lanceur.msParBalle));
        seq.push(power(feeder, num(0)));
      } else if (s.op === 'launcherOn') {
        seq.push(power(m.lanceur, `<shadow type="math_number" id="${id()}"><field name="NUM">0</field></shadow>${getVar('PUISSANCE_TIR')}`));
      } else if (s.op === 'launcherOff') {
        seq.push(power(m.lanceur, num(0)));
      } else if (s.op === 'intakeOn') {
        seq.push(power(m.intake, num(robot.intake.puissance)));
      } else if (s.op === 'intakeOff') {
        seq.push(power(m.intake, num(0)));
      }
    }
    seq.push(call('stopRoues'));
    seq.push(power(m.lanceur, num(0)));
    seq.push(power(m.intake, num(0)));
    if (feeder !== m.intake) seq.push(power(feeder, num(0)));

    const init = [];
    init.push(comment('=== LES 3 VARIABLES A CALIBRER ==='));
    init.push(comment('MS_PAR_METRE : temps (ms) pour avancer de 1 m'));
    init.push(setVar('MS_PAR_METRE', robot.msParMetre));
    init.push(comment('MS_POUR_180_DEG : temps (ms) pour un demi-tour sur place'));
    init.push(setVar('MS_POUR_180_DEG', robot.msPour180));
    init.push(comment('PUISSANCE_TIR : puissance du lanceur (0 a 1)'));
    init.push(setVar('PUISSANCE_TIR', robot.puissanceTir));
    init.push(comment('Conseil : moteurs des roues en ZeroPowerBehavior BRAKE (comme lors de la calibration)'));
    if (mec) {
      init.push(direction(robot.inverserGauche ? m.avantGauche : m.avantDroit));
      init.push(direction(robot.inverserGauche ? m.arriereGauche : m.arriereDroit));
    } else {
      init.push(direction(robot.inverserGauche ? m.gauche : m.droit));
    }
    for (const line of (opts.startText || [])) init.push(comment(line));
    init.push(`<block type="linearOpMode_waitForStart" id="${id()}">`);
    init.push(`<block type="controls_if" id="${id()}"><value name="IF0"><block type="linearOpMode_opModeIsActive" id="${id()}"/></value><statement name="DO0">${chain(seq)}</statement>`);

    const stopBody = chain([...wheels(0, 0, 0, 0), sleepNum(robot.pauseMs)]);

    const xml = '<xml xmlns="https://developers.google.com/blockly/xml">' +
      '<variables>' + Object.entries(VARS).map(([n, i]) => `<variable id="${i}">${n}</variable>`).join('') + '</variables>' +
      `<block type="procedures_defnoreturn" id="${id()}" deletable="false" x="20" y="20"><field name="NAME">runOpMode</field>` +
      `<comment pinned="false" h="80" w="400">AUTO BIOBUZZ généré par BIOBUZZ Auto IA. Score espéré ${result.expected.toFixed(1)} pts. Ne modifiez que les 3 variables du début.</comment>` +
      `<statement name="STACK">${chain(init)}</statement></block>` +
      `<block type="procedures_defnoreturn" id="${id()}" x="700" y="20"><field name="NAME">stopRoues</field>` +
      `<comment pinned="false" h="40" w="250">Arrête les roues puis petite pause</comment>` +
      `<statement name="STACK">${stopBody}</statement></block>` +
      '</xml>' +
      "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>" +
      `<Extra><OpModeMeta flavor="AUTONOMOUS" group="IA" autoTransition="" /><Enabled value="true" /></Extra>`;
    return xml;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
