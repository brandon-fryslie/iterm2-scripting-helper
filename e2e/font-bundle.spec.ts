import { test, expect } from '@playwright/test';
import { launchApp } from './launch-app';

// [LAW:verifiable-goals] Guards iterm2-screen-font-bk4's bundling chain deterministically, with no live
// iTerm2 needed: the Screen viewport's powerline/devicon glyphs depend on a Nerd Font that must (a) vendor
// into the build, (b) load at runtime via @font-face, and (c) actually carry the icon glyphs. Each is a
// place the work can silently fail — an unpackaged asset, a wrong @font-face url, or a non-patched font —
// so each is asserted here against the real built renderer the app ships, independent of the flaky live
// path that proves the viewport integration on top of this.
test.describe('bundled terminal font', () => {
  const FAMILY = 'JetBrainsMono Nerd Font';
  const POWERLINE = '\uE0B0'; // PUA: powerline right-pointing triangle, a canonical Nerd Font glyph

  test('vendors + loads the Nerd Font and carries powerline glyphs', async () => {
    test.skip(
      process.env.CI === 'true',
      'GitHub macOS runners cannot reliably launch the Electron app; run locally.',
    );
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      // The shell mounts the settings gear unconditionally; wait on it so the renderer + its stylesheet
      // (the @font-face + --font-terminal token) are applied before we probe fonts.
      await expect(win.getByTestId('settings-gear')).toBeVisible({ timeout: 30_000 });

      // (a)+(b) Both faces resolved at runtime. document.fonts.check returns false if the woff2 didn't
      // package or the @font-face url is wrong — the precise failures the vendoring work must prevent.
      await expect(async () => {
        const loaded = await win.evaluate(async (fam) => {
          await document.fonts.ready;
          return {
            regular: document.fonts.check(`13px '${fam}'`),
            bold: document.fonts.check(`bold 13px '${fam}'`),
          };
        }, FAMILY);
        expect(loaded, `font "${FAMILY}" not loaded: ${JSON.stringify(loaded)}`).toEqual({
          regular: true,
          bold: true,
        });
      }).toPass({ timeout: 30_000, intervals: [500, 1000, 2000] });

      // The canonical terminal font stack lives once, in the --font-terminal token, and leads with the
      // bundled family. Deliberately distinct from Tailwind's reserved --font-mono token.
      const stack = await win.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--font-terminal').trim(),
      );
      expect(stack.startsWith(`'${FAMILY}'`) || stack.startsWith(`"${FAMILY}"`), `--font-terminal was "${stack}"`).toBe(
        true,
      );

      // (c) The bundled font supplies REAL outlines for the powerline codepoint, not the fallback tofu.
      // Rasterize U+E0B0 with the bundled family and with a generic-monospace reference that lacks PUA
      // glyphs; identical bitmaps would mean the bundled rendering fell back to the same tofu (font missing
      // or unpatched). A nonzero pixel delta proves the glyph rendered from the Nerd Font.
      const pixelDelta = await win.evaluate(
        (args) => {
          const raster = (font: string): Uint8ClampedArray => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('2d canvas context unavailable for glyph probe');
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#000';
            ctx.textBaseline = 'top';
            ctx.font = `48px ${font}`;
            ctx.fillText(args.ch, 4, 4);
            return ctx.getImageData(0, 0, 64, 64).data;
          };
          const a = raster(`'${args.fam}'`);
          const b = raster('monospace');
          let delta = 0;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) delta++;
          return delta;
        },
        { fam: FAMILY, ch: POWERLINE },
      );
      expect(pixelDelta, 'powerline glyph rasterized identically to the fallback — font not providing it').toBeGreaterThan(
        0,
      );
    } finally {
      await app.close();
    }
  });
});
