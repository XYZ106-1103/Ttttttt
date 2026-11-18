import galmuri11Bold from 'galmuri/dist/Galmuri11-Bold.woff2?url';
import galmuri11 from 'galmuri/dist/Galmuri11.woff2?url';
import galmuri9 from 'galmuri/dist/Galmuri9.woff2?url';

/**
 * Register the Galmuri pixel fonts (SIL OFL 1.1, © Lee Minseo). Only the weights actually used
 * are bundled. Loading happens via the FontFace API so Phaser text can await them too.
 */
export async function loadFonts(): Promise<void> {
  const faces = [
    new FontFace('Galmuri11', `url(${galmuri11}) format('woff2')`, { weight: '400' }),
    new FontFace('Galmuri11', `url(${galmuri11Bold}) format('woff2')`, { weight: '700' }),
    new FontFace('Galmuri9', `url(${galmuri9}) format('woff2')`, { weight: '400' }),
  ];
  await Promise.all(
    faces.map(async (f) => {
      try {
        document.fonts.add(await f.load());
      } catch (err) {
        console.warn('Font failed to load', err);
      }
    }),
  );
}
