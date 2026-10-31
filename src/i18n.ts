import { vychoziTextyHistorie, type TextyHistorie } from './jadro/texty-mapy.ts';
import { vychoziTextyMapy, type TextyMapy } from './jadro/texty-mapy.ts';

const EN = {
  nazevPohledu: 'Brain Map',
  prikazOtevrit: 'Open map',
  prikazObnovit: 'Refresh map',
  prikazExport: 'Export diagnostics',
  obnovit: 'Refresh map from vault',
  obnovitNicNeniOtevreno: 'Brain Map: no map is open',
  obnovitSelhalo: 'Brain Map: refreshing the map failed',
  ulozeniSelhalo: 'Brain Map: settings could not be saved',
  exportSelhal: 'Brain Map: diagnostics export failed',
  exportBezMapy: 'Brain Map: no map is open, nothing to export',
  diagnostikaZapsana: 'Brain Map: diagnostics written to {cesta}, geometry to note {poznamka}',
  manifestDirChybi: 'manifest.dir is missing, the plugin folder is unknown',
  souborChybi: 'Brain Map: file {cesta} is not in the vault (the map is older than the vault)',
  otevreniSelhalo: 'Brain Map: the note could not be opened',
  paleta: 'Palette',
  paletaPopis: 'Colours of the map branches.',
  paleta0: 'Aurora',
  paleta1: 'Neon night',
  paleta2: 'Coral and amber',
  hloubka: 'Depth (3D)',
  hloubkaPopis: 'Same as the switch in the map settings (2D view).',
  zavislosti: 'Dependencies',
  hustotaPopis: 'Share of dependencies with an endpoint in view.',
  vazbyOff: 'Off',
  ostatni: 'Other files',
  ostatniPopis: 'Adds files that are not notes to the map as well (PDF, images…).',
  krouzeni: 'Orbit when idle',
  krouzeniPopis: 'After a while without input, the 3D view rotates on its own.',
  vylouceneTagy: 'Excluded tags',
  vylouceneTagyPopis: 'One tag per line, # optional. Exact match, ignoring case. Applied when you leave the field.',
  vyloucene: 'Excluded folders',
  vyloucenePopis: 'One per line. A name without a slash excludes every folder of that name, with a slash only that path from the vault root. Applied when you leave the field.',
};

export type KlicTextu = keyof typeof EN;
export const SLOVNIK = { en: EN } as const;
export const KLICE_PALET: readonly KlicTextu[] = ['paleta0', 'paleta1', 'paleta2'];

export function t(klic: KlicTextu, parametry: Readonly<Record<string, string>> = {}): string {
 return EN[klic].replace(/\{(\w+)\}/g, (cele, jmeno: string) => parametry[jmeno] ?? cele);
}
export function nazvyPalet(): string[] { return KLICE_PALET.map(klic => t(klic)); }
export const TEXTY_MAPY_EN: TextyMapy = vychoziTextyMapy('en');
export function textyMapy(): TextyMapy { return TEXTY_MAPY_EN; }

export const TEXTY_HISTORIE_EN = vychoziTextyHistorie();
export function textyHistorie(): TextyHistorie { return TEXTY_HISTORIE_EN; }
