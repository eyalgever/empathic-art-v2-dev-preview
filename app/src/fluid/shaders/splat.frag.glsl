#version 300 es
// Empathic Art — Splat / additive paint deposition
// Adds a soft radial gaussian of color at uPoint into the target
// texture. Used both to inject velocity impulses (from touch, voice
// amplitude, audio RMS peaks) and to inject color (paint) into the
// density buffer.
//
// uAspect corrects the falloff to be circular in screen space rather
// than elliptical, since the underlying sim grid can be non-square.

precision highp float;
in vec2 vUV;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;
uniform float uAspect;
out vec4 outColor;
void main() {
  vec2 p = vUV - uPoint;
  p.x *= uAspect;
  float d = dot(p, p);
  float amount = exp(-d / uRadius);
  vec3 base = texture(uTarget, vUV).xyz;
  outColor = vec4(base + amount * uColor, 1.0);
}
