package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

/*
 * AUTO BIOBUZZ généré par le simulateur "BIOBUZZ Auto IA".
 * Robot : Robot test (par défaut) (mecanum)
 * Score AUTO espéré : 41.7 pts (LEAVE oui, PARK oui, bascules espérées 1.69)
 * Durée prévue : 20.3 s sur 30 s. Fautes détectées : aucune.
 *
 * Le terrain est symétrique : ce programme marche en ROUGE comme en BLEU (placez le robot
 * au même endroit, vu depuis votre ALLIANCE AREA).
 * Placement de départ :
 *   - Repère : vous êtes dans votre ALLIANCE AREA et vous regardez le terrain.
 *   - Bord du robot le plus proche de votre alliance : 0 cm du mur de votre alliance.
 *   - Bord du robot côté droit : 8 cm du mur de droite ; côté gauche : 308 cm du mur de gauche.
 *   - Orientation : l'avant du robot regarde vers le centre du terrain (dos au mur de votre alliance).
 *
 * Pour régler le robot, ne modifiez QUE les 3 variables ci-dessous.
 */
@Autonomous(name = "BIOBUZZ IA - Robot test (par défaut)", group = "IA")
public class AutoBiobuzzIA extends LinearOpMode {

    // ================= LES 3 VARIABLES A CALIBRER =================
    /** Temps (ms) pour avancer de 1 mètre à PUISSANCE_ROUES. */
    public static double MS_PAR_METRE = 1500;
    /** Temps (ms) pour faire un demi-tour (180°) sur place à PUISSANCE_ROTATION. */
    public static double MS_POUR_180_DEG = 1200;
    /** Puissance du lanceur, de 0 à 1. */
    public static double PUISSANCE_TIR = 0.85;
    // ================================================================

    // Réglages utilisés par le simulateur (changez-les dans l'appli puis réexportez).
    static final double PUISSANCE_ROUES = 0.5;
    static final double PUISSANCE_ROTATION = 0.5;
    static final double FACTEUR_CRABE = 0.8; // vitesse en crabe / vitesse en avant
    static final long PAUSE_MS = 150;
    static final double PUISSANCE_INTAKE = 1;
    static final long MS_PAR_BALLE_TIR = 400;

    private DcMotor avantGauche, avantDroit, arriereGauche, arriereDroit;
    private DcMotor lanceur, intake, alimentation;

    @Override
    public void runOpMode() {
        avantGauche = hardwareMap.get(DcMotor.class, "frontLeft");
        avantDroit = hardwareMap.get(DcMotor.class, "frontRight");
        arriereGauche = hardwareMap.get(DcMotor.class, "backLeft");
        arriereDroit = hardwareMap.get(DcMotor.class, "backRight");
        avantGauche.setDirection(DcMotorSimple.Direction.REVERSE);
        arriereGauche.setDirection(DcMotorSimple.Direction.REVERSE);
        for (DcMotor mot : new DcMotor[]{avantGauche, avantDroit, arriereGauche, arriereDroit}) {
            mot.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
            mot.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
        }
        lanceur = hardwareMap.get(DcMotor.class, "launcher");
        intake = hardwareMap.get(DcMotor.class, "intake");
        alimentation = intake; // les balles sont poussées dans le lanceur par l'intake

        telemetry.addLine("BIOBUZZ IA prêt : vérifiez le placement de départ !");
        telemetry.update();
        waitForStart();
        if (isStopRequested()) return;

        // ----------------- Séquence trouvée par l'IA -----------------
        lanceur.setPower(PUISSANCE_TIR);   // t=0.0 s Lanceur ON
        deplacer(0.117, 0.049);   // t=0.0 s Vers position de tir
        tourner(41.5);   // t=0.3 s Vers position de tir
        deplacer(0.004, 0.013);   // t=0.8 s Vers position de tir
        tirer(4);   // t=0.9 s Tir de 4 balle(s)
        tourner(-131.5);   // t=2.5 s Vers GARDEN
        deplacer(-0.033, -0.099);   // t=3.6 s Vers GARDEN
        intake.setPower(PUISSANCE_INTAKE);   // t=3.9 s Intake ON
        deplacer(0.125, 0);   // t=3.9 s Ramassage GARDEN
        attendre(1800);   // t=4.2 s Ramasse 4 POLLEN (GARDEN)
        deplacer(-0.125, 0);   // t=6.0 s Recul
        intake.setPower(0);   // t=6.4 s Intake OFF
        deplacer(0.039, 0.094);   // t=6.4 s Vers position de tir
        tourner(23.7);   // t=6.7 s Vers position de tir
        deplacer(-1.816, 1.447);   // t=7.0 s Vers position de tir
        deplacer(-0.299, 0.361);   // t=9.9 s Vers position de tir
        tirer(4);   // t=10.7 s Tir de 4 balle(s)
        tourner(156.3);   // t=12.3 s Vers FLOWER B
        deplacer(0.085, -0.075);   // t=13.5 s Vers FLOWER B
        deplacer(0.025, 0);   // t=13.8 s Vers FLOWER B
        intake.setPower(PUISSANCE_INTAKE);   // t=14.0 s Intake ON
        deplacer(0.113, 0);   // t=14.0 s Ramassage FLOWER B
        attendre(1800);   // t=14.3 s Ramasse 4 POLLEN (FLOWER B)
        deplacer(-0.113, 0);   // t=16.1 s Recul
        intake.setPower(0);   // t=16.4 s Intake OFF
        deplacer(-0.025, 0);   // t=16.4 s Vers position de tir
        tourner(-130.3);   // t=16.6 s Vers position de tir
        deplacer(-0.594, -0.476);   // t=17.6 s Vers position de tir
        tirer(4);   // t=18.7 s Tir de 4 balle(s)
        lanceur.setPower(0);   // t=20.3 s Lanceur OFF
        // ----------------------------------------------------------------
        toutArreter();
    }

    /** Translation : avantM > 0 = vers l'avant, crabeM > 0 = vers la gauche (en mètres). */
    private void deplacer(double avantM, double crabeM) {
        double tAvant = Math.abs(avantM) * MS_PAR_METRE;
        double tCrabe = Math.abs(crabeM) * MS_PAR_METRE / FACTEUR_CRABE;
        double t = Math.max(tAvant, tCrabe);
        if (t < 1) return;
        double a = PUISSANCE_ROUES * Math.signum(avantM) * (tAvant / t);
        double c = PUISSANCE_ROUES * Math.signum(crabeM) * (tCrabe / t);
        roues(a - c, a + c, a + c, a - c);
        attendre((long) t);
        roues(0, 0, 0, 0);
        attendre(PAUSE_MS);
    }

    /** Rotation sur place : degres > 0 = vers la gauche (sens inverse des aiguilles d'une montre). */
    private void tourner(double degres) {
        double t = Math.abs(degres) / 180.0 * MS_POUR_180_DEG;
        double p = PUISSANCE_ROTATION * Math.signum(degres);
        roues(-p, p, -p, p);
        attendre((long) t);
        roues(0, 0, 0, 0);
        attendre(PAUSE_MS);
    }

    private void roues(double ag, double ad, double arg, double ard) {
        avantGauche.setPower(ag);
        avantDroit.setPower(ad);
        arriereGauche.setPower(arg);
        arriereDroit.setPower(ard);
    }

    /** Pousse nbBalles dans le lanceur (qui doit déjà tourner). */
    private void tirer(int nbBalles) {
        alimentation.setPower(1.0);
        attendre(nbBalles * MS_PAR_BALLE_TIR);
        alimentation.setPower(0);
    }

    private void attendre(long ms) {
        if (opModeIsActive()) sleep(ms);
    }

    private void toutArreter() {
        roues(0, 0, 0, 0);
        lanceur.setPower(0);
        intake.setPower(0);
        alimentation.setPower(0);
    }
}
