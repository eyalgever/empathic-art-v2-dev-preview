#version 300 es
// Empathic Art — Velocity divergence
// Computes the divergence of the velocity field using centered
// differences on the 4-neighborhood. This is the right-hand side of
// the pressure Poisson equation solved by the pressure jacobi pass.

precision highp float;
in vec2 vUV;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  float L = texture(uVelocity, vUV - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVelocity, vUV + vec2(uTexel.x, 0.0)).x;
  float B = texture(uVelocity, vUV - vec2(0.0, uTexel.y)).y;
  float T = texture(uVelocity, vUV + vec2(0.0, uTexel.y)).y;
  outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
