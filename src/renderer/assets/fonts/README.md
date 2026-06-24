# Bundled font — JetBrainsMono Nerd Font (Mono)

The Screen viewport (Monitor → Screen) renders a live iTerm2 session whose output
commonly contains powerline separators, devicons, and prompt symbols (starship,
powerlevel10k). A plain monospace font renders those codepoints as tofu (□). This
directory vendors a patched Nerd Font so they render as real glyphs.

## What is here

- `JetBrainsMonoNerdFontMono-Regular.woff2` — weight 400
- `JetBrainsMonoNerdFontMono-Bold.woff2` — weight 700
- `OFL.txt` — the SIL Open Font License 1.1 these fonts are distributed under

The **Mono** variant is deliberate: it forces every glyph (including the wide Nerd
Font icons) into a single fixed cell, which a terminal grid requires.

## Provenance

These are the upstream `JetBrainsMonoNerdFontMono-{Regular,Bold}.ttf` artifacts,
losslessly re-flavored from TTF to WOFF2 (smaller download, same glyph outlines).
Per the fonts' own embedded `name` table:

- Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono) — SIL OFL 1.1
- Nerd Fonts 3.4.0 glyph patch (https://github.com/ryanoasis/nerd-fonts) — MIT

To regenerate the WOFF2 from a TTF (e.g. on a Nerd Fonts version bump):

    uv run --with fonttools --with brotli python -c \
      "from fontTools.ttLib import TTFont; \
       f=TTFont('JetBrainsMonoNerdFontMono-Regular.ttf'); \
       f.flavor='woff2'; f.save('JetBrainsMonoNerdFontMono-Regular.woff2')"

## Licensing

The base font is SIL OFL 1.1 (see `OFL.txt`); the Nerd Fonts glyph patches are MIT.
Both permit bundling/redistribution inside software (including commercial), provided
the font is not sold by itself and the copyright + license notice ship alongside it —
which `OFL.txt` and this README satisfy. The Nerd Fonts MIT terms are met by the
attribution above; the patched artifact retains the upstream OFL license.
