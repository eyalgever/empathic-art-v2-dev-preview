#version 300 es
// Empathic Art — Gradient subtraction (Helmholtz projection)
// Subtracts the pressure gradient from the velocity field to project
// it onto the space of divergence-free vector fields. This is the
// step that actually enforces incompressibility of the fluid.

precision highp float;
in vec2 vUV;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  float L = texture(uPressure, vUV - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUV + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUV - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUV + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocity, vUV).xy;
  vel -= vec2(R - L, T - B);
  outColor = vec4(vel, 0.0, 1.0);
}
