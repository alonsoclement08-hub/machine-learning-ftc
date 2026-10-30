// Export du plan en Java pour un robot avec odométrie : Pedro Pathing v3 (API du Quickstart
// officiel : com.pedropathing.api.Paths.line / curve, Follower.follow / update / atParametricEnd).
// Le robot suit de vraies courbes et sait où il est ; les durées viennent du simulateur en mode
// « Odométrie ».
(function (root) {
  'use strict';
  const BZ = root.BZ = root.BZ || {};
  const G = BZ.G;

  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const deg = (h) => f1(G.deg(h));
  const P = (x, y, h) => `P(${f1(x)}, ${f1(y)}, ${deg(h)})`;

  // Suite d'opérations à écrire : trajets Pedro + commandes du lanceur et de l'intake.
  BZ.pedroOps = function (result, robot) {
    const ops = [];
    const done = new Set();
    const tank = robot.chassis === 'tank';
    const headingOf = (from, to) => (tank ? (Math.abs(G.wrap(Math.atan2(to.y - from.y, to.x - from.x) - from.h)) > Math.PI / 2 ? '.reverseTangent()' : '.tangent()') : null);
    for (const p of result.prims) {
      if (p.g !== undefined && result.groups && result.groups[p.g]) {
        if (done.has(p.g)) continue;
        done.add(p.g);
        const g = result.groups[p.g];
        const label = p.label || '';
        const moves = result.prims.filter((q) => q.g === p.g && q.k === 'move');
        if (!moves.length) {
          // rotation sur place
          ops.push({ op: 'path', label, code: `line(${P(g.from.x, g.from.y, g.from.h)}, ${P(g.to.x, g.to.y, g.to.h)}).linear(Math.toRadians(${deg(g.from.h)}), Math.toRadians(${f1(G.deg(g.from.h) + G.deg(G.wrap(g.to.h - g.from.h)))}))` });
          continue;
        }
        if (g.ctrl) {
          const hd = headingOf(g.from, g.to) || `.linear(Math.toRadians(${deg(g.from.h)}), Math.toRadians(${f1(G.deg(g.from.h) + G.deg(G.wrap(g.to.h - g.from.h)))}))`;
          ops.push({ op: 'path', label: label + ' (courbe)', code: `curve(${P(g.from.x, g.from.y, g.from.h)}, ${P(g.ctrl[0], g.ctrl[1], 0)}, ${P(g.to.x, g.to.y, g.to.h)})${hd}` });
          continue;
        }
        for (const m of moves) {
          const h1 = m.from.h + (m.dh || G.wrap(m.to.h - m.from.h));
          const hd = headingOf(m.from, m.to) || `.linear(Math.toRadians(${deg(m.from.h)}), Math.toRadians(${f1(G.deg(h1))}))`;
          ops.push({ op: 'path', label, code: `line(${P(m.from.x, m.from.y, m.from.h)}, ${P(m.to.x, m.to.y, m.to.h)})${hd}` });
        }
        continue;
      }
      if (p.k === 'move') ops.push({ op: 'path', label: p.label, code: `line(${P(p.from.x, p.from.y, p.from.h)}, ${P(p.to.x, p.to.y, p.to.h)}).constant(Math.toRadians(${deg(p.from.h)}))` });
      else if (p.k === 'wait') ops.push({ op: 'wait', ms: p.ms, label: p.label });
      else if (p.k === 'feed') ops.push({ op: 'feed', n: p.n, label: p.label });
      else if (['launcherOn', 'launcherOff', 'intakeOn', 'intakeOff'].indexOf(p.k) >= 0) ops.push({ op: p.k, label: p.label });
    }
    return ops;
  };

  BZ.exportPedro = function (result, robot, opts) {
    opts = opts || {};
    const className = opts.className || 'AutoBiobuzzIAPedro';
    const m = robot.moteurs;
    const feeder = m.alimentation && m.alimentation.trim() ? m.alimentation.trim() : null;
    const start = result.plan.start;
    const ops = BZ.pedroOps(result, robot);
    const L = [];
    L.push('package org.firstinspires.ftc.teamcode;');
    L.push('');
    L.push('import com.pedropathing.follower.Follower;');
    L.push('import com.pedropathing.math.Pose;');
    L.push('import com.pedropathing.paths.Path;');
    L.push('import com.qualcomm.robotcore.eventloop.opmode.Autonomous;');
    L.push('import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;');
    L.push('import com.qualcomm.robotcore.hardware.DcMotor;');
    L.push('');
    L.push('import org.firstinspires.ftc.teamcode.pedro.Constants;');
    L.push('');
    L.push('import static com.pedropathing.api.Paths.curve;');
    L.push('import static com.pedropathing.api.Paths.line;');
    L.push('');
    L.push('/*');
    L.push(' * AUTO BIOBUZZ (odométrie, Pedro Pathing v3) généré par "BIOBUZZ Auto IA".');
    L.push(` * Robot : ${robot.nom} (${robot.chassis})`);
    L.push(` * Score AUTO espéré : ${result.expected.toFixed(1)} pts · durée prévue ${result.endT.toFixed(1)} s · fautes : ${result.faults.length ? result.faults.map((f) => f.rule).join(', ') : 'aucune'}.`);
    L.push(' *');
    L.push(' * Prérequis : le Quickstart Pedro Pathing v3 (dossier TeamCode/.../pedro) réglé pour votre robot,');
    L.push(' * avec Constants.create(hardwareMap) qui renvoie votre Follower (drivetrain + localisation + Foresight).');
    L.push(' * Coordonnées : pouces, origine dans le coin du terrain (0 à 144), cap en degrés, sens');
    L.push(' * trigonométrique. Le même programme marche en ROUGE et en BLEU : le robot se repère par rapport');
    L.push(' * à sa pose de départ (placez-le au même endroit, vu depuis votre ALLIANCE AREA).');
    L.push(' * Placement de départ :');
    for (const s of opts.startText || []) L.push(' *   - ' + s);
    L.push(' */');
    L.push(`@Autonomous(name = "BIOBUZZ IA Pedro - ${robot.nom.replace(/"/g, '')}", group = "IA")`);
    L.push(`public class ${className} extends LinearOpMode {`);
    L.push('');
    L.push('    /** Puissance du lanceur, de 0 à 1. */');
    L.push(`    public static double PUISSANCE_TIR = ${robot.puissanceTir};`);
    L.push(`    static final double PUISSANCE_INTAKE = ${robot.intake.puissance};`);
    L.push(`    static final long MS_PAR_BALLE_TIR = ${robot.lanceur.msParBalle};`);
    L.push('');
    L.push('    private Follower follower;');
    L.push('    private DcMotor lanceur, intake, alimentation;');
    L.push('');
    L.push('    /** Pose en pouces depuis le centre du terrain (repère du simulateur), décalée dans le repère Pedro. */');
    L.push('    static Pose P(double x, double y, double degres) {');
    L.push('        return new Pose(x + 72, y + 72, Math.toRadians(degres));');
    L.push('    }');
    L.push('');
    L.push(`    static final Pose DEPART = ${P(start.x, start.y, start.h)};`);
    L.push('');
    L.push('    @Override');
    L.push('    public void runOpMode() {');
    L.push('        follower = Constants.create(hardwareMap);');
    L.push(`        lanceur = hardwareMap.get(DcMotor.class, "${m.lanceur}");`);
    L.push(`        intake = hardwareMap.get(DcMotor.class, "${m.intake}");`);
    L.push(feeder ? `        alimentation = hardwareMap.get(DcMotor.class, "${feeder}");` : '        alimentation = intake; // les balles sont poussées dans le lanceur par l\'intake');
    L.push('        follower.setPose(DEPART);');
    L.push('        telemetry.addLine("BIOBUZZ IA (Pedro) prêt : vérifiez le placement de départ !");');
    L.push('        telemetry.update();');
    L.push('        waitForStart();');
    L.push('        if (isStopRequested()) return;');
    L.push('        follower.setPose(DEPART);');
    L.push('');
    L.push('        // ----------------- Séquence -----------------');
    for (const o of ops) {
      const c = o.label ? '   // ' + o.label : '';
      if (o.op === 'path') L.push(`        suivre(${o.code});${c}`);
      else if (o.op === 'wait') L.push(`        attendre(${o.ms});${c}`);
      else if (o.op === 'feed') L.push(`        tirer(${o.n});${c}`);
      else if (o.op === 'launcherOn') L.push('        lanceur.setPower(PUISSANCE_TIR);');
      else if (o.op === 'launcherOff') L.push('        lanceur.setPower(0);');
      else if (o.op === 'intakeOn') L.push('        intake.setPower(PUISSANCE_INTAKE);');
      else if (o.op === 'intakeOff') L.push('        intake.setPower(0);');
    }
    L.push('        // --------------------------------------------');
    L.push('        lanceur.setPower(0);');
    L.push('        intake.setPower(0);');
    L.push('        alimentation.setPower(0);');
    L.push('        attendre(30000); // tient la position jusqu\'à la fin de l\'AUTO');
    L.push('    }');
    L.push('');
    L.push('    /** Suit un trajet jusqu\'au bout (le follower corrige la position grâce à l\'odométrie). */');
    L.push('    private void suivre(Path chemin) {');
    L.push('        follower.follow(chemin);');
    L.push('        follower.update();');
    L.push('        while (opModeIsActive() && !follower.atParametricEnd()) follower.update();');
    L.push('    }');
    L.push('');
    L.push('    /** Attend en gardant la position (le follower continue de corriger). */');
    L.push('    private void attendre(long ms) {');
    L.push('        long fin = System.currentTimeMillis() + ms;');
    L.push('        while (opModeIsActive() && System.currentTimeMillis() < fin) follower.update();');
    L.push('    }');
    L.push('');
    L.push('    /** Pousse nbBalles dans le lanceur (qui doit déjà tourner). */');
    L.push('    private void tirer(int nbBalles) {');
    L.push('        alimentation.setPower(1.0);');
    L.push('        attendre(nbBalles * MS_PAR_BALLE_TIR);');
    L.push('        alimentation.setPower(0);');
    L.push('    }');
    L.push('}');
    L.push('');
    return L.join('\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BZ;
})(typeof window !== 'undefined' ? window : globalThis);
