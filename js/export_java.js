// Export du meilleur plan en code Java FTC (LinearOpMode chronométré, sans encodeurs).
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};

  const IN_PER_M = 39.3701;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // Convertit les primitives du simulateur en étapes exportables (unités : mètres, degrés, ms).
  BZ.exportSteps = function (result) {
    const steps = [];
    for (const p of result.prims) {
      const t = p.t0.toFixed(1) + ' s';
      if (p.k === 'move') steps.push({ op: 'move', f: r3(p.f / IN_PER_M), s: r3(p.s / IN_PER_M), t, label: p.label });
      else if (p.k === 'turn') steps.push({ op: 'turn', deg: Math.round(p.deg * 10) / 10, t, label: p.label });
      else if (p.k === 'wait') steps.push({ op: 'wait', ms: p.ms, t, label: p.label });
      else if (p.k === 'feed') steps.push({ op: 'feed', n: p.n, t, label: p.label });
      else steps.push({ op: p.k, t, label: p.label });
    }
    // supprime les déplacements nuls après arrondi
    return steps.filter((s) => !(s.op === 'move' && s.f === 0 && s.s === 0) && !(s.op === 'turn' && s.deg === 0));
  };

  // Description humaine de la position de départ.
  BZ.describeStart = function (world, start, robot) {
    const rd = world.rd, half = world.half;
    const cm = (v) => Math.round(v * 2.54);
    const poly = BZ.G.rectCorners(start.x, start.y, start.h, rd.hl, rd.hw);
    const minX = Math.min(...poly.map((p) => p[0])), minY = Math.min(...poly.map((p) => p[1])), maxY = Math.max(...poly.map((p) => p[1]));
    const deg = Math.round(BZ.G.deg(start.h));
    const capTxt = {
      0: 'l\'avant du robot regarde vers le centre du terrain (dos au mur de votre alliance)',
      90: 'l\'avant du robot regarde vers votre gauche',
      180: 'l\'avant du robot regarde vers le mur de votre alliance',
      '-90': 'l\'avant du robot regarde vers votre droite',
    }[deg] || `cap ${deg}°`;
    return [
      'Repère : vous êtes dans votre ALLIANCE AREA et vous regardez le terrain.',
      `Bord du robot le plus proche de votre alliance : ${cm(minX + half)} cm du mur de votre alliance.`,
      `Bord du robot côté droit : ${cm(minY + half)} cm du mur de droite ; côté gauche : ${cm(half - maxY)} cm du mur de gauche.`,
      `Orientation : ${capTxt}.`,
    ];
  };

  BZ.exportJava = function (result, robot, opts) {
    opts = opts || {};
    const className = opts.className || 'AutoBiobuzzIA';
    const steps = BZ.exportSteps(result);
    const m = robot.moteurs;
    const mec = robot.chassis !== 'tank';
    const feeder = m.alimentation && m.alimentation.trim() ? m.alimentation.trim() : null;
    const L = [];
    const startLines = opts.startText || [];
    L.push('package org.firstinspires.ftc.teamcode;');
    L.push('');
    L.push('import com.qualcomm.robotcore.eventloop.opmode.Autonomous;');
    L.push('import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;');
    L.push('import com.qualcomm.robotcore.hardware.DcMotor;');
    L.push('import com.qualcomm.robotcore.hardware.DcMotorSimple;');
    L.push('');
    L.push('/*');
    L.push(' * AUTO BIOBUZZ généré par le simulateur "BIOBUZZ Auto IA".');
    L.push(` * Robot : ${robot.nom} (${mec ? 'mecanum' : 'tank'})`);
    L.push(` * Score AUTO espéré : ${result.expected.toFixed(1)} pts (LEAVE ${result.leave ? 'oui' : 'non'}, PARK ${result.park ? 'oui' : 'non'}, bascules espérées ${result.eTips.toFixed(2)})`);
    L.push(` * Durée prévue : ${result.endT.toFixed(1)} s sur 30 s. Fautes détectées : ${result.faults.length ? result.faults.map((f) => f.rule).join(', ') : 'aucune'}.`);
    L.push(' *');
    L.push(' * Le terrain est symétrique : ce programme marche en ROUGE comme en BLEU (placez le robot');
    L.push(' * au même endroit, vu depuis votre ALLIANCE AREA).');
    L.push(' * Placement de départ :');
    for (const s of startLines) L.push(' *   - ' + s);
    L.push(' *');
    L.push(' * Pour régler le robot, ne modifiez QUE les 3 variables ci-dessous.');
    L.push(' */');
    L.push(`@Autonomous(name = "BIOBUZZ IA - ${robot.nom.replace(/"/g, '')}", group = "IA")`);
    L.push(`public class ${className} extends LinearOpMode {`);
    L.push('');
    L.push('    // ================= LES 3 VARIABLES A CALIBRER =================');
    L.push('    /** Temps (ms) pour avancer de 1 mètre à PUISSANCE_ROUES. */');
    L.push(`    public static double MS_PAR_METRE = ${robot.msParMetre};`);
    L.push('    /** Temps (ms) pour faire un demi-tour (180°) sur place à PUISSANCE_ROTATION. */');
    L.push(`    public static double MS_POUR_180_DEG = ${robot.msPour180};`);
    L.push('    /** Puissance du lanceur, de 0 à 1. */');
    L.push(`    public static double PUISSANCE_TIR = ${robot.puissanceTir};`);
    L.push('    // ================================================================');
    L.push('');
    L.push('    // Réglages utilisés par le simulateur (changez-les dans l\'appli puis réexportez).');
    L.push(`    static final double PUISSANCE_ROUES = ${robot.puissanceRoues};`);
    L.push(`    static final double PUISSANCE_ROTATION = ${robot.puissanceRotation};`);
    if (mec) L.push(`    static final double FACTEUR_CRABE = ${robot.facteurCrabe}; // vitesse en crabe / vitesse en avant`);
    L.push(`    static final long PAUSE_MS = ${robot.pauseMs};`);
    L.push(`    static final double PUISSANCE_INTAKE = ${robot.intake.puissance};`);
    L.push(`    static final long MS_PAR_BALLE_TIR = ${robot.lanceur.msParBalle};`);
    L.push('');
    if (mec) L.push('    private DcMotor avantGauche, avantDroit, arriereGauche, arriereDroit;');
    else L.push('    private DcMotor gauche, droit;');
    L.push('    private DcMotor lanceur, intake, alimentation;');
    L.push('');
    L.push('    @Override');
    L.push('    public void runOpMode() {');
    if (mec) {
      L.push(`        avantGauche = hardwareMap.get(DcMotor.class, "${m.avantGauche}");`);
      L.push(`        avantDroit = hardwareMap.get(DcMotor.class, "${m.avantDroit}");`);
      L.push(`        arriereGauche = hardwareMap.get(DcMotor.class, "${m.arriereGauche}");`);
      L.push(`        arriereDroit = hardwareMap.get(DcMotor.class, "${m.arriereDroit}");`);
      L.push(`        ${robot.inverserGauche ? 'avantGauche' : 'avantDroit'}.setDirection(DcMotorSimple.Direction.REVERSE);`);
      L.push(`        ${robot.inverserGauche ? 'arriereGauche' : 'arriereDroit'}.setDirection(DcMotorSimple.Direction.REVERSE);`);
      L.push('        for (DcMotor mot : new DcMotor[]{avantGauche, avantDroit, arriereGauche, arriereDroit}) {');
    } else {
      L.push(`        gauche = hardwareMap.get(DcMotor.class, "${m.gauche}");`);
      L.push(`        droit = hardwareMap.get(DcMotor.class, "${m.droit}");`);
      L.push(`        ${robot.inverserGauche ? 'gauche' : 'droit'}.setDirection(DcMotorSimple.Direction.REVERSE);`);
      L.push('        for (DcMotor mot : new DcMotor[]{gauche, droit}) {');
    }
    L.push('            mot.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);');
    L.push('            mot.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);');
    L.push('        }');
    L.push(`        lanceur = hardwareMap.get(DcMotor.class, "${m.lanceur}");`);
    L.push(`        intake = hardwareMap.get(DcMotor.class, "${m.intake}");`);
    L.push(feeder ? `        alimentation = hardwareMap.get(DcMotor.class, "${feeder}");` : '        alimentation = intake; // les balles sont poussées dans le lanceur par l\'intake');
    L.push('');
    L.push('        telemetry.addLine("BIOBUZZ IA prêt : vérifiez le placement de départ !");');
    L.push('        telemetry.update();');
    L.push('        waitForStart();');
    L.push('        if (isStopRequested()) return;');
    L.push('');
    L.push('        // ----------------- Séquence trouvée par l\'IA -----------------');
    for (const s of steps) {
      const c = `   // t=${s.t}${s.label ? ' ' + s.label : ''}`;
      if (s.op === 'move') L.push(mec ? `        deplacer(${s.f}, ${s.s});${c}` : `        avancer(${s.f});${c}`);
      else if (s.op === 'turn') L.push(`        tourner(${s.deg});${c}`);
      else if (s.op === 'wait') L.push(`        attendre(${s.ms});${c}`);
      else if (s.op === 'feed') L.push(`        tirer(${s.n});${c}`);
      else if (s.op === 'launcherOn') L.push(`        lanceur.setPower(PUISSANCE_TIR);${c}`);
      else if (s.op === 'launcherOff') L.push(`        lanceur.setPower(0);${c}`);
      else if (s.op === 'intakeOn') L.push(`        intake.setPower(PUISSANCE_INTAKE);${c}`);
      else if (s.op === 'intakeOff') L.push(`        intake.setPower(0);${c}`);
    }
    L.push('        // ----------------------------------------------------------------');
    L.push('        toutArreter();');
    L.push('    }');
    L.push('');
    if (mec) {
      L.push('    /** Translation : avantM > 0 = vers l\'avant, crabeM > 0 = vers la gauche (en mètres). */');
      L.push('    private void deplacer(double avantM, double crabeM) {');
      L.push('        double tAvant = Math.abs(avantM) * MS_PAR_METRE;');
      L.push('        double tCrabe = Math.abs(crabeM) * MS_PAR_METRE / FACTEUR_CRABE;');
      L.push('        double t = Math.max(tAvant, tCrabe);');
      L.push('        if (t < 1) return;');
      L.push('        double a = PUISSANCE_ROUES * Math.signum(avantM) * (tAvant / t);');
      L.push('        double c = PUISSANCE_ROUES * Math.signum(crabeM) * (tCrabe / t);');
      L.push('        roues(a - c, a + c, a + c, a - c);');
      L.push('        attendre((long) t);');
      L.push('        roues(0, 0, 0, 0);');
      L.push('        attendre(PAUSE_MS);');
      L.push('    }');
      L.push('');
      L.push('    /** Rotation sur place : degres > 0 = vers la gauche (sens inverse des aiguilles d\'une montre). */');
      L.push('    private void tourner(double degres) {');
      L.push('        double t = Math.abs(degres) / 180.0 * MS_POUR_180_DEG;');
      L.push('        double p = PUISSANCE_ROTATION * Math.signum(degres);');
      L.push('        roues(-p, p, -p, p);');
      L.push('        attendre((long) t);');
      L.push('        roues(0, 0, 0, 0);');
      L.push('        attendre(PAUSE_MS);');
      L.push('    }');
      L.push('');
      L.push('    private void roues(double ag, double ad, double arg, double ard) {');
      L.push('        avantGauche.setPower(ag);');
      L.push('        avantDroit.setPower(ad);');
      L.push('        arriereGauche.setPower(arg);');
      L.push('        arriereDroit.setPower(ard);');
      L.push('    }');
    } else {
      L.push('    /** Avance (mètres > 0) ou recule (mètres < 0) en ligne droite. */');
      L.push('    private void avancer(double metres) {');
      L.push('        double t = Math.abs(metres) * MS_PAR_METRE;');
      L.push('        if (t < 1) return;');
      L.push('        double p = PUISSANCE_ROUES * Math.signum(metres);');
      L.push('        roues(p, p);');
      L.push('        attendre((long) t);');
      L.push('        roues(0, 0);');
      L.push('        attendre(PAUSE_MS);');
      L.push('    }');
      L.push('');
      L.push('    /** Rotation sur place : degres > 0 = vers la gauche (sens inverse des aiguilles d\'une montre). */');
      L.push('    private void tourner(double degres) {');
      L.push('        double t = Math.abs(degres) / 180.0 * MS_POUR_180_DEG;');
      L.push('        double p = PUISSANCE_ROTATION * Math.signum(degres);');
      L.push('        roues(-p, p);');
      L.push('        attendre((long) t);');
      L.push('        roues(0, 0);');
      L.push('        attendre(PAUSE_MS);');
      L.push('    }');
      L.push('');
      L.push('    private void roues(double g, double d) {');
      L.push('        gauche.setPower(g);');
      L.push('        droit.setPower(d);');
      L.push('    }');
    }
    L.push('');
    L.push('    /** Pousse nbBalles dans le lanceur (qui doit déjà tourner). */');
    L.push('    private void tirer(int nbBalles) {');
    L.push('        alimentation.setPower(1.0);');
    L.push('        attendre(nbBalles * MS_PAR_BALLE_TIR);');
    L.push('        alimentation.setPower(0);');
    L.push('    }');
    L.push('');
    L.push('    private void attendre(long ms) {');
    L.push('        if (opModeIsActive()) sleep(ms);');
    L.push('    }');
    L.push('');
    L.push('    private void toutArreter() {');
    L.push(mec ? '        roues(0, 0, 0, 0);' : '        roues(0, 0);');
    L.push('        lanceur.setPower(0);');
    L.push('        intake.setPower(0);');
    L.push('        alimentation.setPower(0);');
    L.push('    }');
    L.push('}');
    L.push('');
    return L.join('\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
