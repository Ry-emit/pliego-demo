# Pliego — demo

Working proof of the Pliego photography style (derived from the Ankaa style guide): full-bleed sheets with zero gap between photos, a number menu, and click-driven transitions.

Live: https://ry-emit.github.io/pliego-demo/

- Click right / left: next / previous sheet. Number menu: change section. `Esc` or the counter: contact sheet.
- 40 image slots. Drop images on the page (or use **+ Fotos**) to fill them. Locally, images placed in `fotos/` are picked up on reload when served with `python3 servir.py`.
- Plain HTML, CSS and JS. No build step.
