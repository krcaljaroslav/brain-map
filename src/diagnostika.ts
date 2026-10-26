/**
 * Diagnostický export pro porovnání s generátorem webu mimo Obsidian (tests/porovnej-export.sh):
 * cesty uzlů z adaptéru, resolvedLinks omezené na to, co mapa vidí, verze Obsidianu a Platform.
 * Čistá funkce bez zápisu; zápis dělá příkaz pluginu v main.ts. Navíc záznam geometrie listu mapy pro zkoušku klávesnice na telefonu
 * : jen v paměti, zapíše ho týž příkaz.
 */
import { jeCestaMimoMapu, postavMapu, VYCHOZI_VYLOUCENE_SLOZKY, type RozliseneVazby, type VaultProAdapter } from './adapter.ts';
import { listyHostitele, PROMENNA_ODSAZENI, PROMENNA_PREKRYVU, prvkyMimoTok, TRIDA_LISTY_HOSTITELE, vyberListu, type DuvodNeviditelnosti } from './prostor-listu.ts';

export interface Diagnostika {
  verzeObsidianu: string;
  platform: Record<string, boolean>;
  vault: string;
  vylouceneSlozky: string[];
  uzly: string[];
  /** Cesty příloh odděleně, aby uzly a počty zachovaly A3 paritu nad poznámkami. */
  ostatniUzly: string[];
  resolvedLinks: RozliseneVazby;
  pocty: { uzly: number; vazbyAdapteru: number; resolvedLinksZdroje: number; resolvedLinksCile: number };
  /** záznam geometrie listu mapy ; doplní ho příkaz exportu v main.ts, bez textu poznámek a cest */
  geometrie?: ExportGeometrie;
}

/** resolvedLinks bez zdrojů a cílů ve skrytých a vyloučených složkách; prázdné zdroje vypadnou. */
export function omezResolvedLinks(resolvedLinks: RozliseneVazby, vyloucene: ReadonlySet<string>): RozliseneVazby {
  const omezene: RozliseneVazby = {};
  for (const [zdroj, cile] of Object.entries(resolvedLinks)) {
    if (jeCestaMimoMapu(zdroj, vyloucene)) continue;
    const cileVMape = Object.entries(cile).filter(([cil]) => !jeCestaMimoMapu(cil, vyloucene));
    if (cileVMape.length) omezene[zdroj] = Object.fromEntries(cileVMape);
  }
  return omezene;
}

/** Platform má jen booleovské vlastnosti; kopie přes JSON by vzala i případné funkce a gettery. */
function platformJakoBooleany(platform: object): Record<string, boolean> {
  return Object.fromEntries(Object.entries(platform).filter((dvojice): dvojice is [string, boolean] => typeof dvojice[1] === 'boolean'));
}

export function sestavDiagnostiku(
  vault: VaultProAdapter,
  resolvedLinks: RozliseneVazby,
  verzeObsidianu: string,
  platform: object,
  vylouceneSlozky: readonly string[] = VYCHOZI_VYLOUCENE_SLOZKY,
): Diagnostika {
  const vyloucene = new Set(vylouceneSlozky);
  const mapa = postavMapu(vault, resolvedLinks, vylouceneSlozky);
  const omezene = omezResolvedLinks(resolvedLinks, vyloucene);
  return {
    verzeObsidianu,
    platform: platformJakoBooleany(platform),
    vault: mapa.vault,
    vylouceneSlozky: [...vylouceneSlozky],
    uzly: mapa.nodes.map((uzel) => uzel[4]),
    ostatniUzly: postavMapu(vault, resolvedLinks, vylouceneSlozky, true).nodes.filter((uzel) => uzel[2] === 2).map((uzel) => uzel[4]),
    resolvedLinks: omezene,
    pocty: {
      uzly: mapa.nodes.length,
      vazbyAdapteru: mapa.links.length,
      resolvedLinksZdroje: Object.keys(omezene).length,
      resolvedLinksCile: Object.values(omezene).reduce((soucet, cile) => soucet + Object.keys(cile).length, 0),
    },
  };
}

/**
 * Záznam geometrie listu mapy pro zkoušku na telefonu : proč je list s klávesnicí
 * jen ~18 px. Kruhový buffer posledních MAX_UDALOSTI_GEOMETRIE událostí (visualViewport resize/scroll, resize okna, focusin/focusout,
 * ResizeObserver kořene, orientationchange) jen v paměti pluginu; zapíše ho až příkaz Export diagnostiky. Žádný text: z prvků jen tag
 * a třídy, bez id, atributů, hodnot polí, názvů a cest poznámek. Událost, po které se geometrie nezměnila, jen zvýší počet opakování
 * posledního záznamu (scroll viewportu by jinak buffer vyplnil).
 */
export const MAX_UDALOSTI_GEOMETRIE = 200;   // P8 b: 60 se na telefonu naplnilo a úvodní „pripojeni" vypadlo
/** Kontejner spodní lišty Obsidianu mobilu .mobile-navbar (fórum Obsidianu, proti zdroji NEOVĚŘENO, src/prostor-listu.ts); snímek nese každou s důvodem. */
export { TRIDA_LISTY_HOSTITELE };

export interface GeometriePrvku {
  role: 'platno' | 'koren' | 'contentEl' | 'predek' | 'lista';
  tag: string;
  tridy: string;
  /** getBoundingClientRect: x, y, šířka, výška (CSS px) */
  rect: number[];
  clientHeight: number;
  offsetHeight: number | null;
  height: string;
  minHeight: string;
  paddingTop: string;
  paddingBottom: string;
  boxSizing: string;
  overflow: string;
  transform: string;
  /** hodnota vlastní vlastnosti --keyboard-height (Obsidian mobil), prázdná = není */
  keyboardHeight: string;
}

/** .mobile-navbar ve snímku : efektivní opacity, důvod neviditelnosti ('' = lišta nad kořenem) a třídy předků (is-hidden-nav, is-phone…). */
export interface ListaVeSnimku extends GeometriePrvku {
  opacity: number;
  duvod: DuvodNeviditelnosti;
  /** předci od rodiče po body jako tag.třídy, oddělení „ > ", zkrácené */
  tridyPredku: string;
}

/** Prvek vyňatý z toku ve spodní polovině kořene mimo listy . */
export interface PrvekMimoTokVeSnimku {
  tag: string;
  tridy: string;
  position: string;
  rect: number[];
}

export interface SnimekGeometrie {
  /** ms od vzniku záznamu */
  cas: number;
  udalost: string;
  opakovani: number;
  dpr: number;
  screen: number[];
  orientace: string | null;
  /** innerWidth, innerHeight */
  okno: number[];
  clientHeightDokumentu: number;
  vv: { width: number; height: number; offsetTop: number; scale: number } | null;
  /** aktivní prvek: jen tag a třídy */
  aktivni: string | null;
  pripojeno: boolean;
  /** plátno, kořen, contentEl a jeho předci až po body (včetně) */
  prvky: GeometriePrvku[];
  /** každá .mobile-navbar mimo listy (src/prostor-listu.ts) s rectem, opacity, důvodem a třídami předků; prázdné = v dokumentu žádná */
  listy: ListaVeSnimku[];
  /** lišta, podle které se měří překryv (viditelná .mobile-navbar s nejvyšším vrchem); null = žádná, překryv 0 */
  listaHostitele: ListaVeSnimku | null;
  /** prvky fixed/absolute ve spodní polovině kořene mimo listy (tag, třídy, rect) - lze z nich poznat skutečnou lištu, když .mobile-navbar chybí */
  mimoTok: PrvekMimoTokVeSnimku[];
  /** P8: proměnné prostoru listu na kořeni (--mozek-odsazeni-dole, --mozek-prekryv-dole), prázdné = nenastavené */
  prostor: { odsazeniDole: string; prekryvDole: string } | null;
}

export interface ExportGeometrie {
  maxUdalosti: number;
  udalosti: SnimekGeometrie[];
  /** snímek měřeného listu v okamžiku exportu (null, když žádný list mapy není připojený) */
  ted: SnimekGeometrie | null;
}

const zaokrouhli = (cislo: number) => Math.round(cislo * 10) / 10;
const tridyPrvku = (prvek: Element) => Array.from(prvek.classList).join(' ').slice(0, 200);

export class ZaznamGeometrie {
  private udalosti: SnimekGeometrie[] = [];
  /** Připojené listy mapy v pořadí připojení : měří se poslední, který je v dokumentu; odpojení ho vyřadí. */
  private pripojene: HTMLElement[] = [];
  private readonly zacatek = typeof performance === 'undefined' ? 0 : performance.now();

  constructor(private readonly max = MAX_UDALOSTI_GEOMETRIE) {}

  /**
   * Napojí posluchače pro jeden list mapy (contentEl s kořenem .mozek-koren). registruj = registerDomEvent pohledu, takže je odebere
   * jeho unload; vrací odpojení ResizeObserveru kořene (volá onClose pohledu). Při události se jen počítá snímek do paměti.
   */
  pripoj(contentEl: HTMLElement, registruj: (cil: EventTarget, typ: string, fn: () => void) => void): () => void {
    // bez DOM (testy pohledu nad mockem listu) se nic nenapojí
    const dokument = contentEl.ownerDocument, okno = dokument?.defaultView;
    if (!dokument || !okno || typeof okno.ResizeObserver !== 'function') return () => {};
    this.pripojene.push(contentEl);
    // s více listy dostane událost okna každý z nich: zaznamená ji jen posluchač měřeného listu (jedna událost = jeden záznam)
    const zaznam = (udalost: string) => () => { if (this.mereny() === contentEl) this.zaznamenej(udalost); };
    if (okno.visualViewport) {
      registruj(okno.visualViewport, 'resize', zaznam('vv-resize'));
      registruj(okno.visualViewport, 'scroll', zaznam('vv-scroll'));
    }
    registruj(okno, 'resize', zaznam('okno-resize'));
    registruj(okno, 'orientationchange', zaznam('orientationchange'));
    registruj(dokument, 'focusin', zaznam('focusin'));
    registruj(dokument, 'focusout', zaznam('focusout'));
    const pozorovatel = new okno.ResizeObserver(zaznam('ro-koren'));
    pozorovatel.observe(contentEl.querySelector('.mozek-koren') ?? contentEl);
    this.zaznamenej('pripojeni');
    return () => {
      pozorovatel.disconnect();
      const poradi = this.pripojene.indexOf(contentEl);
      if (poradi >= 0) this.pripojene.splice(poradi, 1);
    };
  }

  /** Měřený list: poslední připojený, který je v dokumentu; null = žádný. */
  private mereny(): HTMLElement | null {
    for (let i = this.pripojene.length - 1; i >= 0; i--) if (this.pripojene[i].isConnected) return this.pripojene[i];
    return null;
  }

  zaznamenej(udalost: string): void {
    const snimek = this.snimek(udalost);
    if (!snimek) return;
    const posledni = this.udalosti[this.udalosti.length - 1];
    if (posledni && posledni.udalost === udalost && ZaznamGeometrie.klic(posledni) === ZaznamGeometrie.klic(snimek)) { posledni.opakovani++; return; }
    this.udalosti.push(snimek);
    if (this.udalosti.length > this.max) this.udalosti.splice(0, this.udalosti.length - this.max);
  }

  /** Je připojený list mapy k měření (P8 a: export bez něj nic nezapisuje). */
  maMerenyList(): boolean {
    return this.mereny() !== null;
  }

  /** Kopie bufferu a snímek teď, pro zápis příkazem Export diagnostiky. */
  export(): ExportGeometrie {
    return { maxUdalosti: this.max, udalosti: this.udalosti.map((snimek) => ({ ...snimek, prvky: snimek.prvky.map((prvek) => ({ ...prvek })) })), ted: this.snimek('export') };
  }

  private static klic(snimek: SnimekGeometrie): string {
    const { cas: _cas, opakovani: _opakovani, ...geometrie } = snimek;
    return JSON.stringify(geometrie);
  }

  private snimek(udalost: string): SnimekGeometrie | null {
    const contentEl = this.mereny(), dokument = contentEl?.ownerDocument, okno = dokument?.defaultView;
    if (!contentEl || !dokument || !okno) return null;
    const vv = okno.visualViewport, aktivni = dokument.activeElement;
    const koren = contentEl.querySelector<HTMLElement>('.mozek-koren'), platno = koren?.querySelector<HTMLElement>('.mozek-platno') ?? null;
    const listy = koren ? listyHostitele(koren, dokument) : [], lista = vyberListu(listy), mimoTok = koren ? prvkyMimoTok(koren, dokument) : [];
    const listaVeSnimku = (l: (typeof listy)[number]): ListaVeSnimku => ({ ...ZaznamGeometrie.prvek(okno, l.prvek as HTMLElement, 'lista'), opacity: Math.round(l.opacity * 1000) / 1000, duvod: l.duvod, tridyPredku: ZaznamGeometrie.tridyPredku(l.prvek) });
    const prvky: GeometriePrvku[] = [];
    if (platno) prvky.push(ZaznamGeometrie.prvek(okno, platno, 'platno'));
    for (let prvek: HTMLElement | null = koren ?? contentEl; prvek; prvek = prvek.parentElement) {
      prvky.push(ZaznamGeometrie.prvek(okno, prvek, prvek === koren ? 'koren' : prvek === contentEl ? 'contentEl' : 'predek'));
      if (prvek === dokument.body) break;
    }
    return {
      cas: Math.round(okno.performance.now() - this.zacatek),
      udalost,
      opakovani: 0,
      dpr: okno.devicePixelRatio,
      screen: [okno.screen?.width ?? 0, okno.screen?.height ?? 0],
      orientace: okno.screen?.orientation?.type ?? null,
      okno: [okno.innerWidth, okno.innerHeight],
      clientHeightDokumentu: dokument.documentElement.clientHeight,
      vv: vv ? { width: zaokrouhli(vv.width), height: zaokrouhli(vv.height), offsetTop: zaokrouhli(vv.offsetTop), scale: vv.scale } : null,
      aktivni: aktivni ? `${aktivni.tagName}${aktivni.classList.length ? `.${Array.from(aktivni.classList).join('.')}` : ''}`.slice(0, 200) : null,
      pripojeno: contentEl.isConnected,
      prvky,
      listy: listy.map(listaVeSnimku),
      listaHostitele: lista ? listaVeSnimku(lista) : null,
      mimoTok: mimoTok.map((p) => ({ tag: p.prvek.tagName, tridy: tridyPrvku(p.prvek), position: p.position, rect: [p.rect.x, p.rect.y, p.rect.width, p.rect.height].map(zaokrouhli) })),
      prostor: koren ? { odsazeniDole: koren.style.getPropertyValue(PROMENNA_ODSAZENI), prekryvDole: koren.style.getPropertyValue(PROMENNA_PREKRYVU) } : null,
    };
  }

  /** Předci od rodiče po body jako tag.třídy (bez id a textu), oddělení „ > ". */
  private static tridyPredku(prvek: Element): string {
    const casti: string[] = [];
    for (let p = prvek.parentElement; p; p = p.parentElement) { casti.push([p.tagName.toLowerCase(), ...Array.from(p.classList)].join('.')); if (p === p.ownerDocument.body) break; }
    return casti.join(' > ').slice(0, 300);
  }

  private static prvek(okno: Window, prvek: HTMLElement, role: GeometriePrvku['role']): GeometriePrvku {
    const styl = okno.getComputedStyle(prvek), obdelnik = prvek.getBoundingClientRect();
    return {
      role,
      tag: prvek.tagName,
      tridy: tridyPrvku(prvek),
      rect: [obdelnik.x, obdelnik.y, obdelnik.width, obdelnik.height].map(zaokrouhli),
      clientHeight: prvek.clientHeight,
      offsetHeight: typeof prvek.offsetHeight === 'number' ? prvek.offsetHeight : null,
      height: styl.height,
      minHeight: styl.minHeight,
      paddingTop: styl.paddingTop,
      paddingBottom: styl.paddingBottom,
      boxSizing: styl.boxSizing,
      overflow: `${styl.overflowX} ${styl.overflowY}`,
      transform: styl.transform,
      keyboardHeight: styl.getPropertyValue('--keyboard-height').trim(),
    };
  }
}
