#version 300 es
// Empathic Art — Semi-Lagrangian advection
// Traces each pixel back along the velocity field by one dt and samples
// the source texture at that back-projected coordinate. Used to advect
// both velocity (self-advection) and density (paint).
//
// Dissipation applies a mild multiplicative decay each step so the
// painting slowly fades instead of accumulating indefinitely.

precision highp float;
in vec2 vUV;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
out vec4 outColor;
void main() {
  vec2 vel = texture(uVelocity, vUV).xy;
  vec2 coord = vUV - vel * uDt * uTexel;
  vec4 result = texture(uSource, coord);
  float decay = 1.0 + uDissipation * uDt;
  outColor = result / decay;
}
