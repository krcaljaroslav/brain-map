import { PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionRender } from 'obsidian';
import { nactiHustotu, type HustotaVazeb } from './jadro/zavislosti.ts';
import { VYCHOZI_VYLOUCENE_SLOZKY } from './adapter.ts';
import { KLICE_PALET, nazvyPalet, t } from './i18n.ts';

/**
 * Nastavení pluginu (WBS B2, PRD F6) a jeho převod na volby jádra pod klíči mozek.*. Uloženo přes saveData do data.json
 * pluginu; sbalené větve jako cesty uzlů (ne indexy: index se po změně vaultu posune na jiný uzel).
 */
export interface NastaveniMozku {
  verze: 1;
  /** Index palety jádra 0-2, výchozí 0 = Polární záře. */
  paleta: number;
  hloubka: boolean;
  zavislosti: HustotaVazeb;
  tagLinks: boolean;
  allTags: boolean;
  vylouceneTagy: string[];
  /** F9 ostatní soubory, výchozí vypnuto (uzly typu 2 dodá adaptér až v B3c). */
  ostatni: boolean;
  krouzeni: boolean;
  /** Řádek bez lomítka = jméno složky kdekoli (jako generátor webu), s lomítkem = cesta od kořene vaultu. */
  vylouceneSlozky: string[];
  /** Cesty sbalených složek; při načtení do mapy se cesta, která ve vaultu není, zahodí. */
  sbalene: string[];
  pohled: '2d' | '3d';
}

export const POCET_PALET = KLICE_PALET.length;

export function vychoziNastaveni(): NastaveniMozku {
  return {
    verze: 1,
    paleta: 0,
    hloubka: true,
    zavislosti: 0,
    tagLinks: false,
    allTags: false,
    vylouceneTagy: [],
    ostatni: false,
    krouzeni: true,
    vylouceneSlozky: [...VYCHOZI_VYLOUCENE_SLOZKY],
    sbalene: [],
    pohled: '3d',
  };
}

/** Klíče voleb jádra (src/jadro/mapa.ts KLIC); hodnoty jsou řetězce: '1'/'0', '0'-'2', JSON pole cest, '2d'/'3d'. */
export const KLIC_MAPY = {
  paleta: 'mozek.paleta',
  sbalene: 'mozek.sbalene',
  zavislosti: 'mozek.zavislosti',
  tagLinks: 'mozek.tagLinks',
  allTags: 'mozek.allTags',
  hloubka: 'mozek.hloubka',
  pohled: 'mozek.pohled',
  krouzeni: 'mozek.krouzeni',
  ostatni: 'mozek.ostatni',
} as const;

function jePoleRetezcu(hodnota: unknown): hodnota is string[] {
  return Array.isArray(hodnota) && hodnota.every((polozka) => typeof polozka === 'string');
}

/** Řádky textového pole: oříznuté, bez prázdných, bez lomítek na krajích, bez duplicit. */
export function radkyTagu(text: string): string[] { return [...new Set(text.split('\n').map(radek => radek.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))]; }

export function radkyVyloucenych(text: string): string[] {
  const radky = text.split('\n').map((radek) => radek.trim().replace(/^\/+|\/+$/g, '')).filter((radek) => radek.length > 0);
  return [...new Set(radky)];
}

/** Uložená data (loadData, i null nebo cizí tvar) → úplné nastavení; chybějící nebo neplatný klíč dostane výchozí hodnotu. */
export function nactiNastaveni(ulozena: unknown): NastaveniMozku {
  const vysledek = vychoziNastaveni();
  if (!ulozena || typeof ulozena !== 'object') return vysledek;
  const d = ulozena as Record<string, unknown>;
  if (typeof d.paleta === 'number' && Number.isInteger(d.paleta) && d.paleta >= 0 && d.paleta < POCET_PALET) vysledek.paleta = d.paleta;
  for (const klic of ['hloubka', 'ostatni', 'krouzeni', 'tagLinks', 'allTags'] as const) if (typeof d[klic] === 'boolean') vysledek[klic] = d[klic];
  vysledek.zavislosti = nactiHustotu(d.zavislosti);
  if (jePoleRetezcu(d.vylouceneSlozky)) vysledek.vylouceneSlozky = radkyVyloucenych(d.vylouceneSlozky.join('\n'));
  if (jePoleRetezcu(d.vylouceneTagy)) vysledek.vylouceneTagy = radkyTagu(d.vylouceneTagy.join('\n'));
  if (jePoleRetezcu(d.sbalene)) vysledek.sbalene = [...new Set(d.sbalene)];
  if (d.pohled === '2d' || d.pohled === '3d') vysledek.pohled = d.pohled;
  return vysledek;
}

/** Nastavení → hodnoty voleb jádra (vytvorMapu hodnoty i nastavVolby). */
export function hodnotyMapy(n: NastaveniMozku): Record<string, string> {
  return {
    [KLIC_MAPY.paleta]: String(n.paleta),
    [KLIC_MAPY.sbalene]: JSON.stringify(n.sbalene),
    [KLIC_MAPY.zavislosti]: String(n.zavislosti),
    [KLIC_MAPY.tagLinks]: n.tagLinks ? '1' : '0',
    [KLIC_MAPY.allTags]: n.allTags ? '1' : '0',
    [KLIC_MAPY.hloubka]: n.hloubka ? '1' : '0',
    [KLIC_MAPY.pohled]: n.pohled,
    [KLIC_MAPY.krouzeni]: n.krouzeni ? '1' : '0',
    [KLIC_MAPY.ostatni]: n.ostatni ? '1' : '0',
  };
}

function cestyZJson(hodnota: string): string[] | null {
  try {
    const pole: unknown = JSON.parse(hodnota);
    return jePoleRetezcu(pole) ? [...new Set(pole)] : null;
  } catch {
    return null;
  }
}

/**
 * Změna volby z UI mapy (volby.uloz, hodnota null = volby.zapomen) zapsaná do nastavení. Vrací true, když se nastavení změnilo
 * (pak se ukládá). Neznámý klíč nebo neplatná hodnota nastavení nemění.
 */
export function zapisZMapy(n: NastaveniMozku, klic: string, hodnota: string | null): boolean {
  const vychozi = vychoziNastaveni();
  const pred = JSON.stringify(n);
  const prepinac = (nazev: 'hloubka' | 'ostatni' | 'krouzeni' | 'tagLinks' | 'allTags') => {
    if (hodnota === null) n[nazev] = vychozi[nazev];
    else if (hodnota === '1' || hodnota === '0') n[nazev] = hodnota === '1';
  };
  switch (klic) {
    case KLIC_MAPY.paleta: {
      const p = hodnota === null ? vychozi.paleta : Number(hodnota);
      if (Number.isInteger(p) && p >= 0 && p < POCET_PALET) n.paleta = p;
      break;
    }
    case KLIC_MAPY.sbalene: {
      const cesty = hodnota === null ? [] : cestyZJson(hodnota);
      if (cesty) n.sbalene = cesty;
      break;
    }
    case KLIC_MAPY.pohled:
      if (hodnota === null) n.pohled = vychozi.pohled;
      else if (hodnota === '2d' || hodnota === '3d') n.pohled = hodnota;
      break;
    case KLIC_MAPY.tagLinks: prepinac('tagLinks'); break;
    case KLIC_MAPY.allTags: prepinac('allTags'); break;
    case KLIC_MAPY.hloubka: prepinac('hloubka'); break;
    case KLIC_MAPY.zavislosti: n.zavislosti = nactiHustotu(hodnota); break;
    case KLIC_MAPY.ostatni: prepinac('ostatni'); break;
    case KLIC_MAPY.krouzeni: prepinac('krouzeni'); break;
    default: break;
  }
  return JSON.stringify(n) !== pred;
}

/** Zahodí sbalené cesty, které ve vaultu nejsou (kořen '' platí vždy). Vrací true, když nějakou zahodil. */
export function zahodNeexistujiciSbalene(n: NastaveniMozku, existuje: (cesta: string) => boolean): boolean {
  const zustava = n.sbalene.filter((cesta) => cesta === '' || existuje(cesta));
  if (zustava.length === n.sbalene.length) return false;
  n.sbalene = zustava;
  return true;
}

/** Co záložka nastavení potřebuje od pluginu (ne třída pluginu: main.ts importuje settings, kruh by se nehodil). */
export interface PluginProNastaveni extends Plugin {
  nastaveni: NastaveniMozku;
  /** Zapíše změnu, uloží ji a promítne do otevřených map (volby přes nastavVolby, vyloučené složky přes nastavData). */
  zmenNastaveni(zmeny: Partial<NastaveniMozku>, promitnout?: boolean): Promise<void>;
  /** Vyloučené složky se do otevřených map promítnou až po opuštění pole (každá změna přestaví strom). */
  promitniVyloucene(): void;
}

export class MozekNastaveniTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PluginProNastaveni) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionRender[] {
    const prepinac = (nazev: 'hloubka' | 'ostatni' | 'krouzeni' | 'tagLinks' | 'allTags', titulek: string, popis: string): SettingDefinitionRender => ({
      name: titulek, desc: popis,
      render: (radek) => { radek.addToggle((volba) => {
        volba.setValue(this.plugin.nastaveni[nazev]).onChange((hodnota) => this.plugin.zmenNastaveni({ [nazev]: hodnota }));
      }); },
    });
    return [
      { name: t('paleta'), desc: t('paletaPopis'), render: (radek) => { radek.addDropdown((volba) => {
        nazvyPalet().forEach((nazev, index) => { volba.addOption(String(index), nazev); });
        volba.setValue(String(this.plugin.nastaveni.paleta)).onChange((hodnota) => this.plugin.zmenNastaveni({ paleta: Number(hodnota) }));
      }); } },
      prepinac('hloubka', t('hloubka'), t('hloubkaPopis')),
      { name: t('zavislosti'), desc: t('hustotaPopis'), render: (radek) => { radek.addDropdown((volba) => {
        for (const procento of [0, 25, 50, 75, 100]) volba.addOption(String(procento), procento ? `${procento} %` : t('vazbyOff'));
        volba.setValue(String(this.plugin.nastaveni.zavislosti)).onChange((hodnota) => this.plugin.zmenNastaveni({ zavislosti: nactiHustotu(hodnota) }));
      }); } },
      prepinac('ostatni', t('ostatni'), t('ostatniPopis')),
      prepinac('krouzeni', t('krouzeni'), t('krouzeniPopis')),
      { name: t('vylouceneTagy'), desc: t('vylouceneTagyPopis'), render: (radek) => { radek.addTextArea((pole) => {
        pole.setValue(this.plugin.nastaveni.vylouceneTagy.join('\n')).onChange((text) => this.plugin.zmenNastaveni({ vylouceneTagy: radkyTagu(text) }, false));
        pole.inputEl.rows = 6;
        pole.inputEl.addEventListener('blur', () => this.plugin.promitniVyloucene());
      }); } },
      { name: t('vyloucene'), desc: t('vyloucenePopis'), render: (radek) => { radek.addTextArea((pole) => {
        pole.setValue(this.plugin.nastaveni.vylouceneSlozky.join('\n')).onChange((text) => this.plugin.zmenNastaveni({ vylouceneSlozky: radkyVyloucenych(text) }, false));
        pole.inputEl.rows = 6;
        pole.inputEl.addEventListener('blur', () => this.plugin.promitniVyloucene());
      }); } },
    ];
  }

  // Obsidian před 1.13.0 volá display(); obě API vykreslí tytéž řádky a posluchače.
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const definice of this.getSettingDefinitions()) {
      const radek = new Setting(containerEl).setName(definice.name).setDesc(definice.desc ?? '');
      definice.render(radek, undefined!);
    }
  }

  hide(): void {
    this.plugin.promitniVyloucene();
  }
}
