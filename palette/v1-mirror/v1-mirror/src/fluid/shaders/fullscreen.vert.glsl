#version 300 es
// Empathic Art — Fullscreen pass-through vertex shader
// Renders a fullscreen triangle/quad. Passes UV to the fragment stage.
// Used by every fluid pipeline pass (advect, splat, divergence,
// pressure, gradient, display).

in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
