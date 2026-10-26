import { vytvorPrvek } from './dom-prvky.ts';
import { setCssStyles } from './css-styly.ts';
/**
 * Prostor listu pro kořen mapy : měření hostitele jen do vlastních proměnných a jedné třídy na kořeni,
 * které promítne styles.css. Nic z Obsidianu se nepředpokládá bez dokladu; co doložené není, je tu označené NEOVĚŘENO.
 * - --mozek-odsazeni-dole: spodní padding contentEl (view-content). Obsidian mobil při klávesnici zmenší app-container o výšku klávesnice
 *   a navíc dá view-content padding-bottom téže výšky (diagnostika z telefonu, snímek „ted": contentEl paddingBottom 358.4px při výšce
 *   387.8 px, kořen s height: 100 % jen 17.4 px). Kořen se o změřený padding natáhne a záporným spodním okrajem ho vrátí (styles.css).
 * - --mozek-prekryv-dole: o kolik px spodní lišta Obsidianu mobilu překrývá spodek kořene; panel detailu se o to zvedne. Lištou je
 *   jen viditelný kontejner .mobile-navbar mimo .workspace-leaf (dva nezávislé uživatelské CSS snippety z fóra Obsidianu,
 *   17. 1. a 12. 8. 2026, shodně .mobile-navbar > .mobile-navbar-actions s --navbar-height 52px a skrývání .is-hidden-nav .mobile-navbar
 *   přes transform a opacity; proti zdroji Obsidianu NEOVĚŘENO, lze změřit ze snímku diagnostiky). Žádná heuristika podle polohy
 *   ani hit-test (k1-k2 braly cizí absolute prvek, status bar i lištu s opacity 0). B5 přidává systémový spodní inset i bez DOM lišty:
 *   na mobilu se čte --safe-area-inset-bottom s fallbackem env(safe-area-inset-bottom), bere se větší z obou překryvů; PC má systémový inset 0.
 *   Hodnotu nativního insetu na konkrétním Android WebView je nutné změřit na zařízení.
 *   Viditelná = ne display none, ne visibility hidden, efektivní opacity > 0 (součin přes předky), žádný předek .is-hidden-nav, rect
 *   s plochou na obrazovce, vodorovně i svisle protíná kořen. Překryv = kořen.bottom − lišta.top z getBoundingClientRect (transform
 *   se v rectu projeví). Diagnostika (src/diagnostika.ts) navíc zaznamená každou .mobile-navbar s důvodem neviditelnosti a prvky
 *   vyňaté z toku ve spodní polovině mimo listy; chování to neovlivní.
 * - třída TRIDA_HLEDANI_S_KLAVESNICI na kořeni : dokud je otevřená klávesnice (změřený padding > 0,
 *   nebo třída klavesnice od jádra při překryvné klávesnici) a fokus je v hledání, styles.css schová panel vybraného uzlu; po zavření
 *   klávesnice se vrátí, výběr ani pohled se nemění (jádro o tom neví). Jen třída, ať se dá chování změnit bez zásahu do logiky.
 * Měří se při připojení, při změně velikosti contentEl (ResizeObserver), při resize a orientationchange okna, při resize visualViewport,
 * při pointerdown, focusin a focusout v listu, při změně třídy nebo stylu contentEl a kteréhokoli jeho předka až po html, při změně
 * třídy kořene (MutationObserver), při změně třídy nebo stylu lišty .mobile-navbar a jejích předků až po body (MutationObserver jen na
 * atributy, přepojí se při výměně lišty) a po transitionend/transitioncancel na liště nebo jejím předku (, :
 * Obsidian lištu vrací CSS přechodem opacity/transform; měření v okamžiku sundání .is-hidden-nav vidí začátek přechodu, opacity 0 nebo
 * rect mimo obrazovku, a zapsalo 0 px; bez měření po doběhnutí přechodu panel zůstal pod lištou do dalšího klepnutí nebo resize).
 * Posluchač přechodů je na dokumentu s filtrem na lištu (bublá, přežije výměnu lišty); žádný časovač. Předci: hostitel přepíná padding třídou nebo stylem (na telefonu body dostává --keyboard-height
 * a třídu keyboard-animating, diagnostika 21. 10.), MutationObserver běží ještě před rozvržením, takže proměnná kořene odpovídá
 * paddingu už v prvním rozvržení po změně; bez toho view-content přetekl a ResizeObserver hlásil „loop completed with undelivered
 * notifications" . Kořen : jádro sundá třídu klavesnice až po měření hostitele, nebo klávesnice
 * skončí jen přes visualViewport bez blur - bez přeměření by hledani-s-klavesnici zůstala a panel by se nevrátil. Každý zápis je
 * idempotentní (jen změna hodnoty, třída jen při rozdílu), takže vlastní zápis na kořen vyvolá nejvýš jedno další měření bez zápisu.
 * Připojuje se před vznikem jádra (pohled.ts): záloha pro změnu paddingu, kterou MutationObserver nevidí (pravidlo stylu bez změny
 * atributu) - pozorovatel vzniklý dřív dostane změnu contentEl dřív než pozorovatel jádra. V harnessu P8 ji MutationObserver vždy
 * předběhne, takže pořadí už žádný test nerozliší (mutace 6 z kola 1 vyřazena, viz tests/mutace-p8.sh).
 */
export const PROMENNA_ODSAZENI = '--mozek-odsazeni-dole';
export const PROMENNA_PREKRYVU = '--mozek-prekryv-dole';
export const TRIDA_HLEDANI_S_KLAVESNICI = 'hledani-s-klavesnici';
/** Kontejner spodní lišty Obsidianu mobilu (fórum Obsidianu 2026, proti zdroji NEOVĚŘENO; snímek diagnostiky nese, co se našlo). */
export const TRIDA_LISTY_HOSTITELE = 'mobile-navbar';
/** Třída předka (body), se kterou Obsidian lištu skrývá (tamtéž). */
export const TRIDA_SKRYTE_LISTY = 'is-hidden-nav';
/** Lišta hostitele neleží v žádném listu; .mobile-navbar uvnitř listu je cizí obsah. */
const VNE_LISTY = '.workspace-leaf';
export type DuvodNeviditelnosti = '' | 'display' | 'visibility' | 'opacity' | 'is-hidden-nav' | 'rect' | 'mimo-koren';

export interface Lista {
  prvek: Element;
  rect: DOMRect;
  /** efektivní průhlednost (součin opacity prvku a předků) */
  opacity: number;
  /** '' = viditelná nad kořenem, jinak první důvod, proč lištou teď není */
  duvod: DuvodNeviditelnosti;
}

/** Spodní padding contentEl v px; nečitelná nebo záporná hodnota = 0. */
export function odsazeniDole(contentEl: HTMLElement, okno: Window): number {
  const hodnota = parseFloat(okno.getComputedStyle(contentEl).paddingBottom);
  return Number.isFinite(hodnota) && hodnota > 0 ? hodnota : 0;
}

/** Efektivní opacity prvku: součin přes předky (opacity se nedědí, ale skrývá i potomky). */
export function efektivniOpacity(prvek: Element, okno: Window): number {
  let soucin = 1;
  for (let p: Element | null = prvek; p && soucin > 0; p = p.parentElement) {
    const opacity = parseFloat(okno.getComputedStyle(p).opacity);
    soucin *= Number.isFinite(opacity) ? opacity : 1;
  }
  return soucin;
}

interface Obdelnik { left: number; top: number; right: number; bottom: number }
function protinaSe(a: Obdelnik, b: Obdelnik): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

/** Proč .mobile-navbar teď lištou nad kořenem není; '' = je. */
function duvodNeviditelnosti(prvek: Element, rect: DOMRect, obdelnik: DOMRect, okno: Window): DuvodNeviditelnosti {
  const styl = okno.getComputedStyle(prvek);
  if (styl.display === 'none') return 'display';
  if (styl.visibility === 'hidden') return 'visibility';
  if (typeof prvek.closest === 'function' && prvek.closest(`.${TRIDA_SKRYTE_LISTY}`)) return 'is-hidden-nav';
  if (!(efektivniOpacity(prvek, okno) > 0)) return 'opacity';
  const obrazovka: Obdelnik = { left: 0, top: 0, right: okno.innerWidth, bottom: okno.innerHeight };
  if (rect.width <= 0 || rect.height <= 0 || !protinaSe(rect, obrazovka)) return 'rect';
  if (!protinaSe(rect, obdelnik)) return 'mimo-koren';
  return '';
}

/** Každá .mobile-navbar mimo listy a mimo kořen s rectem, opacity a důvodem; prázdné = v dokumentu žádná není. */
export function listyHostitele(koren: HTMLElement, dokument: Document): Lista[] {
  const okno = dokument.defaultView;
  if (!okno) return [];
  const obdelnik = koren.getBoundingClientRect(), nalezene: Lista[] = [];
  for (const prvek of Array.from(dokument.querySelectorAll(`.${TRIDA_LISTY_HOSTITELE}`))) {
    if (prvek === koren || koren.contains(prvek) || prvek.contains(koren)) continue;
    if (typeof prvek.closest === 'function' && prvek.closest(VNE_LISTY)) continue;
    const rect = prvek.getBoundingClientRect();
    nalezene.push({ prvek, rect, opacity: efektivniOpacity(prvek, okno), duvod: duvodNeviditelnosti(prvek, rect, obdelnik, okno) });
  }
  return nalezene;
}

/** Lišta = viditelná .mobile-navbar s nejvyšším vrchem (největší překryv); null = žádná. */
export function vyberListu(listy: readonly Lista[]): Lista | null {
  let lista: Lista | null = null;
  for (const kandidat of listy) if (kandidat.duvod === '' && (!lista || kandidat.rect.top < lista.rect.top)) lista = kandidat;
  return lista;
}

/** Samotný překryv DOM lišty; systémový inset připočítává až měření instance. */
export function prekryvDole(koren: HTMLElement, dokument: Document): number {
  return prekryvListy(koren, vyberListu(listyHostitele(koren, dokument)));
}
function prekryvListy(koren: HTMLElement, lista: Lista | null): number {
  if (!lista) return 0;
  return Math.max(0, Math.ceil(koren.getBoundingClientRect().bottom - lista.rect.top));
}

/** Prvek vyňatý z toku (fixed, absolute) ve spodní polovině kořene mimo listy a kořen: jen záznam pro měření, chování neovlivní. */
export interface PrvekMimoTok {
  prvek: Element;
  rect: DOMRect;
  position: string;
}
const SHOW_ELEMENT = 1, FILTER_ACCEPT = 1, FILTER_REJECT = 2;   // NodeFilter: v Node bez DOM globál není
export function prvkyMimoTok(koren: HTMLElement, dokument: Document, max = 30): PrvekMimoTok[] {
  const okno = dokument.defaultView, nalezene: PrvekMimoTok[] = [];
  if (!okno || !dokument.body || typeof dokument.createTreeWalker !== 'function') return nalezene;
  const obdelnik = koren.getBoundingClientRect(), stred = obdelnik.top + obdelnik.height / 2;
  const chodec = dokument.createTreeWalker(dokument.body, SHOW_ELEMENT, {
    acceptNode: (uzel) => ((uzel as Element).matches(VNE_LISTY) || uzel === koren ? FILTER_REJECT : FILTER_ACCEPT),
  });
  for (let uzel = chodec.nextNode(); uzel && nalezene.length < max; uzel = chodec.nextNode()) {
    const prvek = uzel as Element, position = okno.getComputedStyle(prvek).position;
    if (position !== 'fixed' && position !== 'absolute') continue;
    const rect = prvek.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.top <= stred || rect.top >= obdelnik.bottom) continue;
    nalezene.push({ prvek, rect, position });
  }
  return nalezene;
}

/** Otevřená klávesnice (změřený padding hostitele, nebo třída klavesnice od jádra) a fokus v hledání mapy. */
export function hledaniSKlavesnici(koren: HTMLElement, dokument: Document, odsazeni: number): boolean {
  if (!(odsazeni > 0 || koren.classList.contains('klavesnice'))) return false;
  const hledani = koren.querySelector('.hledani'), aktivni = dokument.activeElement;
  return !!hledani && !!aktivni && hledani.contains(aktivni);
}

export interface ProstorListu {
  /** změří hned (pohled po vzniku jádra: pozorovatel hlásí až změnu) */
  zmer(): void;
  /** odpojí pozorovatele (onClose pohledu); posluchače odebere unload přes registruj */
  odpoj(): void;
}

/**
 * Napojí měření pro jeden list (contentEl; kořen .mozek-koren v něm vznikne až jádrem, hledá se při každém měření). registruj =
 * registerDomEvent pohledu. Bez DOM (testy pohledu nad mockem listu) se nic nenapojí.
 */
export function pripojProstorListu(contentEl: HTMLElement, registruj: (cil: EventTarget, typ: string, fn: EventListener, dalsi?: AddEventListenerOptions) => void, mobil = false): ProstorListu {
  const dokument = contentEl.ownerDocument, okno = dokument?.defaultView;
  if (!dokument || !okno) return { zmer() {}, odpoj() {} };
  const insetSonda = vytvorPrvek(dokument, 'div');
  insetSonda.setAttribute('aria-hidden', 'true');
  insetSonda.setAttribute('class', 'mozek-inset-sonda');
  setCssStyles(insetSonda, { position: 'absolute', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none', paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))' });
  if (mobil) contentEl.append(insetSonda);
  const nastav = (koren: HTMLElement, promenna: string, hodnota: string) => { if (koren.style.getPropertyValue(promenna) !== hodnota) koren.style.setProperty(promenna, hodnota); };
  let mutaceKorene: MutationObserver | null = null, pozorovanyKoren: HTMLElement | null = null;
  // lišty hostitele : atributy každé .mobile-navbar mimo listy a jejích předků, které nesleduje už pozorovatel předků listu
  let mutaceList: MutationObserver | null = null, pozorovaneListy: Element[] = [];
  const predciListu = new Set<Element>();
  const volbyAtributu: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'style'] };
  const prepojListy = (prvky: Element[]) => {
    if (!mutaceList || (prvky.length === pozorovaneListy.length && prvky.every((p, i) => p === pozorovaneListy[i]))) return;
    mutaceList.disconnect();
    for (const lista of prvky) for (let p: Element | null = lista; p && !predciListu.has(p); p = p.parentElement) mutaceList.observe(p, volbyAtributu);
    pozorovaneListy = prvky;
  };
  const zmer = () => {
    const koren = contentEl.querySelector<HTMLElement>('.mozek-koren');
    if (!koren || !koren.isConnected) return;
    if (mutaceKorene && pozorovanyKoren !== koren) {
      // kořen vzniká jádrem až po připojení (a po novém jádru znovu): třída klavesnice od jádra je vstup měření, ne jen padding hostitele
      if (pozorovanyKoren) mutaceKorene.disconnect();
      mutaceKorene.observe(koren, { attributes: true, attributeFilter: ['class'] });
      pozorovanyKoren = koren;
    }
    const odsazeni = odsazeniDole(contentEl, okno);
    nastav(koren, PROMENNA_ODSAZENI, `${odsazeni}px`);
    const listy = listyHostitele(koren, dokument);
    prepojListy(listy.map((l) => l.prvek));
    nastav(koren, PROMENNA_PREKRYVU, `${Math.max(prekryvListy(koren, vyberListu(listy)), mobil ? Math.max(0, koren.getBoundingClientRect().bottom - (okno.innerHeight - odsazeniDole(insetSonda, okno))) : 0)}px`);
    const skryt = hledaniSKlavesnici(koren, dokument, odsazeni);
    if (koren.classList.contains(TRIDA_HLEDANI_S_KLAVESNICI) !== skryt) koren.classList.toggle(TRIDA_HLEDANI_S_KLAVESNICI, skryt);
  };
  registruj(okno, 'resize', zmer);
  registruj(okno, 'orientationchange', zmer);
  if (okno.visualViewport) registruj(okno.visualViewport, 'resize', zmer);
  registruj(contentEl, 'pointerdown', zmer, { capture: true, passive: true });
  registruj(contentEl, 'focusin', zmer);
  registruj(contentEl, 'focusout', zmer);
  // konec nebo zrušení CSS přechodu lišty hostitele nebo jejího předka (cíl události obsahuje lištu, nebo v ní leží); vlastní obsah
  // listu se neměří tudy (jeho přechody lištu nemění). Bublá z lišty, takže přežije výměnu prvku lišty; odpoj() ho odebere.
  const poPrechodu = (udalost: Event) => {
    const cil = udalost.target;
    if (!(cil instanceof okno.Element) || contentEl.contains(cil)) return;
    if (cil.closest(`.${TRIDA_LISTY_HOSTITELE}`) || cil.querySelector(`.${TRIDA_LISTY_HOSTITELE}`)) zmer();
  };
  const typyPrechodu = ['transitionend', 'transitioncancel'];
  for (const typ of typyPrechodu) registruj(dokument, typ, poPrechodu, { capture: true, passive: true });
  let pozorovatel: ResizeObserver | null = null;
  if (typeof okno.ResizeObserver === 'function') {
    pozorovatel = new okno.ResizeObserver(zmer);
    pozorovatel.observe(contentEl);
  }
  // třída nebo styl html, body a každého předka listu (kde Obsidian padding přepíná, je NEOVĚŘENO: diagnostika dokládá --keyboard-height
  // a keyboard-animating na body); třída kořene zvlášť (jen class: styl kořene píše tohle měření samo)
  let mutace: MutationObserver | null = null;
  if (typeof okno.MutationObserver === 'function') {
    mutace = new okno.MutationObserver(zmer);
    const volby: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'style'] };
    for (let prvek: Element | null = contentEl; prvek; prvek = prvek.parentElement) { mutace.observe(prvek, volby); predciListu.add(prvek); }
    mutaceKorene = new okno.MutationObserver(zmer);
    mutaceList = new okno.MutationObserver(zmer);
  }
  return {
    zmer,
    odpoj() {
      insetSonda.remove();
      pozorovatel?.disconnect(); mutace?.disconnect(); mutaceKorene?.disconnect(); mutaceList?.disconnect();
      for (const typ of typyPrechodu) dokument.removeEventListener(typ, poPrechodu, { capture: true });
    },
  };
}
