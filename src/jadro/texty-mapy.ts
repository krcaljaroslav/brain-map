// Jediný výchozí slovník mapy, nezávislý na jazyce hostitele.
export interface TextyMapy {
	popisMapy: string;
	popisMapy3d: string;
	hledat: string;
	hledatPopis: string;
	meridloTitulek: string;
	celek: string;
	detail: string;
	detailTitulek: string;
	celekTitulek: string;
	nastaveni: string;
	pohled: string;
	zavislosti: string;
	ostatni: string;
	hloubka: string;
	krouzeni: string;
	rozbalitVse: string;
	sbalitVse: string;
	obnovit: string;
	obnovitTitulek: string;
	paleta: string;
	palety: readonly string[];
	napoveda2d: string;
	napoveda3d: string;
	nacitam: string;
	zrusitVyber: string;
	zpet: string;
	dalsich(pocet: number): string;
	sbalit: string;
	rozbalit: string;
	otevritPoznamku: string;
	korenVaultu: string;
	souboru(pocet: number): string;
	odchozich: string;
	prichozich: string;
	nicNenalezeno: string;
	krivkySkryte(zobrazeno: number, celkem: number, skryto: number): string;
	krivek(celkem: number): string;
	prvniSnimek(ms: string): string;
	snimekVyberu(ms: string): string;
	nelze3d(duvod: string): string;
	bez3dVPluginu: string;
	bezWebgl: string;
	ztracenWebgl: string;
	selhalWebgl: string;
	pocitam3d: string;
	nacteniSelhalo(zprava: string): string;
	neplatnaData: string;
}

export function vychoziTextyMapy(): TextyMapy {
 return {
  popisMapy: 'Mind map of the vault',
  popisMapy3d: 'Mind map of the vault in 3D',
  hledat: 'Search notes',
  hledatPopis: 'Search the map',
  meridloTitulek: 'Meter: first frame, selection frame, memory',
  celek: 'Overview',
  detail: 'Detail',
  detailTitulek: 'Fly to the selected node',
  celekTitulek: 'Back to the whole map',
  nastaveni: 'Settings',
  pohled: 'View',
  zavislosti: 'Dependencies',
  ostatni: 'Other files',
  hloubka: 'Depth (3D)',
  krouzeni: 'Orbit when idle',
  rozbalitVse: 'Expand all',
  sbalitVse: 'Collapse all',
  obnovit: 'Refresh map',
  obnovitTitulek: 'Refresh map from vault',
  paleta: 'Palette',
  palety: ['Aurora', 'Neon night', 'Coral and amber'],
  napoveda2d: 'Click selects. Double-click or long press collapses a folder and opens a note. Wheel and two fingers zoom, dragging pans.',
  napoveda3d: 'Dragging rotates, two fingers zoom and pan (on PC the wheel, right button or Shift + drag). Tapping a point selects it and flies to it, tapping empty space clears the selection. Keys: R overview, F to selected, Esc clear, WASD + Q/E fly (Shift faster).',
  nacitam: 'Loading map…',
  zrusitVyber: 'Clear selection',
  zpet: 'Back',
  dalsich: (pocet) => `and ${pocet} more`,
  sbalit: 'Collapse',
  rozbalit: 'Expand',
  otevritPoznamku: 'Open note',
  korenVaultu: '(vault root)',
  souboru: (pocet) => pocet === 1 ? 'file' : 'files',
  odchozich: 'outgoing',
  prichozich: 'incoming',
  nicNenalezeno: 'Nothing found',
  krivkySkryte: (zobrazeno, celkem, skryto) => `${zobrazeno} of ${celkem}, ${skryto} hidden`,
  krivek: (celkem) => `${celkem} curves`,
  prvniSnimek: (ms) => `1st frame ${ms} ms`,
  snimekVyberu: (ms) => `selection ${ms} ms`,
  nelze3d: (duvod) => `3D view is not available here: ${duvod}. The map stays in 2D.`,
  bez3dVPluginu: '3D is not yet available in this plugin',
  bezWebgl: 'WebGL is unavailable',
  ztracenWebgl: 'WebGL context lost',
  selhalWebgl: 'WebGL failed: ',
  pocitam3d: 'Computing 3D layout…',
  nacteniSelhalo: (zprava) => `The map could not be loaded: ${zprava}.`,
  neplatnaData: 'invalid data shape',

 };
}
