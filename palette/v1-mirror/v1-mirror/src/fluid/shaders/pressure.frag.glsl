#version 300 es
// Empathic Art — Pressure Jacobi iteration
// One Jacobi iteration of the pressure Poisson equation. Called
// repeatedly (typically 20-40 times per frame) to iteratively solve
// for the pressure field that will make the velocity field
// divergence-free after the gradient subtraction step.

precision highp float;
in vec2 vUV;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  float L = texture(uPressure, vUV - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUV + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUV - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUV + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUV).x;
  outColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
