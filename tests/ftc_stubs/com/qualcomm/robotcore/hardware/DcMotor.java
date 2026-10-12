package com.qualcomm.robotcore.hardware;
// Stub minimal du SDK FTC, uniquement pour vérifier que le code exporté compile.
public interface DcMotor extends DcMotorSimple {
  enum ZeroPowerBehavior { BRAKE, FLOAT }
  enum RunMode { RUN_WITHOUT_ENCODER, RUN_USING_ENCODER }
  void setZeroPowerBehavior(ZeroPowerBehavior z);
  void setMode(RunMode m);
}
