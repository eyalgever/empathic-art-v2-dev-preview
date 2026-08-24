#version 300 es
// Empathic Art — Display / final composite
// Composites the accumulated density (paint) over the cream surface
// tint uSurface, with a soft radial vignette that gently darkens the
// edges toward the center of the canvas. This is the only pass that
// writes to the visible framebuffer.

precision highp float;
in vec2 vUV;
uniform sampler2D uDensity;
uniform vec3 uSurface;
out vec4 outColor;
void main() {
  vec3 paint = texture(uDensity, vUV).rgb;
  // Soft-add over the cream surface, gentle vignette
  vec2 c = vUV - 0.5;
  float vg = smoothstep(0.9, 0.3, length(c));
  vec3 col = uSurface + paint * (0.85 + 0.15 * vg);
  outColor = vec4(col, 1.0);
}
