package com.qualcomm.robotcore.eventloop.opmode;
import com.qualcomm.robotcore.hardware.HardwareMap;
// Stub minimal du SDK FTC, uniquement pour vérifier que le code exporté compile.
public abstract class LinearOpMode {
  public HardwareMap hardwareMap = new HardwareMap();
  public Telemetry telemetry = new Telemetry();
  public static class Telemetry { public void addLine(String s) {} public void update() {} }
  public abstract void runOpMode() throws InterruptedException;
  public void waitForStart() {}
  public boolean isStopRequested() { return false; }
  public boolean opModeIsActive() { return true; }
  public void sleep(long ms) {}
}
