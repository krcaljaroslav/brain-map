import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
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
  zavislosti: boolean;
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
    zavislosti: false,
    ostatni: false,
    krouzeni: true,
    vylouceneSlozky: [...VYCHOZI_VYLOUCENE_SLOZKY],
    sbalene: [],
    pohled: '2d',
  };
}

/** Klíče voleb jádra (src/jadro/mapa.ts KLIC); hodnoty jsou řetězce: '1'/'0', '0'-'2', JSON pole cest, '2d'/'3d'. */
export const KLIC_MAPY = {
  paleta: 'mozek.paleta',
  sbalene: 'mozek.sbalene',
  zavislosti: 'mozek.zavislosti',
  hloubka: 'mozek.hloubka',
  pohled: 'mozek.pohled',
  krouzeni: 'mozek.krouzeni',
  ostatni: 'mozek.ostatni',
} as const;

function jePoleRetezcu(hodnota: unknown): hodnota is string[] {
  return Array.isArray(hodnota) && hodnota.every((polozka) => typeof polozka === 'string');
}

/** Řádky textového pole: oříznuté, bez prázdných, bez lomítek na krajích, bez duplicit. */
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
  for (const klic of ['hloubka', 'zavislosti', 'ostatni', 'krouzeni'] as const) if (typeof d[klic] === 'boolean') vysledek[klic] = d[klic] as boolean;
  if (jePoleRetezcu(d.vylouceneSlozky)) vysledek.vylouceneSlozky = radkyVyloucenych(d.vylouceneSlozky.join('\n'));
  if (jePoleRetezcu(d.sbalene)) vysledek.sbalene = [...new Set(d.sbalene)];
  if (d.pohled === '2d' || d.pohled === '3d') vysledek.pohled = d.pohled;
  return vysledek;
}

/** Nastavení → hodnoty voleb jádra (vytvorMapu hodnoty i nastavVolby). */
export function hodnotyMapy(n: NastaveniMozku): Record<string, string> {
  return {
    [KLIC_MAPY.paleta]: String(n.paleta),
    [KLIC_MAPY.sbalene]: JSON.stringify(n.sbalene),
    [KLIC_MAPY.zavislosti]: n.zavislosti ? '1' : '0',
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
  const prepinac = (nazev: 'hloubka' | 'zavislosti' | 'ostatni' | 'krouzeni') => {
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
    case KLIC_MAPY.hloubka: prepinac('hloubka'); break;
    case KLIC_MAPY.zavislosti: prepinac('zavislosti'); break;
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const n = this.plugin.nastaveni;
    new Setting(containerEl).setName(t('paleta')).setDesc(t('paletaPopis')).addDropdown((volba) => {
      nazvyPalet().forEach((nazev, index) => volba.addOption(String(index), nazev));
      volba.setValue(String(n.paleta)).onChange((hodnota) => this.plugin.zmenNastaveni({ paleta: Number(hodnota) }));
    });
    const prepinac = (nazev: 'hloubka' | 'zavislosti' | 'ostatni' | 'krouzeni', titulek: string, popis: string) => {
      new Setting(containerEl).setName(titulek).setDesc(popis).addToggle((volba) => {
        volba.setValue(n[nazev]).onChange((hodnota) => this.plugin.zmenNastaveni({ [nazev]: hodnota }));
      });
    };
    prepinac('hloubka', t('hloubka'), t('hloubkaPopis'));
    prepinac('zavislosti', t('zavislosti'), t('zavislostiPopis'));
    prepinac('ostatni', t('ostatni'), t('ostatniPopis'));
    prepinac('krouzeni', t('krouzeni'), t('krouzeniPopis'));
    new Setting(containerEl).setName(t('vyloucene')).setDesc(t('vyloucenePopis')).addTextArea((pole) => {
      pole.setValue(n.vylouceneSlozky.join('\n')).onChange((text) => this.plugin.zmenNastaveni({ vylouceneSlozky: radkyVyloucenych(text) }, false));
      pole.inputEl.rows = 6;
      // posluchač patří prvku pole, zmizí s ním při dalším display(); hide() dorovná zavření záložky bez opuštění pole
      pole.inputEl.addEventListener('blur', () => this.plugin.promitniVyloucene());
    });
  }

  hide(): void {
    this.plugin.promitniVyloucene();
  }
}
