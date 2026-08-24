# Empathic Art v2 — dev preview

Public preview host for a single dev route from the private
[eyalgever/empathic-art-v2](https://github.com/eyalgever/empathic-art-v2)
project.

Contents: one file, `index.html`, which loads Vladimir Mandic's Human
library in the browser and runs face + 7-emotion detection on the
device camera. Nothing is uploaded anywhere; all inference stays on
the client.

Why this repo exists: iPhone Safari needs a camera-permitted URL that
doesn't strip permissions via headers. Perplexity's artifact viewer
does strip them. A public GitHub Pages host is the simplest fix.

The private v2 repo remains the source of truth. Commits here are
mirrors of `dev/human-test.html` from that repo.
