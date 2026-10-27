import { vytvorPrvek } from '../dom-prvky.ts';
// Jádro mapy Mozek jako instance (WBS B1b): vytvorMapu(kontejner, data, volby) → { destroy, nastavData, nastavVolby, … }.
// Vzniklo z referenční kopie src/jadro/mozek-kopie.js : logika rozložení a kreslení je
// beze změny, mění se jen obal - veškerý stav žije v uzávěru instance (na úrovni modulu jsou jen typy a tato funkce), DOM jen
// v kontejneru (mapa-dom.ts), posluchače přes předanou registraci (plugin: registerDomEvent) v seznamu instance, ResizeObserver
// na kontejneru, destroy() uklidí posluchače, časovač podržení, rAF, observer i plátna. Volby mají tytéž klíče mozek.*, jaké web
// držel v localStorage (hodnoty při vzniku, nastavVolby za běhu, uloz zpět hostiteli). 3D pohled vzniká importovanou továrnou v téže instanci.
// Původní popis: radiální strom na plátně, složky po soustředných úrovních (každá hloubka dál od středu)
// s relaxací po obvodu, iluze hloubky (z-souřadnice a perspektiva), sémantický zoom, vazby z wikilinků.
// Data dává adaptér vaultu ve formátu data.json webu (jen cesty a vazby, žádný text poznámek).
import { setCssStyles } from '../css-styly.ts';
import type { DataMapy, Vazba, Uzel } from '../adapter.ts';
import { vytvorPohled3d, platnaKamera3d, type Kamera3d } from './mozek3d.ts';
import { postavDom } from './mapa-dom.ts';
import { vychoziTextyMapy, type TextyMapy } from './texty-mapy.ts';

/** Registrace posluchače DOM; plugin předá registerDomEvent, bez ní jádro volá addEventListener. destroy() posluchače odebere vždy. */
export type RegistracePosluchace = (cil: EventTarget, typ: string, posluchac: EventListener, volby?: AddEventListenerOptions) => void;

/**
 * Volby a hostitel instance. `hodnoty` jsou volby při vzniku pod klíči webu: mozek.paleta ('0'-'2'), mozek.sbalene (JSON pole cest),
 * mozek.zavislosti ('1'/'0'), mozek.hloubka ('1'/'0', výchozí zapnuto), mozek.pohled ('2d'/'3d'), mozek.krouzeni ('1'/'0'),
 * mozek.ostatni ('1'/'0'). Změnu volby z UI jádro hlásí přes uloz(klic, hodnota); nastavVolby bere tytéž klíče zvenku (B2).
 */
export interface VolbyMapy {
	hodnoty?: Readonly<Record<string, string>>;
	/** Obnova dat hostitele; bez ní panel Nastavení tlačítko Obnovit nenabízí. */
	obnov?: () => void;
	/** Otevře poznámku podle původní cesty ve vaultu (dvojklik, podržení, tlačítko v panelu). */
	otevri?(cesta: string): void;
	uloz?(klic: string, hodnota: string): void;
	zapomen?(klic: string): void;
	jeTelefon?(): boolean;
	registruj?: RegistracePosluchace;
	/** Texty v mapě (B2i); chybějící klíč má výchozí anglický text (vychoziTextyMapy). */
	texty?: Partial<TextyMapy>;
	/** Uložený pohled k obnovení místo úvodního (tvar StavPohledu, neověřený); neplatný nebo s výběrem mimo data = úvodní pohled. */
	stavPohledu?: unknown;
}

/**
 * Pohled 2D a výběr pro historii navigace hostitele (Zpět v Obsidianu, P6): posun x, y a měřítko k jako vnitřní pohled jádra,
 * rozměr plátna a natažení rozložení, při kterých platil, a vybraný uzel jako cesta ve vaultu (index se s daty mění);
 * vybrany null = nic nevybráno.
 */
export interface StavPohledu { x: number; y: number; k: number; sirka: number; vyska: number; natazeni: number; vybrany: string | null; rezim?: '2d' | '3d'; kamera3d?: Kamera3d }

export interface MeridloMapy {
	prvniSnimekMs: number | null;
	snimekVyberuMs: number | null;
	pametMB: number | null;
}

export interface InstanceMapy {
	/** Ladicí getter pro harnessy (pripraveno, cesty, promitni(i) → {xy, z, s}, hloubka, pocetUzlu, pohled, rozmery, vybrany, …). */
	readonly ladeni: Record<string, unknown>;
	readonly meridlo: MeridloMapy;
	destroy(): void;
	/** Nová data (Obnovit, změna vaultu): strom, rozložení a barvy se přestaví ve stejné instanci; volby, pohled a DOM zůstanou. */
	nastavData(data: DataMapy): void;
	/** Změna voleb zvenku pod klíči mozek.*; null klíč zapomene. Mapa se přestaví ve stejné instanci, hostiteli se nic nehlásí. */
	nastavVolby(zmeny: Readonly<Record<string, string | null>>): void;
	/** Událost resolved: jen vazby, strom a rozložení zůstanou. */
	nastavVazby(links: Vazba[]): void;
	zmenVelikost(): void;
	/** Viditelnost listu podle hostitele: false = pauza (zruší čekající snímek, podržení i gesto), true = obnovení. Nulovou plochu hlídá jádro samo. */
	nastavViditelnost(viditelny: boolean): void;
	/** Pohled a výběr pro hostitele (getState); null, dokud mapa neměla plochu a nic se neobnovuje. */
	stavPohledu(): StavPohledu | null;
	/** Obnoví uložený pohled (setState po Zpět); před prvním vykreslením čeká na plochu, neplatný stav nic nezmění. */
	obnovPohled(stav: unknown): void;
}

interface Posluchac { cil: EventTarget; typ: string; fn: EventListener; volby?: AddEventListenerOptions }
interface Viditelny { id: number; x: number; y: number; r: number; alfa: number }
interface Obdelnik { x0: number; y0: number; x1: number; y1: number }
interface Let2d { od: Pohled; cil: Pohled; start: number; trvani: number; poTe(this: void): void }
interface Pohled { x: number; y: number; k: number }

// stav od hostitele (historie listu, workspace.json) je nedůvěryhodný: bez kladných konečných čísel se nepoužije (jádro i getState
// pohledu před onOpen)
export function platnyStavPohledu(stav: unknown): StavPohledu | null {
	if (!stav || typeof stav !== 'object') return null;
	const { x, y, k, sirka: s, vyska: v, natazeni: f, vybrany: cestaVyberu } = stav as StavPohledu;
	if (![x, y, k, s, v, f].every((cislo) => typeof cislo === 'number' && Number.isFinite(cislo)) || k <= 0 || s <= 0 || v <= 0 || f <= 0) return null;
	if (cestaVyberu !== null && typeof cestaVyberu !== 'string') return null;
	if ((stav as StavPohledu).rezim !== undefined && (stav as StavPohledu).rezim !== '2d' && (stav as StavPohledu).rezim !== '3d') return null;
	const kamera3d = platnaKamera3d((stav as StavPohledu).kamera3d);
	return { x, y, k, sirka: s, vyska: v, natazeni: f, vybrany: cestaVyberu, ...((stav as StavPohledu).rezim ? { rezim: (stav as StavPohledu).rezim } : {}), ...(kamera3d ? { kamera3d } : {}) };
}

export function vytvorMapu(kontejner: HTMLElement, data: DataMapy, volby: VolbyMapy = {}): InstanceMapy {
const PRAH_ROZESTUPU = 6;      // px na obrazovce: podstrom se rozkreslí po bodech, až když se potomci takhle rozestoupí
const MAX_KRIVEK = 1500;       // nejsilnějších křivek závislostí najednou
const MAX_DPR = 2;
const MAX_POPISKU = 500;
// mobilní gesta (B3): zoom dvěma prsty roste s poměrem vzdálenosti prstů umocněným na CITLIVOST_SEVRENI (web 1 = lineárně;
// 0,6 dává při obvyklém roztažení 80 → 180 px 1,63× místo 2,25×, tedy zhruba
// tři zoubky kolečka na PC (1,17× na zoubek, to zůstává). Dotyk začínající u svislého okraje obrazovky patří Obsidianu
// (swipe bočních panelů): jádro ho nezachytí ani nezačne tažení; sledování klávesnice: viditelná část kořene ve visualViewport
// menší o víc než PRAH_KLAVESNICE px = klávesnice (nebo jiné překrytí), lišta hledání se přesune do viditelné části.
const CITLIVOST_SEVRENI = 0.6;
const OKRAJ_OBSIDIANU = 24;
const PRAH_KLAVESNICE = 100;
// během držení plochy se geometrie ověřuje i bez události (klávesnice zavřená bez VV/RO události)
const KONTROLA_DRZENI_MS = 250;
const ZLATY_UHEL = Math.PI * (3 - Math.sqrt(5));
// poloměr úrovně podle hloubky složky: každá další úroveň dál od středu, skoky se zkracují, ať je celek kompaktní
const POLOMER_UROVNE = [0, 200, 345, 455, 540, 610, 668, 716, 756, 790, 818, 842];
const KROK_LISTU = [0, 18, 14, 11, 8, 6, 5, 4.5, 4];  // světové jednotky na list ve svazku podle hloubky složky (mělké svazky řidší, ať se v přehledu rozkreslí)
const OBSAZENI_OBVODU = 0.95;  // podíl obvodu úrovně, který smí zabrat minimální rozestupy; zbytek je vůle
const TAH_K_RODICI = 0.04;     // síla, kterou se složka při relaxaci vrací ke směru rodiče
const ITERACI_RELAXACE = 80;
const MIN_OBLOUK = [0, 0.3, 0.08, 0.03, 0.02];  // nejmenší oblouk složky podle hloubky (rad), ať malé větve nezmizí vedle velkých
const PERSPEKTIVA = 0.3;       // měřítko podle z: 1/(1 - z*P); blízké (z=1) 1,43×, vzdálené (z=-1) 0,77×
const ROZPTYL_Z = [0, 0.6, 0.4, 0.3, 0.22, 0.16, 0.12, 0.1, 0.08, 0.06];
const KLIC = { paleta: 'mozek.paleta', sbalene: 'mozek.sbalene', zavislosti: 'mozek.zavislosti', hloubka: 'mozek.hloubka', pohled: 'mozek.pohled', krouzeni: 'mozek.krouzeni', ostatni: 'mozek.ostatni' };
const PALETY = [
	{ barvy: ['#4df3ff', '#7cff6b', '#ff6bd6', '#ffd166', '#8c7bff', '#ff8a5b', '#5bffc2', '#ff5e7e'], vazba: '#dff6ff', ven: '#ffe9a8', dovnitr: '#9fe7ff', soubor: '#cfd8ff' },
	{ barvy: ['#ff2bd6', '#00f0ff', '#b6ff00', '#ff9f1c', '#8d6bff', '#00ff9c', '#ff4d6d', '#ffe600'], vazba: '#f3e6ff', ven: '#fff3a0', dovnitr: '#b4f0ff', soubor: '#e4d6ff' },
	{ barvy: ['#ff7b54', '#ffd93d', '#6bffb8', '#54c6ff', '#ff5fa2', '#c7ff5c', '#b28dff', '#ffb86b'], vazba: '#fff1e0', ven: '#ffe3a8', dovnitr: '#a8f0ff', soubor: '#ffe8d6' }
];
// sprity bodů podle úrovně rozostření 0 (blízko, ostré jádro) až 3 (daleko, měkké): zastávky gradientu a síla jádra
const JADRO_SPRITU = [[0.2, 0.36, 0.64, 1], [0.12, 0.3, 0.6, 0.85], [0.06, 0.26, 0.62, 0.65], [0.02, 0.2, 0.66, 0.5]];

const dokument = kontejner.ownerDocument, okno = dokument.defaultView as Window & typeof window;
const casVzniku = performance.now();
const texty: TextyMapy = { ...vychoziTextyMapy(), ...volby.texty };
const { koren, prvky } = postavDom(dokument, kontejner, texty, !!volby.obnov);
type Prvky = { 'pohled-3d': HTMLButtonElement; platno: HTMLCanvasElement; platno3d: HTMLCanvasElement; popisky3d: HTMLCanvasElement; hledat: HTMLInputElement; paleta: HTMLSelectElement; hloubka: HTMLInputElement; krouzeni: HTMLInputElement; ostatni: HTMLInputElement; zavislosti: HTMLInputElement };
const prvek = <K extends string>(id: K): K extends keyof Prvky ? Prvky[K] : HTMLElement => prvky.get(id) as K extends keyof Prvky ? Prvky[K] : HTMLElement;
const platno = prvek('platno');
const ctx = platno.getContext('2d') as CanvasRenderingContext2D;
const statika = vytvorPrvek(dokument, 'canvas');
const sctx = statika.getContext('2d') as CanvasRenderingContext2D;
// hierarchie výběru se mění jen se statickou vrstvou nebo výběrem, ne s impulzy: kreslí se jednou do vlastní vrstvy
const vrstvaHierarchie = vytvorPrvek(dokument, 'canvas'), hctx = vrstvaHierarchie.getContext('2d') as CanvasRenderingContext2D;
// životní cyklus instance (A3b, B1b): posluchače v seznamu instance (registrace přes volby.registruj, odebrání v destroy),
// uložené rAF a časovač podržení, observer kontejneru, pauza bez plochy; měřidlo pro měření na zařízení
const posluchace: Posluchac[] = [];
const registruj: RegistracePosluchace = volby.registruj ?? ((cil, typ, fn, dalsi) => { cil.addEventListener(typ, fn, dalsi); });
// volby pod klíči mozek.*: kopie hodnot při vzniku, uloz je drží v souladu s hostitelem, nastavVolby je mění zvenku
const hodnoty: Record<string, string> = { ...(volby.hodnoty ?? {}) };
let zniceno = false, pozastaveno = false, obsluhyNapojeny = false, fitHotov = false, idSnimku = 0, pozorovatel: ResizeObserver | null = null, casovacDrzeni: number | null = null;
let bezPlochy = false, skrytoHostitelem = false, zrusGesto: () => void = () => {};   // pauza = nulová plocha nebo list skrytý podle hostitele; gesto ruší napojOvladani
// klávesnice (P7): viditelná část kořene ve visualViewport (souřadnice kořene) a příznak, že plátno drží plochu před klávesnicí
let viditelnaCast = { vrch: 0, vyska: 0 }, plochaPredKlavesnici = false, kontrolaDrzeni: number | null = null;
// nezakrytá plocha listu (rozměr bez klávesnice) se drží odděleně od plátna, i přes skrytí listu;
// pomer = o kolik px se zmenšil kořen na 1 px poklesu okna nebo visualViewportu (Android adjustResize ~1, telefon z mezizkoušky ~2,
// iOS 0), aby šla po otočení odvodit nová nezakrytá výška. oknoBezKlavesnice = okno a visualViewport, při kterých jádro naposledy
// převzalo plochu bez klávesnice; klávesnice je jen zmenšení, které odpovídá jejich poklesu (resize panelu okno nemění)
let nezakryta: { sirka: number; vyska: number; pomer: number } | null = null;
let oknoBezKlavesnice = { sirka: 0, vyska: 0, vvSirka: 0, vvVyska: 0 };
const meridlo: MeridloMapy = { prvniSnimekMs: null, snimekVyberuMs: null, pametMB: null };
let meridloCekaVyber = false, ladeni: Record<string, unknown> = { pripraveno: false };
let verzeStatiky = 0, klicVrstvyVyberu = '', uzlyPopiskuVyberu: Viditelny[] = [];

// --- data a odvozené struktury ---
let zdrojovaData: DataMapy, ostatniZapnute = false, indexyZdroje: Int32Array = null!;
let pocet = 0, rodic: Int32Array, typ: Uint8Array, vaha: Float64Array, jmeno: string[], cesta: string[], hloubka: Int32Array, potomci: number[][], konecPodstromu: Int32Array, vetev: Int32Array;
let px: Float64Array, py: Float64Array, zet: Float32Array, smer: Float64Array, tloustka: Float64Array, barva: string[], barvaRgb: number[][], podCx: Float64Array, podCy: Float64Array, podR: Float64Array, podZmin: Float32Array, podZmax: Float32Array, rozestup: Float64Array, hledaciJmeno: string[], potomciKresleni: number[][];
let odchozi: number[][], prichozi: number[][], vazby: number[][] = [];
let paletaIdx = 0, sbalene = new Set<string>(), zavislostiZapnute = false, hloubkaZapnuta = true;
let otoceno = false, natazeni = 1;   // rozložení otočené o 90° a protažené na výšku pro portrétní displej
let pxZakl: Float64Array, pyZakl: Float64Array, smerZakl: Float64Array;         // základní (neotočené) rozložení, z něhož se orientace odvozuje
let fitObrazovka: number[] | null = null;       // obdélník na obrazovce, který úvodní pohled vyplnil (promítnuté body i se září)
let pohled: Pohled = { x: 0, y: 0, k: 1 }, kFit = 1, dpr = 1, sirka = 0, vyska = 0;
// obnova po Zpět (P6): stav čekající na první plochu; plocha, při které platí pohled (skrytý list hlásí nulový rozměr)
let cekajiciPohled: StavPohledu | null = platnyStavPohledu(volby.stavPohledu), plochaPohledu = [0, 0];
let viditelne: Viditelny[] = [], individualni: Uint8Array, kotva: Int32Array | null, verzeViditelnosti = 0, zavislostiCache: ReturnType<typeof spocitejZavislosti> | null = null;
let vybrany = -1, vyberVazby: ReturnType<typeof vazbyUzlu> = null!, zasahyPopisku = new Map<number, Obdelnik>(), zasahyPopiskuVyberu = new Map<number, Obdelnik>();
let statikaSpinava = true, smyckaBezi = false, let_: Let2d | null = null, posledniVykresleniMs = 0;
// 3D pohled (mozek3d.js): vlastní plátna a kamera, společný výběr, sbalení, paleta a panel; 2D stav se při přepnutí nemění
let pohled3d: ReturnType<typeof vytvorPohled3d> | null = null, pohled3dAktivni = false;
let kameraObnovy: Kamera3d | null = null;
let rezimObnovy = cekajiciPohled ? (cekajiciPohled.rezim ?? '2d') : null;
const sprity = new Map<string, HTMLCanvasElement>();
const ladeniPrepinace = { popisky: true, zavislostiKresli: true };
const sirkyTextu = new Map<string, number>();
const MAX_KUSU_VETVE = 24;
// body a normály jedné větve se počítají do stále stejných polí (alokace na každou větev stála na telefonu milisekundy)
const vetevX = new Float64Array(MAX_KUSU_VETVE + 1), vetevY = new Float64Array(MAX_KUSU_VETVE + 1), vetevNx = new Float64Array(MAX_KUSU_VETVE + 1), vetevNy = new Float64Array(MAX_KUSU_VETVE + 1);
// --- pomocné ---
function hash32(text: string) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
	return h >>> 0;
}
function odchylka(text: string, sul: string) {
	return (hash32(text + '|' + sul) / 4294967295) * 2 - 1;
}
function hexNaRgb(hex: string) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbNaHsl([r, g, b]: number[]) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h / 6, s, l];
}
function hslNaRgb([h, s, l]: number[]) {
	if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
	const kanal = (t: number) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
	return [kanal(h + 1 / 3), kanal(h), kanal(h - 1 / 3)].map((v) => Math.round(v * 255));
}
function rgbNaCss([r, g, b]: number[], a = 1) { return `rgba(${r},${g},${b},${a})`; }
function odstin(hex: string, posunH: number, posunL: number) {
	const hsl = rgbNaHsl(hexNaRgb(hex));
	hsl[0] = (hsl[0] + posunH / 360 + 1) % 1;
	hsl[2] = Math.min(0.82, Math.max(0.35, hsl[2] + posunL));
	const [r, g, b] = hslNaRgb(hsl);
	return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hladce(t: number) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
function bezDiakritiky(text: string) { return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
// volby drží instance v hodnoty a hlásí je hostiteli (plugin: paměť pluginu, od B2 saveData); bez hostitele platí jen do zavření pohledu
function uloz(klic: string, hodnota: string | number) { hodnoty[klic] = String(hodnota); if (volby.uloz) volby.uloz(klic, String(hodnota)); }
function nacti(klic: string): string | null { return hodnoty[klic] ?? null; }
// Telefon řekne hostitel (plugin: Platform.isPhone); bez něj heuristika webu: dotyk a kratší strana obrazovky pod 600 CSS px.
function jeTelefon() {
	if (volby.jeTelefon) return Boolean(volby.jeTelefon());
	const dotyk = typeof okno.matchMedia === 'function' && okno.matchMedia('(pointer: coarse)').matches;
	return dotyk && Math.min(okno.screen.width, okno.screen.height) < 600;
}

// --- sprity záře (předrenderované, kreslí se aditivně; tvrdé mají 4 úrovně rozostření podle hloubky z) ---
function sprit(klic: string, rgb: number[], tvrdy: boolean, uroven: number) {
	const cacheKlic = klic + (tvrdy ? 't' + uroven : 'm');
	if (sprity.has(cacheKlic)) return sprity.get(cacheKlic) as HTMLCanvasElement;
	const velikost = 96, plocha = vytvorPrvek(dokument, 'canvas');
	plocha.width = plocha.height = velikost;
	const c = plocha.getContext('2d') as CanvasRenderingContext2D;
	const g = c.createRadialGradient(velikost / 2, velikost / 2, 0, velikost / 2, velikost / 2, velikost / 2);
	const svetla = rgb.map((v) => Math.round(v + (255 - v) * 0.7));
	if (tvrdy) {
		const [j, m, f, sila] = JADRO_SPRITU[uroven];
		g.addColorStop(0, rgbNaCss(svetla, Math.min(1, sila + 0.2)));
		g.addColorStop(j, rgbNaCss(rgb, sila));
		g.addColorStop(m, rgbNaCss(rgb, 0.28));
		g.addColorStop(f, rgbNaCss(rgb, 0.07));
		g.addColorStop(1, rgbNaCss(rgb, 0));
	} else {
		g.addColorStop(0, rgbNaCss(rgb, 0.55));
		g.addColorStop(0.35, rgbNaCss(rgb, 0.22));
		g.addColorStop(0.7, rgbNaCss(rgb, 0.06));
		g.addColorStop(1, rgbNaCss(rgb, 0));
	}
	c.fillStyle = g;
	c.fillRect(0, 0, velikost, velikost);
	sprity.set(cacheKlic, plocha);
	return plocha;
}
function kresliZari(c: CanvasRenderingContext2D, x: number, y: number, polomer: number, rgb: number[], klic: string, tvrdy: boolean, alfa: number, uroven = 1) {
	if (alfa <= 0.004 || polomer <= 0) return;
	c.globalAlpha = alfa;
	c.drawImage(sprit(klic, rgb, tvrdy, uroven), x - polomer, y - polomer, polomer * 2, polomer * 2);
}

// --- data (hostitel je dává argumentem, žádný fetch) ---
function overData(vstup: DataMapy) {
	if (!vstup || !Array.isArray(vstup.nodes) || !Array.isArray(vstup.links)) throw new Error(texty.neplatnaData);
	return vstup;
}
function pripravStruktury(data: DataMapy) {
	// Přeznačení indexů zachová při vypnuté volbě i pořadí a číselné vazby původní mapy.
	const indexy = new Int32Array(data.nodes.length).fill(-1), uzly: Uzel[] = [];
	for (let i = 0; i < data.nodes.length; i++) {
		const [r, n, t, w, p] = data.nodes[i];
		if (t === 2 && !ostatniZapnute) continue;
		indexy[i] = uzly.length;
		uzly.push([r === null ? null : indexy[r], n, t, w, p]);
	}
	indexyZdroje = indexy;
	pocet = uzly.length;
	rodic = new Int32Array(pocet); typ = new Uint8Array(pocet); vaha = new Float64Array(pocet); hloubka = new Int32Array(pocet);
	jmeno = new Array<string>(pocet); cesta = new Array<string>(pocet); potomci = new Array<number[]>(pocet); konecPodstromu = new Int32Array(pocet);
	hledaciJmeno = new Array<string>(pocet); vetev = new Int32Array(pocet);
	for (let i = 0; i < pocet; i++) {
		const [r, n, t, w, p] = uzly[i];
		rodic[i] = r === null ? -1 : r; jmeno[i] = n; typ[i] = t; vaha[i] = w; cesta[i] = p; potomci[i] = [];
		hloubka[i] = r === null ? 0 : hloubka[r] + 1;
		vetev[i] = hloubka[i] <= 1 ? i : vetev[r!];   // hlavní větev (uzel hloubky 1), do které uzel patří
		if (r !== null) potomci[r].push(i);
		hledaciJmeno[i] = bezDiakritiky(n);
	}
	// uzly jdou v preorder pořadí, podstrom je souvislý úsek
	for (let i = pocet - 1; i >= 0; i--) {
		let konec = i + 1;
		for (const d of potomci[i]) konec = Math.max(konec, konecPodstromu[d]);
		konecPodstromu[i] = konec;
	}
	pripravVazby(data);
}
// vazby zvlášť: událost resolved v Obsidianu přestaví jen je, strom a rozložení zůstanou
function pripravVazby(data: DataMapy) {
	const odkazy = (data.links as number[][]).filter(([a, b]) => indexyZdroje[a] >= 0 && indexyZdroje[b] >= 0).map(([a, b]) => [indexyZdroje[a], indexyZdroje[b]]);
	odchozi = new Array<number[]>(pocet); prichozi = new Array<number[]>(pocet);
	for (let i = 0; i < pocet; i++) { odchozi[i] = []; prichozi[i] = []; }
	vazby = odkazy.filter(([a, b]) => a >= 0 && b >= 0 && a < pocet && b < pocet && a !== b);
	for (const [a, b] of vazby) { odchozi[a].push(b); prichozi[b].push(a); }
}


// --- rozložení (deterministické, jednou po načtení) ---
// Za koncem tabulky poloměr roste dál posledním skokem: s nulovým skokem by se pás listů dělil nulou
// a NaN by přes požadavky prolezl do celé mapy .
function polomerUrovne(h: number) {
	const n = POLOMER_UROVNE.length - 1;
	return h <= n ? POLOMER_UROVNE[h] : POLOMER_UROVNE[n] + (h - n) * (POLOMER_UROVNE[n] - POLOMER_UROVNE[n - 1]);
}
function minObloukUrovne(h: number) { return MIN_OBLOUK[Math.min(h, MIN_OBLOUK.length - 1)]; }
function rozptylZ(h: number) { return ROZPTYL_Z[Math.min(h, ROZPTYL_Z.length - 1)]; }
function krokListu(h: number) { return KROK_LISTU[Math.min(h, KROK_LISTU.length - 1)]; }
function sevri(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function rozloz() {
	px = new Float64Array(pocet); py = new Float64Array(pocet); zet = new Float32Array(pocet); smer = new Float64Array(pocet); tloustka = new Float64Array(pocet);
	podCx = new Float64Array(pocet); podCy = new Float64Array(pocet); podR = new Float64Array(pocet); rozestup = new Float64Array(pocet);
	podZmin = new Float32Array(pocet); podZmax = new Float32Array(pocet);
	for (let i = 0; i < pocet; i++) tloustka[i] = typ[i] === 0 ? 0.9 + 0.22 * Math.sqrt(vaha[i]) : 0.55;
	// volné soubory rootu: shluk ve středu
	potomci[0].filter((d) => typ[d] !== 0).forEach((d, i) => {
		const r = 11 * Math.sqrt(i + 0.6), u = i * ZLATY_UHEL + odchylka(cesta[d], 'shluk') * 0.3;
		px[d] = r * Math.cos(u); py[d] = r * Math.sin(u); smer[d] = u; zet[d] = odchylka(cesta[d], 'z') * 0.15;
	});
	const { uhel, polomer, vlevo, vpravo } = rozlozUrovne();
	rozlozListy(uhel, polomer, vlevo, vpravo);
	// kreslí se odzadu dopředu: potomci seřazení podle z (vzdálení první)
	const prazdne: number[] = [];
	potomciKresleni = new Array<number[]>(pocet);
	for (let i = 0; i < pocet; i++) potomciKresleni[i] = potomci[i].length ? potomci[i].slice().sort((a, b) => zet[a] - zet[b] || a - b) : prazdne;
	pxZakl = px.slice(); pyZakl = py.slice(); smerZakl = smer.slice();
	otoceno = false; natazeni = 1;
	spocitejObalky();
}
// Požadavek složky na obvod (rad): oblouk, který potřebuje pás vlastních listů mezi její úrovní a další,
// nejméně však součet požadavků podsložek (ty sedí na další úrovni ve stejných úhlech).
function spocitejPozadavky() {
	const pozadavek = new Float64Array(pocet);
	for (let i = pocet - 1; i >= 1; i--) {
		if (typ[i] !== 0) continue;
		const h = hloubka[i], delta = polomerUrovne(h + 1) - polomerUrovne(h), rStred = polomerUrovne(h) + 0.475 * delta;
		let listu = 0, podslozek = 0;
		for (const d of potomci[i]) { if (typ[d] !== 0) listu++; else podslozek += pozadavek[d]; }
		pozadavek[i] = Math.max(minObloukUrovne(h), 0.02 + listu * krokListu(h) ** 2 / (rStred * 0.55 * delta), podslozek);
	}
	return pozadavek;
}
// Složky po úrovních: úroveň h je kruh o poloměru POLOMER_UROVNE[h]. Složka chce sedět ve směru rodiče (sourozenci
// vedle sebe, šířka podle požadavku), pak se všechny složky úrovně relaxují po celém obvodu: kde je úzko, odstrčí se
// do volného místa i za výseč rodiče, kde je volno, zůstanou u rodiče. Pořadí po obvodu se nemění, větve se nekříží.
function rozlozUrovne() {
	const uhel = new Float64Array(pocet), polomer = new Float64Array(pocet);
	const vlevo = new Float64Array(pocet), vpravo = new Float64Array(pocet);   // volný obvod ke každé straně složky (rad)
	const pozadavek = spocitejPozadavky();
	const urovne: number[][] = [];
	for (let i = 1; i < pocet; i++) if (typ[i] === 0) (urovne[hloubka[i]] ??= []).push(i);
	uhel[0] = -Math.PI / 2 + odchylka('root', 'start') * 0.4;
	vlevo[0] = vpravo[0] = Math.PI;
	const chteny = new Float64Array(pocet), oblouk = new Float64Array(pocet);
	for (let h = 1; h < urovne.length; h++) {
		const slozky = urovne[h];
		if (!slozky || !slozky.length) continue;
		const r = polomerUrovne(h), rPred = polomerUrovne(h - 1);
		let soucet = 0;
		for (const s of slozky) soucet += pozadavek[s];
		const skala = Math.min(1, Math.PI * 2 * OBSAZENI_OBVODU / Math.max(1e-9, soucet));
		for (const s of slozky) oblouk[s] = pozadavek[s] * skala;
		// chtěný úhel: skupina sourozenců vedle sebe kolem rodiče; když se vejde do volného místa rodiče, zůstane v něm
		for (let k = 0; k < slozky.length;) {
			const p = rodic[slozky[k]], skupina = [];
			while (k < slozky.length && rodic[slozky[k]] === p) skupina.push(slozky[k++]);
			let sirkaSkupiny = 0;
			for (const s of skupina) sirkaSkupiny += oblouk[s];
			let zacatek = uhel[p] - sirkaSkupiny / 2;
			if (sirkaSkupiny < vlevo[p] + vpravo[p]) zacatek = Math.max(uhel[p] - vlevo[p], Math.min(zacatek, uhel[p] + vpravo[p] - sirkaSkupiny));
			let u = zacatek;
			for (const s of skupina) { chteny[s] = u + oblouk[s] / 2 + odchylka(cesta[s], 'uhel') * oblouk[s] * 0.15; u += oblouk[s]; }
		}
		const poradi = slozky.slice().sort((a, b) => chteny[a] - chteny[b] || a - b);
		const m = poradi.length, th = poradi.map((s) => chteny[s]), ar = poradi.map((s) => oblouk[s]);
		if (m > 1) {
			for (let it = 0; it < ITERACI_RELAXACE; it++) {
				for (let q = 0; q < m; q++) {
					const j = (q + 1) % m;
					const mezera = th[j] - th[q] + (j === 0 ? Math.PI * 2 : 0), potreba = (ar[q] + ar[j]) / 2;
					if (mezera < potreba) { const d = (potreba - mezera) / 4; th[q] -= d; th[j] += d; }
				}
				for (let q = 0; q < m; q++) th[q] += (chteny[poradi[q]] - th[q]) * TAH_K_RODICI;
			}
		}
		for (let q = 0; q < m; q++) {
			const s = poradi[q];
			uhel[s] = th[q];
			polomer[s] = r + (r - rPred) * (h === 1 ? 0.2 : 0.3) * odchylka(cesta[s], 'polomer');
			if (m > 1) {
				const pred = th[(q + m - 1) % m] - (q === 0 ? Math.PI * 2 : 0), dalsi = th[(q + 1) % m] + (q === m - 1 ? Math.PI * 2 : 0);
				vlevo[s] = (th[q] - pred) / 2; vpravo[s] = (dalsi - th[q]) / 2;
			} else { vlevo[s] = vpravo[s] = Math.PI; }
			px[s] = polomer[s] * Math.cos(uhel[s]); py[s] = polomer[s] * Math.sin(uhel[s]);
			// tečna na konci větve: mezi směrem od rodiče a paprskem od středu, s odchylkou
			const p = rodic[s], odRodice = Math.atan2(py[s] - py[p], px[s] - px[p]);
			smer[s] = Math.atan2(Math.sin(odRodice) * 0.6 + Math.sin(uhel[s]) * 0.4, Math.cos(odRodice) * 0.6 + Math.cos(uhel[s]) * 0.4) + odchylka(cesta[s], 'tecna') * 0.2;
			// hloubka z: podstrom drží u rodiče, sourozenci se liší; rozptyl s hloubkou klesá
			zet[s] = sevri(zet[p] * 0.7 + odchylka(cesta[s], 'z') * rozptylZ(h), -1, 1);
		}
	}
	return { uhel, polomer, vlevo, vpravo };
}
// Listy složky: pás mezi její úrovní a další, široký podle počtu listů (stálá hustota), nejvýš po volné místo složky.
// Rozmístění slunečnicovou spirálou protaženou do pásu, s drobnou odchylkou, ať nevzniká mřížka.
function rozlozListy(uhel: Float64Array, polomer: Float64Array, vlevo: Float64Array, vpravo: Float64Array) {
	for (let i = 1; i < pocet; i++) {
		if (typ[i] !== 0) continue;
		const listy = potomci[i].filter((d) => typ[d] !== 0);
		if (!listy.length) continue;
		const h = hloubka[i], delta = polomerUrovne(h + 1) - polomerUrovne(h);
		const r0 = polomer[i] + 0.2 * delta, r1 = polomer[i] + 0.75 * delta, rStred = (r0 + r1) / 2;
		const sirkaPasu = sevri(listy.length * krokListu(h) ** 2 / (rStred * (r1 - r0)), 0.012, 1.8 * Math.min(vlevo[i], vpravo[i]));
		const natoceni = odchylka(cesta[i], 'kvet') * Math.PI;
		listy.forEach((d, k) => {
			const ro = Math.sqrt((k + 0.5) / listy.length), fi = k * ZLATY_UHEL + natoceni;
			const u = 0.5 + 0.5 * ro * Math.cos(fi) + odchylka(cesta[d], 'pas-r') * 0.04;
			const v = 0.5 + 0.5 * ro * Math.sin(fi) + odchylka(cesta[d], 'pas-u') * 0.04;
			const r = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * sevri(u, 0, 1)), t = uhel[i] + sirkaPasu * (v - 0.5);
			px[d] = r * Math.cos(t); py[d] = r * Math.sin(t);
			smer[d] = Math.atan2(py[d] - py[i], px[d] - px[i]);
			zet[d] = sevri(zet[i] + odchylka(cesta[d], 'z') * 0.12, -1, 1);
		});
	}
}
// Základní rozložení je zhruba kruhové. Protáhne se podél delší strany plochy pod lištou (nejvýš STROP_NATAZENI),
// aby úvodní pohled vyplnil obrazovku; na výšku se navíc otočí o 90° (stejné pořadí větví jako na šířku, jen otočené).
// Obojí je deterministické; při změně velikosti okna se přepočítá ze základu.
const STROP_NATAZENI = 2.2;
function srovnejOrientaci() {
	const naVysku = vyska > sirka;
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (let i = 0; i < pocet; i++) { minX = Math.min(minX, pxZakl[i]); maxX = Math.max(maxX, pxZakl[i]); minY = Math.min(minY, pyZakl[i]); maxY = Math.max(maxY, pyZakl[i]); }
	const okraj = Math.min(70, Math.round(Math.min(sirka, vyska) * 0.06)), lista = 56;
	const plochaW = Math.max(1, sirka - okraj * 2), plochaH = Math.max(1, vyska - lista - okraj * 2);
	const sirkaZakl = Math.max(1e-6, maxX - minX), vyskaZakl = Math.max(1e-6, maxY - minY);
	// poměr delší / kratší strana plochy proti témuž poměru rozložení (po otočení na výšku je delší stranou původní šířka)
	const pomerPlochy = naVysku ? plochaH / plochaW : plochaW / plochaH;
	const pomerRozlozeni = naVysku ? sirkaZakl / vyskaZakl : sirkaZakl / vyskaZakl;
	let f = Math.min(STROP_NATAZENI, Math.max(1, pomerPlochy / pomerRozlozeni));
	f = Math.round(f * 1000) / 1000;
	if (naVysku === otoceno && f === natazeni) return false;
	for (let i = 0; i < pocet; i++) {
		if (naVysku) {
			px[i] = -pyZakl[i]; py[i] = pxZakl[i] * f;
			const u = smerZakl[i] + Math.PI / 2;
			smer[i] = Math.atan2(Math.sin(u) * f, Math.cos(u));
		} else {
			px[i] = pxZakl[i] * f; py[i] = pyZakl[i];
			smer[i] = Math.atan2(Math.sin(smerZakl[i]), Math.cos(smerZakl[i]) * f);
		}
	}
	otoceno = naVysku; natazeni = f;
	spocitejObalky();
	return true;
}
function spocitejObalky() {
	const sumX = new Float64Array(pocet), sumY = new Float64Array(pocet), poc = new Int32Array(pocet);
	for (let i = pocet - 1; i >= 0; i--) {
		sumX[i] += px[i]; sumY[i] += py[i]; poc[i] += 1;
		if (i > 0) { const r = rodic[i]; sumX[r] += sumX[i]; sumY[r] += sumY[i]; poc[r] += poc[i]; }
	}
	for (let i = 0; i < pocet; i++) { podCx[i] = sumX[i] / poc[i]; podCy[i] = sumY[i] / poc[i]; podR[i] = 0; podZmin[i] = zet[i]; podZmax[i] = zet[i]; }
	for (let i = pocet - 1; i >= 1; i--) {
		const r = rodic[i];
		if (podZmin[i] < podZmin[r]) podZmin[r] = podZmin[i];
		if (podZmax[i] > podZmax[r]) podZmax[r] = podZmax[i];
	}
	for (let i = 0; i < pocet; i++) {
		for (let a = i; a >= 0; a = rodic[a]) {
			const d = Math.hypot(px[i] - podCx[a], py[i] - podCy[a]);
			if (d > podR[a]) podR[a] = d;
		}
	}
	for (let i = 0; i < pocet; i++) {
		if (typ[i] !== 0) continue;
		const deti = potomci[i];
		if (deti.length === 0) { rozestup[i] = 0; continue; }
		if (deti.length === 1) { rozestup[i] = Math.hypot(px[deti[0]] - px[i], py[deti[0]] - py[i]); continue; }
		if (deti.length <= 300) {
			let soucet = 0;
			for (const a of deti) {
				let nej = Infinity;
				for (const b of deti) { if (a === b) continue; const d = Math.hypot(px[a] - px[b], py[a] - py[b]); if (d < nej) nej = d; }
				soucet += nej;
			}
			rozestup[i] = soucet / deti.length;
		} else {
			let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			for (const a of deti) { minX = Math.min(minX, px[a]); maxX = Math.max(maxX, px[a]); minY = Math.min(minY, py[a]); maxY = Math.max(maxY, py[a]); }
			rozestup[i] = Math.sqrt(((maxX - minX) + 1) * ((maxY - minY) + 1) / deti.length);
		}
	}
}
// --- barvy ---
function obarvi() {
	const paleta = PALETY[paletaIdx];
	barva = new Array<string>(pocet); barvaRgb = new Array<number[]>(pocet);
	barva[0] = '#ffffff';
	const slozkyRootu = potomci[0].filter((d) => typ[d] === 0);
	slozkyRootu.forEach((s, i) => { barva[s] = paleta.barvy[i % paleta.barvy.length]; });
	for (const d of potomci[0]) if (typ[d] !== 0) barva[d] = paleta.soubor;
	for (let i = 1; i < pocet; i++) {
		if (barva[i]) continue;
		const r = rodic[i];
		if (typ[i] !== 0 || hloubka[i] > 3) { barva[i] = barva[r]; continue; }
		const sourozenci = potomci[r].filter((d) => typ[d] === 0).sort((a, b) => vaha[b] - vaha[a] || a - b);
		const poradi = sourozenci.indexOf(i);
		if (poradi === 0) { barva[i] = barva[r]; continue; }
		const krok = hloubka[i] === 2 ? 13 : 8, znamenko = poradi % 2 ? 1 : -1, stupen = Math.ceil(poradi / 2);
		barva[i] = odstin(barva[r], znamenko * krok * stupen, (poradi % 3 - 1) * 0.06);
	}
	for (let i = 0; i < pocet; i++) {
		if (typ[i] === 2) {
			const rgb = hexNaRgb(barva[i]).map((v) => Math.round(v * 0.58));
			barva[i] = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
		}
		barvaRgb[i] = hexNaRgb(barva[i]);
	}
	sprity.clear();
}


// --- pohled a perspektiva ---
// Hloubka: každý bod má z v [-1, 1]; promítá se kolem středu plátna s měřítkem 1/(1 - z*P), takže blízké body jsou
// větší a při posunu mapy se vrstvy posouvají různě rychle (paralaxa). S vypnutou hloubkou je měřítko 1.
function meritko(z: number) { return hloubkaZapnuta ? 1 / (1 - z * PERSPEKTIVA) : 1; }
function meritkoZ(i: number) { return meritko(zet[i]); }
function jasZ(i: number) { return hloubkaZapnuta ? 0.55 + 0.225 * (zet[i] + 1) : 1; }
function urovenRozmazani(i: number) {
	if (!hloubkaZapnuta) return 1;
	const z = zet[i];
	return z < -0.45 ? 3 : z < -0.1 ? 2 : z < 0.35 ? 1 : 0;
}
function naObrazovku(wx: number, wy: number, s = 1) {
	const cx = sirka / 2, cy = vyska / 2;
	return [cx + (wx * pohled.k + pohled.x - cx) * s, cy + (wy * pohled.k + pohled.y - cy) * s];
}
// Úvodní pohled: promítnuté body (s viditelnou částí záře) vyplní plochu pod lištou s okrajem. Měřítko se hledá iterací:
// zvětšení kolem středu perspektivy je přesné, posun na střed plochy se v perspektivě dolaďuje (vrstvy se posouvají různě).
// Popisky se do ohraničení nepočítají: popisek hlavní větve míří dovnitř a žádný se nekreslí useknutý (kresliPopisky).
function prizpusobPohled() {
	const okraj = Math.min(70, Math.round(Math.min(sirka, vyska) * 0.06)), lista = 56;
	const plochaW = Math.max(1, sirka - okraj * 2), plochaH = Math.max(1, vyska - lista - okraj * 2);
	const cilX = okraj + plochaW / 2, cilY = lista + okraj + plochaH / 2, cx = sirka / 2, cy = vyska / 2;
	pohled = { k: 1, x: cx, y: cy };
	// Prázdný vault (jen kořen): rozměr je jen záře bodu v pixelech, která na měřítku nezávisí, takže by iterace
	// zvětšovala donekonečna . Kořen se jen vystředí v ploše s měřítkem 1.
	if (pocet <= 1) {
		pohled = { k: 1, x: cilX, y: cilY };
		kFit = 1;
		fitObrazovka = [cilX - 1, cilY - 1, cilX + 1, cilY + 1];
		return;
	}
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	// Počítá se jen to, co se při daném měřítku opravdu nakreslí: body rozkreslených podstromů a chomáče těch ostatních
	// (sémantický zoom nechá hluboké podstromy jako chomáč u těžiště, takže jejich krajní body by jen držely prázdný okraj).
	// Průhlednost se skládá po větvi stejně jako při kreslení; co je pod ~0,3, na obrazovce skoro není vidět a okraj nedrží.
	const alfaFitu = new Float32Array(pocet), prechod = new Float32Array(pocet);
	const VIDITELNE_OD = 0.3;
	for (let krok = 0; krok < 24; krok++) {
		minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
		const zahrn = (x: number, y: number, r: number) => { if (x - r < minX) minX = x - r; if (x + r > maxX) maxX = x + r; if (y - r < minY) minY = y - r; if (y + r > maxY) maxY = y + r; };
		for (let i = 0; i < pocet; i++) {
			const s = meritkoZ(i);
			if (i > 0) {
				const r = rodic[i];
				alfaFitu[i] = r !== 0 && sbalene.has(cesta[r]) ? 0 : alfaFitu[r] * prechod[r];
				if (alfaFitu[i] < VIDITELNE_OD) continue;
			} else alfaFitu[0] = 1;
			const [sx, sy] = naObrazovku(px[i], py[i], s);
			zahrn(sx, sy, polomerBodu(i, 1) * 1.3 * s);
			if (typ[i] !== 0) continue;
			prechod[i] = hladce((rozestup[i] * pohled.k * s - PRAH_ROZESTUPU * 0.55) / (PRAH_ROZESTUPU * 0.9));
			if (potomci[i].length && alfaFitu[i] * (1 - prechod[i]) >= VIDITELNE_OD) {
				const [cx, cy] = naObrazovku(podCx[i], podCy[i], s);
				zahrn(cx, cy, Math.min(70, Math.max(5, podR[i] * pohled.k * s * 1.15 + 3)) * 0.45);  // měkký sprit je vidět jen zhruba do poloviny poloměru
			}
		}
		const f = Math.min(plochaW / Math.max(1e-6, maxX - minX), plochaH / Math.max(1e-6, maxY - minY));
		const posunX = cilX - (minX + maxX) / 2, posunY = cilY - (minY + maxY) / 2;
		const hotovo = Math.abs(f - 1) <= 1e-4 && Math.abs(posunX) < 0.25 && Math.abs(posunY) < 0.25;
		pohled = { k: pohled.k * f, x: cx + (pohled.x - cx) * f + posunX, y: cy + (pohled.y - cy) * f + posunY };
		if (hotovo) break;
	}
	kFit = pohled.k;
	fitObrazovka = [minX, minY, maxX, maxY];
}
function omezK(k: number) { return Math.min(kFit * 6000, Math.max(kFit * 0.4, k)); }
function priblizK(bodX: number, bodY: number, faktor: number) {
	const k = omezK(pohled.k * faktor), skutecny = k / pohled.k;
	pohled.x = bodX - (bodX - pohled.x) * skutecny;
	pohled.y = bodY - (bodY - pohled.y) * skutecny;
	pohled.k = k;
	zneplatniStatiku();
}
function zmenVelikost() {
	const novyDpr = Math.min(okno.devicePixelRatio || 1, MAX_DPR), novaSirka = platno.clientWidth, novaVyska = platno.clientHeight;
	// kontejner bez plochy: nic nekreslit a nic neplánovat, žádný fallback na rozměr okna (mapa omezení ř. 215)
	bezPlochy = novaSirka === 0 || novaVyska === 0;
	prepocitejPauzu();
	if (bezPlochy) { sirka = novaSirka; vyska = novaVyska; return; }
	if (pozastaveno) return;   // list skrytý podle hostitele: rozměr se převezme až při zviditelnění (nastavViditelnost)
	if (novyDpr === dpr && novaSirka === sirka && novaVyska === vyska) return;   // ResizeObserver hlásí i stejný rozměr; nastavení width by smazalo plátno
	dpr = novyDpr; sirka = novaSirka; vyska = novaVyska; plochaPohledu = [sirka, vyska];
	if (!plochaPredKlavesnici) zapamatujOkno();   // plocha bez klávesnice: k ní se měří pokles okna 
	for (const c of [platno, statika, vrstvaHierarchie]) { c.width = Math.round(sirka * dpr); c.height = Math.round(vyska * dpr); }
	zneplatniStatiku();
}
// společná pauza pro nulovou plochu i skrytí listu hlášené hostitelem (layout-change, active-leaf-change): zruší čekající snímek,
// časovač podržení a rozpracované gesto, takže callback podržení ani dokončení letu po skrytí nic neudělají (mapa omezení ř. 213)
function prepocitejPauzu() {
	const nova = bezPlochy || skrytoHostitelem;
	if (nova === pozastaveno) return;
	pozastaveno = nova;
	if (pozastaveno) pozastav();
}
function zrusSnimek() {
	if (idSnimku) { okno.cancelAnimationFrame(idSnimku); idSnimku = 0; }
	smyckaBezi = false;
}
function pozastav() {
	pohled3d?.pozastav();
	zrusSnimek();
	let_ = null;   // let po skrytí nedoletí: jeho dokončení by vybralo uzel ve skryté mapě
	zrusDrzeni();   // podržení po skrytí nesmí otevřít poznámku ani sbalit složku
	zrusGesto();
	zastavKontroluDrzeni();   // skrytý list: kontrola držení až po zobrazení (nastavViditelnost)
}
function nastavViditelnost(viditelny: boolean) {
	if (zniceno) return;
	skrytoHostitelem = !viditelny;
	prepocitejPauzu();
	if (pozastaveno) return;
	// klávesnice se mohla během skrytí zavřít (nebo list otočit) bez události, kterou jádro vidí: držení plochy se ověří znovu 
	prepocitejViditelnouCast();
	const poNavratu = sledujKlavesnici();
	spustKontroluDrzeni();   // držení trvá i po zobrazení: kontrola pauzou zastavená běží dál 
	if (poNavratu === 'konec' || poNavratu === 'drzena') { prevezmiRozmer(); posunPlatna(); pozadujSnimek(); return; }
	posunPlatna();
	if (fitHotov) prevezmiRozmer(); else zmenVelikost();   // skrytý list se mohl i otočit; první fit dál obnoví čekající stav P6
	if (bezPlochy) return;
	if (!fitHotov) prvniFit(); else pozadujSnimek();
}

// --- statická vrstva: větve, body, chomáče, závislosti, popisky ---
function zneplatniStatiku() { statikaSpinava = true; if (pohled3dAktivni) pohled3d!.zneplatni(); pozadujSnimek(); }
function kresliStatiku() {
	const zacatek = performance.now();
	const c = sctx;
	c.setTransform(dpr, 0, 0, dpr, 0, 0);
	c.globalCompositeOperation = 'source-over';
	c.globalAlpha = 1;
	c.clearRect(0, 0, sirka, vyska);
	viditelne = [];
	individualni = new Uint8Array(pocet);
	c.lineCap = 'round'; c.lineJoin = 'round';
	c.globalCompositeOperation = 'lighter';
	projdiPodstrom(0, 1);
	let podpis = 0;
	for (let i = 0; i < pocet; i++) if (individualni[i]) podpis = (podpis * 31 + i) >>> 0;
	if (podpis !== verzeViditelnosti) { verzeViditelnosti = podpis; zavislostiCache = null; kotva = null; }
	if (zavislostiZapnute) kresliZavislosti(c);
	if (ladeniPrepinace.popisky) kresliPopisky(c);
	c.globalCompositeOperation = 'source-over';
	c.globalAlpha = 1;
	posledniVykresleniMs = performance.now() - zacatek;
	statikaSpinava = false;
	verzeStatiky++;
}
function mimoObrazovku(i: number) {
	// podstrom leží mezi průměty svého těžiště pro krajní z; pryč je, až když jsou obě koule s rezervou mimo plátno
	const sMin = meritko(podZmin[i]), sMax = meritko(podZmax[i]);
	const [x1, y1] = naObrazovku(podCx[i], podCy[i], sMin), [x2, y2] = naObrazovku(podCx[i], podCy[i], sMax);
	const r = podR[i] * pohled.k * sMax + 80;
	return Math.max(x1, x2) + r < 0 || Math.max(y1, y2) + r < 0 || Math.min(x1, x2) - r > sirka || Math.min(y1, y2) - r > vyska;
}
function polomerBodu(i: number, zoomPevny?: number) {
	const zoom = zoomPevny || Math.pow(pohled.k / kFit, 0.22);
	if (typ[i] !== 0) return Math.min(7, Math.max(1.6, 2.1 * zoom)) * (typ[i] === 2 ? 0.72 : 1);
	return Math.min(30, Math.max(3.2, (2.4 + Math.sqrt(vaha[i]) * 0.42) * zoom));
}
function projdiPodstrom(i: number, alfa: number) {
	if (alfa < 0.01 || mimoObrazovku(i)) return;
	const s = meritkoZ(i), jas = jasZ(i), rozmazani = urovenRozmazani(i);
	const [sx, sy] = naObrazovku(px[i], py[i], s);
	const r = polomerBodu(i) * s;
	const c = sctx;
	if (alfa > 0.5) individualni[i] = 1;
	viditelne.push({ id: i, x: sx, y: sy, r, alfa });
	if (typ[i] !== 0) { kresliZari(c, sx, sy, r * 2.6, barvaRgb[i], barva[i], true, alfa * 0.85 * jas, rozmazani); return; }
	kresliZari(c, sx, sy, r * 2.2, barvaRgb[i], barva[i], true, alfa * jas, rozmazani);
	if (i !== 0 && sbalene.has(cesta[i])) { kresliSbalenou(c, sx, sy, r, i, alfa * jas); return; }
	const t = hladce((rozestup[i] * pohled.k * s - PRAH_ROZESTUPU * 0.55) / (PRAH_ROZESTUPU * 0.9));
	if (t < 1) kresliChomac(c, i, alfa * (1 - t));
	if (t <= 0) return;
	const listy = [];
	for (const d of potomciKresleni[i]) {
		if (typ[d] !== 0) { listy.push(d); continue; }
		if (!mimoObrazovku(d)) kresliVetev(c, i, d, alfa * t);
		projdiPodstrom(d, alfa * t);
	}
	if (listy.length) kresliListy(c, i, listy, alfa * t);
}
// Listy jedné složky mají stejnou barvu, šířku i průhlednost, takže stopky i body jdou do jedné cesty:
// tisíce samostatných tahů byly to, co v přehledu stálo stovky milisekund. Hloubku (měřítko, jas, rozostření) berou po složce.
function kresliListy(c: CanvasRenderingContext2D, slozka: number, listy: number[], alfa: number) {
	const sSlozky = meritkoZ(slozka), jas = jasZ(slozka), rozmazani = urovenRozmazani(slozka);
	const [ax, ay] = naObrazovku(px[slozka], py[slozka], sSlozky);
	const rZakl = polomerBodu(listy[0]);
	const okraj = 20;
	const ua = slozka === 0 ? null : smer[slozka];
	const stopky = new Path2D(), body = new Path2D();
	let naPlatne = 0, rSoucet = 0;
	for (const d of listy) {
		const s = meritkoZ(d), [bx, by] = naObrazovku(px[d], py[d], s), r = rZakl * s;
		if (bx < -okraj || by < -okraj || bx > sirka + okraj || by > vyska + okraj) continue;
		naPlatne++; rSoucet += r;
		if (alfa > 0.5) individualni[d] = 1;
		viditelne.push({ id: d, x: bx, y: by, r, alfa });
		pridejStopku(stopky, ax, ay, ua, bx, by, smer[d]);
		body.moveTo(bx + r * 0.75, by);
		body.arc(bx, by, r * 0.75, 0, Math.PI * 2);
	}
	if (!naPlatne) return;
	const r = rSoucet / naPlatne, rgb = barvaRgb[listy[0]];
	// stopka listu slábne s velikostí svazku, jinak 300 stopek v aditivním režimu splyne do bílého klínu
	c.globalAlpha = alfa * jas * 0.3 * Math.min(1, 5 / Math.sqrt(listy.length));
	c.strokeStyle = barva[listy[0]];
	c.lineWidth = Math.min(28, Math.max(0.5, tloustka[listy[0]] * pohled.k * sSlozky));
	c.stroke(stopky);
	if (r * 2.6 < 7) {
		// malé body: jádro jako jedna výplň, měkká záře dvěma širšími tahy místo spritu na každý list; daleko širší a slabší
		const rozptyl = 1 + (1 - jas) * 1.2;
		c.strokeStyle = barva[listy[0]];
		c.globalAlpha = alfa * jas * 0.05; c.lineWidth = r * 3.2 * rozptyl; c.stroke(body);
		c.globalAlpha = alfa * jas * 0.14; c.lineWidth = r * 1.3 * rozptyl; c.stroke(body);
		c.globalAlpha = alfa * jas * (rozmazani >= 2 ? 0.55 : 0.75);
		c.fillStyle = rgbNaCss(rgb.map((v) => Math.round(v + (255 - v) * 0.5)), 1);
		c.fill(body);
		return;
	}
	for (const d of listy) {
		const s = meritkoZ(d), [bx, by] = naObrazovku(px[d], py[d], s);
		if (bx < -okraj || by < -okraj || bx > sirka + okraj || by > vyska + okraj) continue;
		kresliZari(c, bx, by, rZakl * s * 2.6, rgb, barva[d], true, alfa * 0.85 * jas, rozmazani);
	}
}
// stopka listu od bodu složky; cil = Path2D (svazek listů) nebo kontext (jedna podsvícená stopka ve výběru)
function pridejStopku(cil: CanvasPath, ax: number, ay: number, ua: number | null, bx: number, by: number, ub: number) {
	const delka = Math.hypot(bx - ax, by - ay);
	const u0 = ua === null ? Math.atan2(by - ay, bx - ax) : ua;
	cil.moveTo(ax, ay);
	cil.bezierCurveTo(ax + Math.cos(u0) * delka * 0.38, ay + Math.sin(u0) * delka * 0.38, bx - Math.cos(ub) * delka * 0.3, by - Math.sin(ub) * delka * 0.3, bx, by);
}
function kresliChomac(c: CanvasRenderingContext2D, i: number, alfa: number) {
	if (potomci[i].length === 0) return;
	const s = meritkoZ(i), jas = jasZ(i);
	const [cx, cy] = naObrazovku(podCx[i], podCy[i], s);
	const r = Math.min(70, Math.max(5, podR[i] * pohled.k * s * 1.15 + 3));
	const sila = Math.min(0.9, 0.3 + Math.log2(vaha[i] + 1) / 11) * jas;
	kresliZari(c, cx, cy, r, barvaRgb[i], barva[i], false, alfa * sila);
	// tah od bodu složky k těžišti podstromu, ať je vidět směr růstu
	const [sx, sy] = naObrazovku(px[i], py[i], s);
	const d = Math.hypot(cx - sx, cy - sy);
	if (d > 4) {
		c.globalAlpha = alfa * sila * 0.45;
		c.strokeStyle = barva[i];
		c.lineWidth = Math.max(1, Math.min(r * 0.6, tloustka[i] * pohled.k * s * 0.8));
		c.beginPath(); c.moveTo(sx, sy); c.lineTo(cx, cy); c.stroke();
	}
}
function kresliSbalenou(c: CanvasRenderingContext2D, sx: number, sy: number, r: number, i: number, alfa: number) {
	kresliChomac(c, i, alfa * 0.35);
	c.globalAlpha = alfa * 0.9;
	c.strokeStyle = barva[i];
	c.lineWidth = 1.5;
	const rr = r + 4;
	c.beginPath(); c.arc(sx, sy, rr, 0, Math.PI * 2); c.stroke();
	c.beginPath(); c.moveTo(sx - rr * 0.5, sy); c.lineTo(sx + rr * 0.5, sy); c.moveTo(sx, sy - rr * 0.5); c.lineTo(sx, sy + rr * 0.5); c.stroke();
}
// Větev jako dendrit: zúžený tah podél bezierovy křivky, která se po délce zvlní (amplituda roste s délkou, na koncích
// mizí; tvar drží hash cesty, takže se mezi načteními nemění). Vzdálené větve jsou slabší a s širším, měkčím okrajem.
function kresliVetev(c: CanvasRenderingContext2D, a: number, b: number, alfa: number) {
	const sa = meritkoZ(a), sb = meritkoZ(b), jas = jasZ(b);
	const [ax, ay] = naObrazovku(px[a], py[a], sa);
	const [bx, by] = naObrazovku(px[b], py[b], sb);
	const delka = Math.hypot(bx - ax, by - ay);
	if (delka < 0.5) return;
	const ua = a === 0 ? Math.atan2(by - ay, bx - ax) : smer[a], ub = smer[b];
	const c1x = ax + Math.cos(ua) * delka * 0.38, c1y = ay + Math.sin(ua) * delka * 0.38;
	const c2x = bx - Math.cos(ub) * delka * 0.3, c2y = by - Math.sin(ub) * delka * 0.3;
	const kusu = Math.min(MAX_KUSU_VETVE, Math.max(6, Math.round(delka / 14)));
	const amplituda = delka * 0.05 * (1 + 0.4 * odchylka(cesta[b], 'vlna'));
	const vln = (1.5 + odchylka(cesta[b], 'frekvence') * 0.5) * Math.PI * 2, faze = odchylka(cesta[b], 'faze') * Math.PI;
	const bodX = vetevX, bodY = vetevY, normX = vetevNx, normY = vetevNy;
	for (let s = 0; s <= kusu; s++) {
		const t = s / kusu, mt = 1 - t;
		const x = mt * mt * mt * ax + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * bx;
		const y = mt * mt * mt * ay + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * by;
		let dx = 3 * mt * mt * (c1x - ax) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (bx - c2x);
		let dy = 3 * mt * mt * (c1y - ay) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (by - c2y);
		const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
		const vlna = amplituda * Math.sin(t * Math.PI) * Math.sin(t * vln + faze);
		bodX[s] = x - dy * vlna; bodY[s] = y + dx * vlna; normX[s] = -dy; normY[s] = dx;
	}
	const w1 = Math.min(28, Math.max(0.5, tloustka[b] * pohled.k * sb));
	const w0 = Math.min(34, Math.max(w1, Math.min(tloustka[a] * pohled.k * sa * 0.85, w1 * 1.8)));
	c.strokeStyle = barva[b];
	const polylinie = () => { c.beginPath(); c.moveTo(bodX[0], bodY[0]); for (let s = 1; s <= kusu; s++) c.lineTo(bodX[s], bodY[s]); };
	if (w0 < 2.2) {
		c.globalAlpha = alfa * 0.55 * jas;
		c.lineWidth = w1;
		polylinie(); c.stroke();
		return;
	}
	// zúžený tah jako výplň mezi dvěma odsazenými křivkami (úseky s kulatými konci dělaly v aditivním režimu korálky)
	c.fillStyle = barva[b];
	c.globalAlpha = alfa * 0.6 * jas;
	c.beginPath();
	for (let s = 0; s <= kusu; s++) { const w = (w0 + (w1 - w0) * s / kusu) / 2; c.lineTo(bodX[s] + normX[s] * w, bodY[s] + normY[s] * w); }
	for (let s = kusu; s >= 0; s--) { const w = (w0 + (w1 - w0) * s / kusu) / 2; c.lineTo(bodX[s] - normX[s] * w, bodY[s] - normY[s] * w); }
	c.closePath(); c.fill();
	c.beginPath(); c.arc(ax, ay, w0 / 2, 0, Math.PI * 2); c.fill();
	c.globalAlpha = alfa * 0.14 * (1 + (1 - jas) * 1.5);
	c.lineWidth = w0 * 2.6 * (1 + (1 - jas) * 0.8);
	polylinie(); c.stroke();
}

// --- závislosti mezi viditelnými uzly ---
function viditelnyPredek(i: number) {
	if (!kotva) {
		kotva = new Int32Array(pocet).fill(-1);
		for (let n = 0; n < pocet; n++) {
			if (kotva[n] >= 0) continue;
			const retez = [];
			let a = n;
			while (a >= 0 && !individualni[a] && kotva[a] < 0) { retez.push(a); a = rodic[a]; }
			const cil = a < 0 ? 0 : (individualni[a] ? a : kotva[a]);
			for (const z of retez) kotva[z] = cil;
			if (kotva[n] < 0) kotva[n] = cil;
		}
	}
	return kotva[i];
}
function spocitejZavislosti() {
	const mapa = new Map<number, number>();
	for (const [a, b] of vazby) {
		const va = viditelnyPredek(a), vb = viditelnyPredek(b);
		if (va === vb) continue;
		const klic = va < vb ? va * pocet + vb : vb * pocet + va;
		mapa.set(klic, (mapa.get(klic) || 0) + 1);
	}
	const vse = [...mapa.entries()].sort((p, q) => q[1] - p[1]);
	return { krivky: vse.slice(0, MAX_KRIVEK), celkem: vse.length, maxPocet: vse.length ? vse[0][1] : 1 };
}
function krivkaMezi(ax: number, ay: number, bx: number, by: number, sul: number | string) {
	const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
	const vychylka = 0.18 * odchylka(String(sul), 'oblouk') + (odchylka(String(sul), 'strana') > 0 ? 0.12 : -0.12);
	return [mx - dy * vychylka, my + dx * vychylka];
}
function kresliZavislosti(c: CanvasRenderingContext2D) {
	if (!zavislostiCache) zavislostiCache = spocitejZavislosti();
	const { krivky, celkem, maxPocet } = zavislostiCache;
	const pozice = new Map<number, Viditelny>();
	for (const v of viditelne) pozice.set(v.id, v);
	const rgb = hexNaRgb(PALETY[paletaIdx].vazba);
	c.strokeStyle = PALETY[paletaIdx].vazba;
	c.lineCap = 'round';
	for (const [klic, n] of krivky) {
		const a = Math.floor(klic / pocet), b = klic % pocet;
		const pa = pozice.get(a), pb = pozice.get(b);
		if (!pa || !pb) continue;
		const sila = Math.log2(n + 1) / Math.log2(maxPocet + 1);
		c.globalAlpha = 0.05 + 0.3 * sila;
		c.lineWidth = 0.6 + 2.4 * sila;
		const [cx, cy] = krivkaMezi(pa.x, pa.y, pb.x, pb.y, klic);
		c.beginPath(); c.moveTo(pa.x, pa.y); c.quadraticCurveTo(cx, cy, pb.x, pb.y); c.stroke();
		if (sila > 0.5) {
			c.globalAlpha = 0.06 * sila;
			c.lineWidth = (0.6 + 2.4 * sila) * 3;
			c.beginPath(); c.moveTo(pa.x, pa.y); c.quadraticCurveTo(cx, cy, pb.x, pb.y); c.stroke();
		}
	}
	void rgb;
	prvek('zavislosti-info').textContent = celkem > krivky.length
		? texty.krivkySkryte(krivky.length, celkem, celkem - krivky.length)
		: texty.krivek(celkem);
}

// --- popisky s kolizní mřížkou a rozpočtem ---
// Přehled: nanejvýš ~70 popisků na desktopu 1440×900 a ~30 na telefonu 390×844 (úměrně ploše), s přiblížením rozpočet roste
// až ke stropu MAX_POPISKU, kde zbývá jen kolizní mřížka (detail = chování k4).
const ROZPOCET_POPISKU = { zaklad: 16, naPx: 1 / 24000, min: 30, max: 80, rustSZoomem: 1.5 };
const PREHLED_DO = 2.5;                        // násobek kFit, do kterého platí přehledová pravidla (stejný název jen jednou na hlavní větev)
const POPISEK_OD = 0.7, POPISEK_PLNY = 0.8;    // alfa uzlu, od které se popisek objeví (hned aspoň na 70 %) a od které je v plné barvě: krátké prolnutí, žádné šedé popisky
const ODSTUP_POPISKU_VETVE = 1.5, ODSTUP_POPISKU_NOUZE = 4;  // popisek hlavní větve nejdál tolikrát svou výšku od uzlu; když to nejde, dál podél kmene větve ven (nikdy napříč)
// list je kandidát na popisek, až když se sourozenci na obrazovce rozestoupí o víc než ROZESTUP_POPISKU_LISTU px; volné soubory
// v kořeni navíc až nad POPISKY_LISTU_KORENE_OD × kFit. Totéž pravidlo čte let po hledání (kPopiskuListu), ať cíl popisek dostane.
const ROZESTUP_POPISKU_LISTU = 34, POPISKY_LISTU_KORENE_OD = 2.5;
function popisekListuPri(i: number, k: number) {
	const r = rodic[i];
	return rozestup[r] * k > ROZESTUP_POPISKU_LISTU && (r !== 0 || k > kFit * POPISKY_LISTU_KORENE_OD);
}
// nejmenší měřítko, při kterém popisekListuPri list pustí; 1 % nad hranou, protože pravidlo je ostrá nerovnost
function kPopiskuListu(i: number) {
	const r = rodic[i];
	return Math.max(ROZESTUP_POPISKU_LISTU / rozestup[r], r === 0 ? kFit * POPISKY_LISTU_KORENE_OD : 0) * 1.01;
}
function rozpocetPopisku() {
	const zaklad = sevri(Math.round(ROZPOCET_POPISKU.zaklad + sirka * vyska * ROZPOCET_POPISKU.naPx), ROZPOCET_POPISKU.min, ROZPOCET_POPISKU.max);
	const priblizeni = Math.max(1, pohled.k / kFit);
	return Math.min(MAX_POPISKU, Math.round(zaklad * Math.pow(priblizeni, ROZPOCET_POPISKU.rustSZoomem)));
}
function sirkaTextu(c: CanvasRenderingContext2D, text: string, pismo: string) {
	const klic = pismo + '|' + text;
	let w = sirkyTextu.get(klic);
	if (w === undefined) { c.font = pismo; w = c.measureText(text).width; sirkyTextu.set(klic, w); }
	return w;
}
// na úzkém displeji (telefon na výšku) je strop písma složek 14 px místo 17, ať popisky hlavních větví nesežerou šířku
function velikostPopisku(i: number) { return typ[i] === 0 ? Math.min(sirka < 500 ? 14 : 17, Math.max(11, 9 + Math.log2(vaha[i] + 1) * 0.9)) : 11; }
function pismoPopisku(i: number, velikost = velikostPopisku(i)) { return `${typ[i] === 0 ? 600 : 400} ${velikost}px system-ui, sans-serif`; }
// Popisek hlavní větve sedí u svého bodu: kotva P leží na prodloužení větve za uzlem (od středu ven), text k ní přiléhá
// (zarovnání po směru větve má přednost), a když je místo zabrané, kotva se posouvá dál ven, nikdy napříč k jinému uzlu.
// Vrací umístění, nebo null, když se popisek nevejde ani zmenšený.
function umistiPopisekVetve(c: CanvasRenderingContext2D, v: Viditelny, volno: (x0: number, y0: number, x1: number, y1: number) => boolean) {
	// směr „ven" = od uzlu k těžišti jeho podstromu (tam pokračuje kmen větve); bez podstromu od středu mapy
	const [kx, ky] = naObrazovku(px[0], py[0], meritkoZ(0)), [tx, ty] = naObrazovku(podCx[v.id], podCy[v.id], meritkoZ(v.id));
	let ux = tx - v.x, uy = ty - v.y;
	if (Math.hypot(ux, uy) < v.r + 4) { ux = v.x - kx; uy = v.y - ky; }
	const d = Math.hypot(ux, uy) || 1; ux /= d; uy /= d;
	const vodorovne = ux > 0.3 ? [0, 0.5, 1] : ux < -0.3 ? [1, 0.5, 0] : [0.5, 0, 1];   // podíl šířky textu před kotvou
	const svisle = uy > 0.3 ? [-1, 0, 1] : uy < -0.3 ? [1, 0, -1] : [0, 1, -1];         // 1 = text nad kotvou, -1 = pod ní
	for (const [odstupOd, odstupDo] of [[0, ODSTUP_POPISKU_VETVE], [ODSTUP_POPISKU_VETVE, ODSTUP_POPISKU_NOUZE]]) for (let velikost = velikostPopisku(v.id); velikost >= 11; velikost -= 1.5) {
		const pismo = pismoPopisku(v.id, velikost), w = sirkaTextu(c, jmeno[v.id], pismo), h = velikost * 0.65;
		for (let odstup = 4 + velikost * odstupOd; odstup <= velikost * odstupDo; odstup += 4) {
			const pX = v.x + ux * (v.r + odstup), pY = v.y + uy * (v.r + odstup);
			for (const sv of svisle) for (const vo of vodorovne) {
				const x = pX - w * vo, y = pY - sv * h;
				if ((x + w / 2 - v.x) * ux + (y - v.y) * uy < 0) continue;   // střed popisku by ležel směrem ke středu mapy
				if (volno(x - 3, y - h, x + w + 3, y + h)) return { x, y, velikost, pismo, w };
			}
		}
	}
	return null;
}
function kresliPopisky(c: CanvasRenderingContext2D) {
	c.globalCompositeOperation = 'source-over';
	c.textBaseline = 'middle';
	const bunka = 64, obsazene = new Map<number, number[][]>();
	const volno = (x0: number, y0: number, x1: number, y1: number) => {
		// popisek se nikdy neusekne: co se nevejde celé na plátno, se nekreslí (zkusí se ještě levá strana)
		if (x0 < 0 || y0 < 0 || x1 > sirka || y1 > vyska) return false;
		const bx0 = Math.floor(x0 / bunka), bx1 = Math.floor(x1 / bunka), by0 = Math.floor(y0 / bunka), by1 = Math.floor(y1 / bunka);
		for (let gx = bx0; gx <= bx1; gx++) for (let gy = by0; gy <= by1; gy++) {
			const seznam = obsazene.get(gx * 100003 + gy);
			if (!seznam) continue;
			for (const o of seznam) if (x0 < o[2] && x1 > o[0] && y0 < o[3] && y1 > o[1]) return false;
		}
		const obdelnik = [x0, y0, x1, y1];
		for (let gx = bx0; gx <= bx1; gx++) for (let gy = by0; gy <= by1; gy++) {
			const klic = gx * 100003 + gy;
			if (!obsazene.has(klic)) obsazene.set(klic, []);
			obsazene.get(klic)!.push(obdelnik);
		}
		return true;
	};
	const kandidati = [];
	for (const v of viditelne) {
		if (v.id === 0 || v.alfa < POPISEK_OD) continue;
		if (typ[v.id] === 0) { kandidati.push(v); continue; }
		if (popisekListuPri(v.id, pohled.k)) kandidati.push(v);
	}
	// přednost: složky před listy, hlavní větve první, pak těžší a mělčí dřív
	kandidati.sort((p, q) => (typ[p.id] - typ[q.id])
		|| ((hloubka[p.id] === 1) !== (hloubka[q.id] === 1) ? hloubka[p.id] - hloubka[q.id] : 0)
		|| (vaha[q.id] - vaha[p.id]) || (hloubka[p.id] - hloubka[q.id]));
	const rozpocet = rozpocetPopisku(), prehled = pohled.k < kFit * PREHLED_DO, pouzitaJmena = new Set();
	// body hlavních větví a středu jsou v mřížce obsazené: popisek jedné hlavní větve nesmí zakrýt bod druhé
	for (const v of viditelne) if (hloubka[v.id] <= 1 && typ[v.id] === 0) volno(v.x - v.r - 2, v.y - v.r - 2, v.x + v.r + 2, v.y + v.r + 2);
	zasahyPopisku = new Map<number, Obdelnik>();
	let nakresleno = 0;
	for (const v of kandidati) {
		if (nakresleno >= rozpocet) break;
		const slozka = typ[v.id] === 0, hlavni = hloubka[v.id] === 1;
		if (prehled && !hlavni) {
			// v přehledu se opakující název  ukáže na podstrom hlavní větve jen jednou
			const klicJmena = vetev[v.id] + '|' + jmeno[v.id];
			if (pouzitaJmena.has(klicJmena)) continue;
			pouzitaJmena.add(klicJmena);
		}
		let velikost = velikostPopisku(v.id), pismo = pismoPopisku(v.id), w = sirkaTextu(c, jmeno[v.id], pismo);
		let x: number, y: number;
		if (hlavni) {
			const misto = umistiPopisekVetve(c, v, volno);
			if (!misto) continue;
			({ x, y, velikost, pismo, w } = misto);
		} else {
			y = v.y + 1;
			const vpravo = v.x + v.r + 5, vlevo = v.x - v.r - 5 - w;
			x = vpravo;
			if (!volno(x - 3, y - velikost * 0.65, x + w + 3, y + velikost * 0.65)) {
				x = vlevo;
				if (!volno(x - 3, y - velikost * 0.65, x + w + 3, y + velikost * 0.65)) continue;
			}
		}
		c.font = pismo;
		// krátké prolnutí mezi POPISEK_OD a POPISEK_PLNY, dál plná barva; vzdálený popisek jen o málo slabší, ať zůstane čitelný
		c.globalAlpha = (0.7 + 0.3 * hladce((v.alfa - POPISEK_OD) / (POPISEK_PLNY - POPISEK_OD))) * (slozka ? 0.95 : 0.85) * (0.9 + 0.1 * jasZ(v.id));
		c.lineWidth = 3;
		c.strokeStyle = 'rgba(4,6,16,0.85)';
		c.strokeText(jmeno[v.id], x, y);
		const rgb = barvaRgb[v.id].map((ch) => Math.round(ch + (255 - ch) * (slozka ? 0.55 : 0.7)));
		c.fillStyle = rgbNaCss(rgb, 1);
		c.fillText(jmeno[v.id], x, y);
		zasahyPopisku.set(v.id, { x0: x, y0: y - velikost * 0.6, x1: x + w, y1: y + velikost * 0.6 });
		nakresleno++;
	}
	c.globalAlpha = 1;
}
// --- výběr a zvýraznění vazeb ---
function vazbyUzlu(i: number) {
	const zacatek = i, konec = konecPodstromu[i];
	const uvnitr = (n: number) => n >= zacatek && n < konec;
	const ven = new Map<number, number>(), dovnitr = new Map<number, number>();
	let venCelkem = 0, dovnitrCelkem = 0;
	for (let n = zacatek; n < konec; n++) {
		if (typ[n] === 0) continue;
		for (const cil of odchozi[n]) if (!uvnitr(cil)) { venCelkem++; ven.set(cil, (ven.get(cil) || 0) + 1); }
		for (const zdroj of prichozi[n]) if (!uvnitr(zdroj)) { dovnitrCelkem++; dovnitr.set(zdroj, (dovnitr.get(zdroj) || 0) + 1); }
	}
	return { ven, dovnitr, venCelkem, dovnitrCelkem };
}
function seskupPodleKotvy(mapa: Map<number, number>) {
	const skupiny = new Map<number, number>();
	for (const [uzel, n] of mapa) { const k = viditelnyPredek(uzel); skupiny.set(k, (skupiny.get(k) || 0) + n); }
	return [...skupiny.entries()].sort((p, q) => q[1] - p[1]);
}
const historiePanelu: string[] = [];
function zavriMenuPanelu() {
 prvek('panel-menu').hidden = true;
 for (const tlacitko of prvek('panel-cisla').querySelectorAll('button')) tlacitko.setAttribute('aria-expanded', 'false');
}
function zmerMenuPanelu() {
 const vrch = prvek('panel').getBoundingClientRect().top;
 const viditelnyVrch = Math.max(koren.getBoundingClientRect().top, okno.visualViewport?.offsetTop ?? 0);
 koren.style.setProperty('--mozek-menu-vyska', `${Math.max(0, Math.floor(vrch - viditelnyVrch - 12))}px`);
}
function otevriMenuPanelu(druh: string) {
 const seznam = prvek('panel-menu');
 const stejne = !seznam.hidden && seznam.dataset.druh === druh;
 zavriMenuPanelu();
 if (stejne || vybrany < 0) return;
 const podleJmena = (a: number, b: number) => jmeno[a].localeCompare(jmeno[b], 'en', { sensitivity: 'base' }) || cesta[a].localeCompare(cesta[b], 'en');
 const uzly: [number, number][] = druh === 'files'
  ? potomci[vybrany].slice().sort((a, b) => Number(typ[a] !== 0) - Number(typ[b] !== 0) || podleJmena(a, b)).map(i => [i, 1])
  : [...(druh === 'outgoing' ? vyberVazby.ven : vyberVazby.dovnitr) ].sort((a, b) => b[1] - a[1] || podleJmena(a[0], b[0]));
 seznam.replaceChildren();
 seznam.dataset.druh = druh;
 seznam.setAttribute('aria-label', druh === 'files' ? texty.souboru(2) : druh === 'outgoing' ? texty.odchozich : texty.prichozich);
 for (const [i, pocetOdkazu] of uzly.slice(0, 500)) {
  const radek = vytvorPrvek(dokument, 'li'), tlacitko = vytvorPrvek(dokument, 'button');
  tlacitko.type = 'button'; tlacitko.dataset.uzel = String(i);
  const nazev = vytvorPrvek(dokument, 'span'); nazev.className = 'mozek-menu-nazev'; nazev.textContent = jmeno[i];
  const pocet = vytvorPrvek(dokument, 'span'); pocet.className = 'mozek-menu-pocet'; pocet.textContent = druh !== 'files' && pocetOdkazu > 1 ? String(pocetOdkazu) : '';
  const rodicCesta = vytvorPrvek(dokument, 'span'); rodicCesta.className = 'mozek-menu-cesta'; rodicCesta.textContent = rodic[i] > 0 ? cesta[rodic[i]] : texty.korenVaultu;
  tlacitko.append(nazev, pocet, rodicCesta); radek.append(tlacitko); seznam.append(radek);
 }
 if (uzly.length > 500) { const zbytek = vytvorPrvek(dokument, 'li'); zbytek.className = 'mozek-menu-dalsi'; zbytek.textContent = texty.dalsich(uzly.length - 500); seznam.append(zbytek); }
 zmerMenuPanelu(); seznam.hidden = false; seznam.scrollTop = 0;
 prvek('panel-cisla').querySelector(`[data-seznam="${druh}"]`)?.setAttribute('aria-expanded', 'true');
}
function letZPanelu(i: number, zpet = false) {
 if (!zpet && vybrany >= 0) historiePanelu.push(cesta[vybrany]);
 zavriMenuPanelu();
 letNa(i, true);
}
function vyber(i: number) {
 zavriMenuPanelu();
 if (i < 0) historiePanelu.length = 0;
	vybrany = i;
	vyberVazby = i >= 0 ? vazbyUzlu(i) : null!;
	naplnPanel();
	meridloCekaVyber = i >= 0;
	pozadujSnimek();
}
function naplnPanel() {
	const panel = prvek('panel');
	if (vybrany < 0) { panel.hidden = true; return; }
	const i = vybrany, slozka = typ[i] === 0;
	panel.hidden = false;
	prvek('panel-nazev').textContent = jmeno[i];
	prvek('panel-cesta').textContent = i === 0 ? texty.korenVaultu : cesta[i];
	const cisla = prvek('panel-cisla');
	cisla.replaceChildren();
 const polozka = (hodnota: number, popis: string, druh: string) => {
  const tlacitko = vytvorPrvek(dokument, 'button'); tlacitko.type = 'button'; tlacitko.dataset.seznam = druh;
  tlacitko.disabled = hodnota === 0; tlacitko.setAttribute('aria-expanded', 'false');
  const b = vytvorPrvek(dokument, 'b'); b.textContent = String(hodnota); tlacitko.append(b, ` ${popis}`); cisla.append(tlacitko);
 };
 if (slozka) polozka(potomci[i].length, texty.souboru(potomci[i].length), 'files');
 polozka(vyberVazby.venCelkem, texty.odchozich, 'outgoing');
 polozka(vyberVazby.dovnitrCelkem, texty.prichozich, 'incoming');
 prvek('panel-zpet').hidden = historiePanelu.length === 0;
	const sbalit = prvek('panel-sbalit');
	sbalit.hidden = !slozka || i === 0;
	sbalit.textContent = sbalene.has(cesta[i]) ? texty.rozbalit : texty.sbalit;
	prvek('panel-obsidian').hidden = slozka;
}
function prepniSbaleni(i: number) {
	if (typ[i] !== 0 || i === 0) return;
	if (sbalene.has(cesta[i])) sbalene.delete(cesta[i]); else sbalene.add(cesta[i]);
	ulozSbalene();
	if (vybrany === i) naplnPanel();
	zneplatniStatiku();
}
function ulozSbalene() { uloz(KLIC.sbalene, JSON.stringify([...sbalene])); }
// otevření poznámky dělá hostitel z původní cesty (plugin: vault.getAbstractFileByPath + openFile), žádné URI
function otevriVObsidianu(i: number) { if (volby.otevri) volby.otevri(cesta[i]); }

// --- dynamická vrstva: ztlumení, zvýrazněné vazby, impulzy ---
function poziceUzlu(i: number) {
	const k = individualni && individualni[i] ? i : viditelnyPredek(i);
	for (const v of viditelne) if (v.id === k) return v;
	return null;
}
function bodKrivky(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number) {
	const mt = 1 - t;
	return [mt * mt * ax + 2 * mt * t * cx + t * t * bx, mt * mt * ay + 2 * mt * t * cy + t * t * by];
}
function kresliVyber(cas: number) {
	const bezVyberu = () => { zasahyPopiskuVyberu = new Map<number, Obdelnik>(); uzlyPopiskuVyberu = []; klicVrstvyVyberu = ''; return false; };
	if (vybrany < 0 || !vyberVazby) return bezVyberu();
	// Oddálení ponechá výběru vlastní polohu; sbalená větev jej zastoupí nejvyšším sbaleným předkem.
	const u = kotvaSbaleni(vybrany), s = meritkoZ(u), [x, y] = naObrazovku(px[u], py[u], s);
	const stred: Viditelny = { id: u, x, y, r: polomerBodu(u) * s, alfa: 1 };
	const paleta = PALETY[paletaIdx];
	ctx.globalCompositeOperation = 'source-over';
	ctx.fillStyle = 'rgba(4,6,16,0.8)';
	ctx.fillRect(0, 0, sirka, vyska);
	ctx.globalCompositeOperation = 'lighter';
	ctx.lineCap = 'round';
	const pozice = new Map<number, Viditelny>();
	for (const v of viditelne) pozice.set(v.id, v);
	const klic = vybrany + '|' + verzeStatiky;
	if (klic !== klicVrstvyVyberu) {
		klicVrstvyVyberu = klic;
		hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		hctx.globalCompositeOperation = 'source-over'; hctx.globalAlpha = 1;
		hctx.clearRect(0, 0, sirka, vyska);
		hctx.globalCompositeOperation = 'lighter'; hctx.lineCap = 'round'; hctx.lineJoin = 'round';
		// Hierarchie a její popisky zachovají dosavadní viditelnou kotvu.
		const hierarchie = poziceUzlu(vybrany);
		uzlyPopiskuVyberu = hierarchie ? [hierarchie, ...kresliHierarchii(hctx, hierarchie, pozice)] : [];
		if (hierarchie?.id !== stred.id) uzlyPopiskuVyberu.unshift(stred);
		hctx.globalCompositeOperation = 'source-over'; hctx.globalAlpha = 1;
	}
	ctx.globalAlpha = 1;
	ctx.drawImage(vrstvaHierarchie, 0, 0, sirka, vyska);
	const smery = [
		{ skupiny: seskupPodleKotvy(vyberVazby.ven), barva: paleta.ven, rgb: hexNaRgb(paleta.ven), odStredu: true },
		{ skupiny: seskupPodleKotvy(vyberVazby.dovnitr), barva: paleta.dovnitr, rgb: hexNaRgb(paleta.dovnitr), odStredu: false }
	];
	const impulzy: { ax: number; ay: number; cx: number; cy: number; bx: number; by: number; odStredu: boolean; pocet: number; rgb: number[]; barva: string; faze: number }[] = [];
	for (const s of smery) {
		const maxN = s.skupiny.length ? s.skupiny[0][1] : 1;
		s.skupiny.slice(0, 400).forEach(([kotvaId, n], poradi) => {
			const cil = pozice.get(kotvaId);
			if (!cil || kotvaId === stred.id) return;
			const sila = Math.log2(n + 1) / Math.log2(maxN + 1);
			const [cx, cy] = krivkaMezi(stred.x, stred.y, cil.x, cil.y, kotvaId * 7 + (s.odStredu ? 1 : 2));
			ctx.strokeStyle = s.barva;
			ctx.globalAlpha = 0.18 + 0.42 * sila;
			ctx.lineWidth = 0.8 + 2.2 * sila;
			ctx.beginPath(); ctx.moveTo(stred.x, stred.y); ctx.quadraticCurveTo(cx, cy, cil.x, cil.y); ctx.stroke();
			kresliZari(ctx, cil.x, cil.y, cil.r * 2.6, barvaRgb[cil.id], barva[cil.id], true, 1);
			kresliZari(ctx, cil.x, cil.y, cil.r * 3.2, s.rgb, s.barva, false, 0.5);
			if (poradi < 48) impulzy.push({ ax: stred.x, ay: stred.y, cx, cy, bx: cil.x, by: cil.y, odStredu: s.odStredu, pocet: 1 + Math.min(2, Math.round(sila * 2)), rgb: s.rgb, barva: s.barva, faze: odchylka(String(kotvaId), 'faze') });
		});
	}
	kresliZari(ctx, stred.x, stred.y, Math.max(stred.r * 3.4, 18), barvaRgb[stred.id], barva[stred.id], true, 1);
	kresliZari(ctx, stred.x, stred.y, Math.max(stred.r * 5, 30), [255, 255, 255], 'bila', false, 0.5);
	for (const im of impulzy) {
		for (let j = 0; j < im.pocet; j++) {
			let t = ((cas / 2600) + im.faze + j / im.pocet) % 1;
			if (t < 0) t += 1;
			const [x, y] = im.odStredu ? bodKrivky(im.ax, im.ay, im.cx, im.cy, im.bx, im.by, t) : bodKrivky(im.bx, im.by, im.cx, im.cy, im.ax, im.ay, t);
			kresliZari(ctx, x, y, 6, im.rgb, im.barva, true, 0.9);
		}
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	kresliPopiskyVyberu(ctx, uzlyPopiskuVyberu);
	ctx.globalAlpha = 1;
	return impulzy.length > 0;
}
// Hierarchie výběru nad ztlumením: cesta ke kořeni (nadřazené, každý další stupeň slabší) a přímí potomci (podřazené).
// Kreslí jen spojení, jejichž oba konce jsou na plátně jako samostatné body; vrací uzly k popiskům (rodič, pak děti od nejtěžšího).
function kresliHierarchii(c: CanvasRenderingContext2D, stred: Viditelny, pozice: Map<number, Viditelny>) {
	const naPlatne = (id: number) => { const v = pozice.get(id); return v && v.alfa > 0.5 ? v : null; };
	const spoj = (a: number, b: number, alfa: number) => {
		if (typ[b] === 0) { kresliVetev(c, a, b, alfa); kresliVetev(c, a, b, alfa * 0.6); return; }
		const sa = meritkoZ(a), [ax, ay] = naObrazovku(px[a], py[a], sa), [bx, by] = naObrazovku(px[b], py[b], meritkoZ(b));
		c.globalAlpha = alfa * 0.9;
		c.strokeStyle = barva[b];
		c.lineWidth = Math.min(6, Math.max(1.2, tloustka[b] * pohled.k * sa));
		c.beginPath(); pridejStopku(c, ax, ay, a === 0 ? null : smer[a], bx, by, smer[b]); c.stroke();
	};
	const popisky = [];
	let alfa = 1;
	for (let d = stred.id, a = rodic[d]; a >= 0; d = a, a = rodic[a], alfa *= 0.65) {
		const v = naPlatne(a);
		if (!v) break;
		spoj(a, d, alfa);
		kresliZari(c, v.x, v.y, v.r * 2.8, barvaRgb[a], barva[a], true, alfa);
		if (!popisky.length) popisky.push(v);
	}
	// vybraný uzel není na plátně sám za sebe (stred = jeho viditelný předek): jeho děti nejsou vidět
	if (stred.id !== vybrany) return popisky;
	const deti = [];
	for (const d of potomci[vybrany]) { const v = naPlatne(d); if (v) deti.push(v); }
	// stovky stopek v aditivním režimu by splynuly do bílého klínu, proto slábnou s počtem
	const tlum = Math.min(1, 6 / Math.sqrt(deti.length || 1));
	for (const v of deti) {
		spoj(vybrany, v.id, tlum);
		kresliZari(c, v.x, v.y, v.r * 2.8, barvaRgb[v.id], barva[v.id], true, Math.max(0.5, tlum));
	}
	deti.sort((p, q) => vaha[q.id] - vaha[p.id]);
	return popisky.concat(deti);
}
// Popisky výběru, rodiče a dětí nad ztlumením; co se nevejde vedle bodu bez překryvu, se vynechá.
function kresliPopiskyVyberu(c: CanvasRenderingContext2D, uzly: Viditelny[]) {
	zasahyPopiskuVyberu = new Map<number, Obdelnik>();
	const zabrane: number[][] = [], strop = sirka < 500 ? 10 : 24;
	c.globalCompositeOperation = 'source-over';
	c.globalAlpha = 1;
	c.textBaseline = 'middle';
	c.lineWidth = 3;
	c.strokeStyle = 'rgba(4,6,16,0.9)';
	// kotoučky zvýrazněných bodů jsou obsazené: popisek je nesmí zakrýt, jinak by na bod pod ním nešlo kliknout
	for (const v of uzly) zabrane.push([v.x - v.r - 2, v.y - v.r - 2, v.x + v.r + 2, v.y + v.r + 2]);
	let nakresleno = 0;
	for (const v of uzly) {
		if (nakresleno >= strop) break;
		const velikost = velikostPopisku(v.id), pismo = pismoPopisku(v.id, velikost), w = sirkaTextu(c, jmeno[v.id], pismo), h = velikost * 0.65, y = v.y + 1;
		const volno = (x: number) => x >= 0 && x + w <= sirka && y - h >= 0 && y + h <= vyska
			&& !zabrane.some((o) => x - 3 < o[2] && x + w + 3 > o[0] && y - h < o[3] && y + h > o[1]);
		let x = v.x + v.r + 6;
		if (!volno(x)) { x = v.x - v.r - 6 - w; if (!volno(x)) continue; }
		zabrane.push([x - 3, y - h, x + w + 3, y + h]);
		zasahyPopiskuVyberu.set(v.id, { x0: x, y0: y - velikost * 0.6, x1: x + w, y1: y + velikost * 0.6 });
		c.font = pismo;
		c.strokeText(jmeno[v.id], x, y);
		c.fillStyle = rgbNaCss(barvaRgb[v.id].map((ch) => Math.round(ch + (255 - ch) * 0.7)), 1);
		c.fillText(jmeno[v.id], x, y);
		nakresleno++;
	}
}

// --- animační smyčka (běží jen když se něco hýbe) ---
// jediné místo, kde se žádá snímek: zničená nebo pozastavená instance (nulová plocha, skrytý list) nic neplánuje
function naplanujSnimek() {
	if (zniceno || pozastaveno) { smyckaBezi = false; idSnimku = 0; return; }
	smyckaBezi = true;
	idSnimku = okno.requestAnimationFrame(snimek);
}
let klicCelku = '', meritkoCelku = 1;
function aktualizujCelek() {
 if (!fitHotov || !pohled3d && pohled3dAktivni) return;
 // během letu (2D let_, 3D přelet kamery) popisek stojí, konec letu ho aktualizuje sám (krokLetu → poTe, mozek3d krokPreletu)
 if (let_ || pohled3dAktivni && pohled3d!.ladeni.leti) return;
 let detail = false;
 if (vybrany >= 0) {
  // Detail jen když jeho let viditelně změní záběr (detailZmeniZaber), jinak Overview a klik dělá Celek
  if (pohled3dAktivni) detail = pohled3d!.jeCelek() && pohled3d!.detailZmeniZaber(vybrany);
  else {
   const klic = [sirka, vyska, natazeni, hloubkaZapnuta, pocet, ...sbalene].join('|');
   if (klic !== klicCelku) {
    const pred = pohled, fitPred = kFit, obrazPred = fitObrazovka;
    prizpusobPohled(); meritkoCelku = pohled.k;
    pohled = pred; kFit = fitPred; fitObrazovka = obrazPred; klicCelku = klic;
   }
   detail = pohled.k <= meritkoCelku * 1.01;
   if (detail) detail = detailZmeniZaber(vybrany);
  }
 }
 const tlacitko = prvek('celek');
 const popisek = detail ? texty.detail : texty.celek;
 const titulek = detail ? texty.detailTitulek : texty.celekTitulek;
 if (tlacitko.textContent !== popisek) tlacitko.textContent = popisek;
 if (tlacitko.title !== titulek) tlacitko.title = titulek;
}
function pozadujSnimek() {
 aktualizujCelek();
	if (pohled3dAktivni) { pohled3d!.pozadujSnimek(); return; }
	if (smyckaBezi) return;
	naplanujSnimek();
}
function snimek(cas: number) {
	idSnimku = 0;
	if (zniceno) { smyckaBezi = false; return; }
	// smyčka rozběhnutá před přepnutím do 3D (impulzy výběru) by jinak dál kreslila schované plátno; návrat do 2D ji spustí znovu
	if (pohled3dAktivni) { smyckaBezi = false; return; }
	const zacatekSnimku = performance.now();
	let dalsi = false;
	if (let_) { dalsi = krokLetu(cas); }
	if (statikaSpinava) kresliStatiku();
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
	ctx.clearRect(0, 0, sirka, vyska);
	ctx.drawImage(statika, 0, 0, sirka, vyska);
	if (kresliVyber(cas)) dalsi = true;
	zmerSnimek(zacatekSnimku);
	if (dalsi) naplanujSnimek(); else smyckaBezi = false;
}
// měřidlo pro měření na zařízení: ms od vzniku instance do prvního snímku, ms prvního snímku po výběru, paměť kde je
function zmerSnimek(zacatekSnimku: number) {
	const ted = performance.now();
	let zmena = false;
	if (meridlo.prvniSnimekMs === null) { meridlo.prvniSnimekMs = ted - casVzniku; zmena = true; }
	if (meridloCekaVyber) { meridloCekaVyber = false; meridlo.snimekVyberuMs = ted - zacatekSnimku; zmena = true; }
	if (!zmena) return;
	const pamet = okno.performance && (okno.performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
	meridlo.pametMB = pamet && pamet.usedJSHeapSize ? pamet.usedJSHeapSize / 1048576 : null;
	const casti = [texty.prvniSnimek(meridlo.prvniSnimekMs.toFixed(0))];
	if (meridlo.snimekVyberuMs !== null) casti.push(texty.snimekVyberu(meridlo.snimekVyberuMs.toFixed(1)));
	if (meridlo.pametMB !== null) casti.push(`${meridlo.pametMB.toFixed(0)} MB`);
	prvek('meridlo').textContent = casti.join(' · ');
}

// --- let na uzel (hledání nebo klik) ---
// viditelný zástupce uzlu podle sbalení (nejvyšší sbalený předek, jako viditelnaKotva ve 3D): uzel uvnitř sbalené větve se nekreslí
function kotvaSbaleni(i: number) {
	let k = i;
	for (let a = rodic[i]; a > 0; a = rodic[a]) if (sbalene.has(cesta[a])) k = a;
	return k;
}
// cíl letu na viditelný uzel u (první výběr B3d i Detail B5): u ve středu, přiblížení aspoň na rozestup předků a popisek listu
function cilLetu(u: number) {
	let potrebnyK = pohled.k;
	for (let a = rodic[u]; a >= 0; a = rodic[a]) if (rozestup[a] > 0) potrebnyK = Math.max(potrebnyK, (PRAH_ROZESTUPU * 2.2) / rozestup[a]);
	if (typ[u] === 0 && rozestup[u] > 0) potrebnyK = Math.max(potrebnyK, (PRAH_ROZESTUPU * 1.6) / rozestup[u]);
	// poznámka: aspoň měřítko, od kterého jí jádro kreslí popisek 
	if (typ[u] !== 0 && rozestup[rodic[u]] > 0) potrebnyK = Math.max(potrebnyK, kPopiskuListu(u));
	const k = omezK(potrebnyK);
	return { k, x: sirka / 2 - px[u] * k, y: vyska / 2 - py[u] * k };
}
// Detail (let na kotvu výběru) viditelně změní záběr : přiblíží nad Celek o víc než 1 % (tolerance popisku),
// nebo posune kotvu do středu o víc než 1 % menšího rozměru plochy; posun bez perspektivy hloubky, jako cíl letu
function detailZmeniZaber(i: number) {
	const u = kotvaSbaleni(i), c = cilLetu(u);
	return c.k > meritkoCelku * 1.01 || Math.hypot(px[u] * pohled.k + pohled.x - sirka / 2, py[u] * pohled.k + pohled.y - vyska / 2) > Math.min(sirka, vyska) * 0.01;
}
// zachovejVetve = Detail (B5): nerozbalí předky a míří na viditelného zástupce vybraného uzlu ; výběr až po startu letu,
// takže popisek Celek/Detail se během letu nemění
function letNa(i: number, vyberHned = false, zachovejVetve = false) {
	if (!zachovejVetve) {
		for (let a = rodic[i]; a > 0; a = rodic[a]) sbalene.delete(cesta[a]);
		ulozSbalene();
	}
	if (pohled3dAktivni) { statikaSpinava = true; pohled3d!.zneplatni(); pohled3d!.letNa(i); if (vyberHned || !zachovejVetve) vyber(i); return; }
	const u = zachovejVetve ? kotvaSbaleni(i) : i;
	const cil = cilLetu(u);
	let_ = { od: { ...pohled }, cil, start: performance.now(), trvani: 750, poTe: () => { if (!vyberHned && !zachovejVetve) vyber(i); aktualizujCelek(); } };
	if (vyberHned) vyber(i);
	pozadujSnimek();
}
function celek2d() {
	if (!fitHotov || pozastaveno) return;
	prerusLet();
	const pred = pohled, kFitPred = kFit, fitPred = fitObrazovka;
	prizpusobPohled();
	const cil = { ...pohled };
	pohled = pred; kFit = kFitPred; fitObrazovka = fitPred;
	let_ = { od: { ...pohled }, cil, start: performance.now(), trvani: 750, poTe: () => aktualizujCelek() };
	pozadujSnimek();
}
function prerusLet() {
	const preruseny = let_;
	let_ = null;
	if (preruseny) preruseny.poTe();
	return preruseny;
}
function krokLetu(cas: number) {
	const t = hladce(Math.min(1, (cas - let_!.start) / let_!.trvani));
	const lnK = Math.log(let_!.od.k) + (Math.log(let_!.cil.k) - Math.log(let_!.od.k)) * t;
	pohled = { k: Math.exp(lnK), x: let_!.od.x + (let_!.cil.x - let_!.od.x) * t, y: let_!.od.y + (let_!.cil.y - let_!.od.y) * t };
	statikaSpinava = true;
	if (t >= 1) { pohled = { ...let_!.cil }; const hotovo = let_!.poTe; let_ = null; kresliStatiku(); hotovo(); return false; }
	return true;
}

// --- obnova pohledu po návratu (Zpět v Obsidianu, P6) ---
// vybraný uzel, který v datech není = zůstane úvodní pohled (obnovPohled ho na hotové ploše vrátí). Stejně otočené a natažené
// rozložení: jiný rozměr drží střed plochy nad týmž bodem mapy. Jinak otočené či natažené rozložení (srovnejOrientaci podle plochy:
// uložený posun souřadnicím uzlů neodpovídá): výběr a měřítko zůstanou, vybraný uzel se hned vystředí, bez výběru se měřítko změní
// kolem středu plochy 
function pouzijStavPohledu(stav: StavPohledu) {
	const i = stav.vybrany === null ? -1 : cesta.indexOf(stav.vybrany);
	if (stav.vybrany !== null && i < 0) return false;
	let_ = null;
	const k = omezK(stav.k);
	if ((stav.vyska > stav.sirka) !== otoceno || stav.natazeni !== natazeni) {
		if (i >= 0) pohled = { k, x: sirka / 2 - px[i] * k, y: vyska / 2 - py[i] * k };
		else pohled = { k, x: sirka / 2 - (sirka / 2 - pohled.x) * (k / pohled.k), y: vyska / 2 - (vyska / 2 - pohled.y) * (k / pohled.k) };
	} else pohled = { k, x: stav.x + (sirka - stav.sirka) / 2, y: stav.y + (vyska - stav.vyska) / 2 };
	vyber(i);
	rezimObnovy = stav.rezim ?? '2d';
	kameraObnovy = stav.kamera3d ?? null;
	if (pohled3d) { pohled3d.obnovKameru(kameraObnovy); nastavPohled(rezimObnovy, false, false); rezimObnovy = null; }
	zneplatniStatiku();
	return true;
}
function stavPohledu(): StavPohledu | null {
	if (cekajiciPohled) return platnyStavPohledu(cekajiciPohled);
	if (!fitHotov || !plochaPohledu[0] || !plochaPohledu[1]) return null;
	return { x: pohled.x, y: pohled.y, k: pohled.k, sirka: plochaPohledu[0], vyska: plochaPohledu[1], natazeni, vybrany: vybrany >= 0 ? cesta[vybrany] : null, ...(pohled3dAktivni ? { rezim: '3d' as const, ...(pohled3d?.stavKamery() ? { kamera3d: pohled3d.stavKamery()! } : {}) } : {}) };
}
// neplatný nebo cizí objekt se ignoruje (pohled zůstane); platný stav s cestou, která v datech není, zahodí čekající stav, let
// i výběr a vrátí úvodní pohled: na hotové ploše hned, jinak s první plochou . Platný stav na pozastavené
// ploše nebo ploše bez rozměru počká na první fit s plochou, jinak by se vystředil vůči nulové šířce 
function obnovPohled(stav: unknown) {
	if (zniceno) return;
	const platny = platnyStavPohledu(stav);
	if (!platny) return;
	const chybi = ladeni.pripraveno && platny.vybrany !== null && cesta.indexOf(platny.vybrany) < 0;
	if (!chybi && (pozastaveno || bezPlochy)) { cekajiciPohled = platny; let_ = null; fitHotov = false; return; }
	if (!chybi) { if (fitHotov && ladeni.pripraveno) pouzijStavPohledu(platny); else cekajiciPohled = platny; return; }
	cekajiciPohled = null;
	let_ = null;
	vyber(-1);
	if (fitHotov && !pozastaveno) prvniFit(); else fitHotov = false;
}

// --- ovládání plátna ---
function zasah(x: number, y: number) {
	// pořadí: kotouček zvýrazněného bodu, popisek výběru (leží nad ztlumenými body), pak běžné hledání bodu a statické popisky
	let bod = -1, bodD = Infinity;
	for (const v of uzlyPopiskuVyberu) { const d = Math.hypot(v.x - x, v.y - y); if (d <= v.r + 2 && d < bodD) { bodD = d; bod = v.id; } }
	if (bod >= 0) return bod;
	for (const [id, o] of zasahyPopiskuVyberu) if (x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) return id;
	let nej = -1, nejD = Infinity;
	for (const v of viditelne) {
		const d = Math.hypot(v.x - x, v.y - y);
		const tolerance = Math.max(v.r + 6, 14);
		if (d <= tolerance && d - v.r * 0.3 < nejD) { nejD = d - v.r * 0.3; nej = v.id; }
	}
	if (nej >= 0) return nej;
	for (const [id, o] of zasahyPopisku) if (x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) return id;
	return -1;
}
function dvojitaAkce(i: number) {
	if (i < 0) return;
	if (typ[i] === 0) prepniSbaleni(i); else otevriVObsidianu(i);
}
// bod události v souřadnicích plátna: v Obsidianu plátno nezačíná v rohu okna (odsazený nebo rozdělený pohled)
function bodPlatna(e: MouseEvent) {
	const obdelnik = platno.getBoundingClientRect();
	return [e.clientX - obdelnik.left, e.clientY - obdelnik.top];
}
function zrusDrzeni() { if (casovacDrzeni) { okno.clearTimeout(casovacDrzeni); casovacDrzeni = null; } }
// dotyk u svislého okraje obrazovky (ne kořene: v rozděleném pohledu je okraj listu uvnitř obrazovky) patří hostiteli; myš a pero ne
function uOkrajeObrazovky(e: PointerEvent) {
	if (e.pointerType !== 'touch') return false;
	const sirkaOkna = okno.innerWidth || 0;
	return sirkaOkna > 0 && (e.clientX < OKRAJ_OBSIDIANU || e.clientX > sirkaOkna - OKRAJ_OBSIDIANU);
}
// klávesnice na telefonu : když visualViewport (překryvná klávesnice, iOS) odkryje jen část kořene, kořen dostane
// třídu klavesnice a proměnné --mozek-vrch-viditelne / --mozek-vyska-viditelne; CSS tím posune lištu hledání do viditelné části
// a zkrátí seznam výsledků. Viditelnou část si jádro drží i pro sledujKlavesnici (zmenšený list na Androidu je celý viditelný).
function prepocitejViditelnouCast() {
 if (!prvek('panel-menu').hidden) zmerMenuPanelu();
	const vv = okno.visualViewport;
	if (zniceno || !vv) return;
	const obdelnik = koren.getBoundingClientRect();
	const vrch = Math.max(0, vv.offsetTop - obdelnik.top), spodek = Math.min(obdelnik.height, vv.offsetTop + vv.height - obdelnik.top);
	const viditelna = spodek - vrch;
	viditelnaCast = { vrch, vyska: Math.max(0, viditelna) };
	const klavesnice = viditelna > 0 && obdelnik.height - viditelna > PRAH_KLAVESNICE;
	koren.classList.toggle('klavesnice', klavesnice);
	if (klavesnice) {
		koren.style.setProperty('--mozek-vrch-viditelne', `${Math.round(vrch)}px`);
		koren.style.setProperty('--mozek-vyska-viditelne', `${Math.round(viditelna)}px`);
	} else {
		koren.style.removeProperty('--mozek-vrch-viditelne');
		koren.style.removeProperty('--mozek-vyska-viditelne');
	}
}
// Klávesnice je dočasné zakrytí plochy, ne nová plocha . Android při ní zmenší okno, tedy i list (na telefonu
// z mezizkoušky až na ~18 px výšky, víc než o klávesnici), iOS jen visualViewport. Dřív to ResizeObserver bral jako novou plochu:
// srovnejOrientaci přepočítala natažení a otočení, prizpusobPohled napasoval mapu do plochy pod lištou, která v nízkém listu neexistuje
// (max(1, výška − lišta − okraje) = 1 px), měřítko i kFit iterací spadly k nule (4e-31) a mapa zmizela; po zavření nový fit zahodil
// pohled. Teď plátno po dobu klávesnice drží rozměr plochy před ní (kořen ho jen ořízne), rozložení, pohled, kFit i stav pro Zpět se
// nemění a plátno se jen posune, aby střed plochy (kam míří úvodní pohled, let i perspektiva) ležel ve středu viditelné části.
// Začátek: plocha zakrytá o víc než PRAH_KLAVESNICE při stejné šířce, fokusu v textovém poli mapy (hledání; fokus v editoru jiného
// panelu by na PC zmrazil plochu při obyčejném zmenšení listu) a poklesu okna nebo visualViewportu o víc než PRAH_KLAVESNICE proti
// ploše bez klávesnice . Konec: okno i viewport zpět
// (nebo kořen na plné výšce bez zakrytí), jiná šířka bez otočení okna, nulová plocha; ověřuje se i po focusout z pole mapy a po změně
// viditelnosti listu (klávesnice zavřená bez události viewportu). Nezakrytá plocha přežije skrytí listu (návrat během klávesnice ji
// převezme zpět) a otočení okna s klávesnicí z ní odvodí novou (F2). Vrací 'klavesnice' (rozměr se nezpracuje), 'drzena' (plátno drží
// novou nebo vrácenou nezakrytou plochu, rozměr převezmi), 'konec' (zakrytí skončilo, rozměr zpracuj) nebo 'ne'.
const TYPY_BEZ_KLAVESNICE = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];
function fokusVTextovemPoliMapy() {
	const prvekFokusu = dokument.activeElement as HTMLElement | null;
	if (!prvekFokusu || !koren.contains(prvekFokusu)) return false;
	if (prvekFokusu.isContentEditable || prvekFokusu.tagName === 'TEXTAREA') return true;
	return prvekFokusu.tagName === 'INPUT' && !TYPY_BEZ_KLAVESNICE.includes((prvekFokusu as HTMLInputElement).type);
}
function zapamatujOkno() {
	const vv = okno.visualViewport;
	oknoBezKlavesnice = { sirka: okno.innerWidth || 0, vyska: okno.innerHeight || 0, vvSirka: vv ? vv.width : 0, vvVyska: vv ? vv.height : 0 };
}
// pokles výšky okna a visualViewportu proti oknu bez klávesnice; po otočení je plnou výškou dřívější šířka
function poklesOkna(poOtoceni = false) {
	const o = oknoBezKlavesnice, vv = okno.visualViewport;
	const plneOkno = poOtoceni ? o.sirka : o.vyska, plnyViewport = poOtoceni ? o.vvSirka : o.vvVyska;
	return Math.max(0, plneOkno - (okno.innerHeight || 0), vv ? plnyViewport - vv.height : 0);
}
// --keyboard-height (Obsidian mobil) na kořeni nebo předcích v px; 0 = není, nulová nebo nečitelná (jiná jednotka než px)
function vyskaKlavesniceHostitele() {
	for (let prvek: HTMLElement | null = koren; prvek; prvek = prvek.parentElement) {
		const hodnota = parseFloat(okno.getComputedStyle(prvek).getPropertyValue('--keyboard-height'));
		if (hodnota > 0) return hodnota;
	}
	return 0;
}
// časovač kontroly držení : běží jen během držení na viditelném listu; zastaví ho uvolnění, pauza (skrytí) a destroy
function spustKontroluDrzeni() {
	if (kontrolaDrzeni !== null || zniceno || pozastaveno || !plochaPredKlavesnici) return;
	kontrolaDrzeni = okno.setInterval(() => {
		if (zniceno || pozastaveno || !plochaPredKlavesnici) { zastavKontroluDrzeni(); return; }
		poZmeneViewportu();
	}, KONTROLA_DRZENI_MS);
}
function zastavKontroluDrzeni() {
	if (kontrolaDrzeni !== null) { okno.clearInterval(kontrolaDrzeni); kontrolaDrzeni = null; }
}
function drzPlochu(s: number, v: number) {
	plochaPredKlavesnici = true;
	setCssStyles(platno, { width: `${s}px` });
	setCssStyles(platno, { height: `${v}px` });
	spustKontroluDrzeni();
}
function pustPlochu() {
	plochaPredKlavesnici = false;
	zastavKontroluDrzeni();
	for (const vlastnost of ['width', 'height', 'transform']) platno.style.removeProperty(vlastnost);
}
// střed držené plochy do středu viditelné části kořene; bez držení nic
function posunPlatna() {
	if (plochaPredKlavesnici) setCssStyles(platno, { transform: `translateY(${Math.round(viditelnaCast.vrch + viditelnaCast.vyska / 2 - vyska / 2)}px)` });
	for (const nazev of ['platno3d', 'popisky3d']) {
		const c = prvek(nazev);
		for (const vlastnost of ['width', 'height', 'transform']) setCssStyles(c, { [vlastnost]: platno.style[vlastnost as 'width' | 'height' | 'transform'] });
	}
}
function sledujKlavesnici(): 'klavesnice' | 'drzena' | 'konec' | 'ne' {
	if (zniceno || !okno.visualViewport) return 'ne';
	const sirkaKorene = koren.clientWidth, vyskaKorene = koren.clientHeight;
	// skrytý list (nulová plocha): plátno se pustí, nezakrytá plocha zůstane pro návrat s klávesnicí
	if (sirkaKorene === 0 || vyskaKorene === 0) {
		if (!plochaPredKlavesnici) return 'ne';
		pustPlochu();
		return 'konec';
	}
	const pokles = poklesOkna(), zKlavesnice = pokles > PRAH_KLAVESNICE;
	// Obsidian může list zmenšit jen paddingem bez poklesu okna i viewportu; klávesnicí je pak pokles
	// kořene stejné šířky o víc než PRAH_KLAVESNICE při kladném --keyboard-height (panel s nulovou hodnotou zůstává nová plocha, F1)
	const zHostitele = !zKlavesnice && sirkaKorene === sirka && vyska - vyskaKorene > PRAH_KLAVESNICE ? vyskaKlavesniceHostitele() : 0;
	const jmenovatel = zKlavesnice ? pokles : zHostitele;   // pomer na px poklesu okna nebo výšky klávesnice, nikdy nula
	if (!plochaPredKlavesnici) {
		if (!zKlavesnice && !zHostitele) { nezakryta = null; return 'ne'; }
		// návrat skrytého listu, klávesnice pořád otevřená: plocha je nezakrytá plocha před skrytím, ne zmenšený kořen
		if (nezakryta && !skrytoHostitelem && fitHotov && sirkaKorene === nezakryta.sirka && nezakryta.vyska - viditelnaCast.vyska > PRAH_KLAVESNICE) {
			drzPlochu(nezakryta.sirka, nezakryta.vyska);
			return 'drzena';
		}
		if (!fitHotov || pozastaveno || vyska - viditelnaCast.vyska <= PRAH_KLAVESNICE || sirkaKorene !== sirka || !fokusVTextovemPoliMapy()) return 'ne';
		nezakryta = { sirka, vyska, pomer: Math.max(0, vyska - vyskaKorene) / jmenovatel };
		drzPlochu(sirka, vyska);
		return 'klavesnice';
	}
	if (sirkaKorene !== sirka) {
		// otočení s klávesnicí (okno změnilo šířku): nová nezakrytá výška = kořen + pokles okna v nové orientaci × pomer; okno bez
		// klávesnice se otočí s ním. Jen jiná šířka panelu (okno stejné) držení ukončí jako dřív.
		if (nezakryta && Math.abs((okno.innerWidth || 0) - oknoBezKlavesnice.sirka) > PRAH_KLAVESNICE) {
			const poklesPoOtoceni = poklesOkna(true), vv = okno.visualViewport, o = oknoBezKlavesnice;
			const novaVyska = Math.round(vyskaKorene + nezakryta.pomer * poklesPoOtoceni);
			oknoBezKlavesnice = { sirka: okno.innerWidth || 0, vyska: o.sirka, vvSirka: vv.width, vvVyska: o.vvSirka };
			if (poklesPoOtoceni > PRAH_KLAVESNICE && novaVyska - viditelnaCast.vyska > PRAH_KLAVESNICE) {
				nezakryta = { ...nezakryta, sirka: sirkaKorene, vyska: novaVyska };
				drzPlochu(sirkaKorene, novaVyska);
				return 'drzena';
			}
		}
		pustPlochu();
		nezakryta = null;
		return 'konec';
	}
	if ((!zKlavesnice && !zHostitele) || (vyskaKorene >= vyska && vyska - viditelnaCast.vyska <= PRAH_KLAVESNICE)) {
		pustPlochu();
		nezakryta = null;
		return 'konec';
	}
	if (nezakryta) nezakryta.pomer = Math.max(0, vyska - vyskaKorene) / jmenovatel;
	return 'klavesnice';
}
// převzetí rozměru kořene (nebo držené nezakryté plochy): nová plocha, první fit, nebo přepočet orientace
function prevezmiRozmer() {
	let predchozi = { ...pohled };
	const [puvodniSirka, puvodniVyska] = plochaPohledu;
	const puvodniOtoceni = otoceno, puvodniNatazeni = natazeni;
	zmenVelikost();
	if (pozastaveno) return;
	if (!fitHotov) { prvniFit(); return; }
	const zmenaRozlozeni = srovnejOrientaci();
	if (!zmenaRozlozeni && sirka === puvodniSirka && vyska === puvodniVyska) { pohled3d?.obnovVelikost(); return; }
	// Cíl letu ještě patří původní ploše. Dokončení musí vybrat výsledek hledání dřív, než převedeme jeho střed .
	if (let_) {
		const dokoncenyLet = let_;
		let_ = null;
		pohled = { ...dokoncenyLet.cil };
		dokoncenyLet.poTe();
		predchozi = { ...pohled };
	}
	// Fit obnoví jen meze zoomu. Bod pod středem se převádí přes základní rozložení; výběr centrujeme jen při otočení.
	const wx = (puvodniSirka / 2 - predchozi.x) / predchozi.k, wy = (puvodniVyska / 2 - predchozi.y) / predchozi.k;
	const zakladX = puvodniOtoceni ? wy / puvodniNatazeni : wx / puvodniNatazeni, zakladY = puvodniOtoceni ? -wx : wy;
	const centrujVyber = vybrany >= 0 && otoceno !== puvodniOtoceni;
	const stredX = centrujVyber ? px[vybrany] : otoceno ? -zakladY : zakladX * natazeni;
	const stredY = centrujVyber ? py[vybrany] : otoceno ? zakladX * natazeni : zakladY;
	if (zmenaRozlozeni) { zavislostiCache = null; kotva = null; prizpusobPohled(); }
	const k = omezK(predchozi.k);
	pohled = { k, x: sirka / 2 - stredX * k, y: vyska / 2 - stredY * k };
	// Rozpracované gesto má souřadnice ze staré plochy a po resize by obnovený pohled přepsalo.
	zrusDrzeni(); zrusGesto();
	pohled3d?.obnovVelikost();
	zneplatniStatiku();
}
// konec klávesnice hlášený viewportem (nebo zjištěný časovačem držení) zpracuje rozměr hned (kořen se mohl mezitím změnit)
function poZmeneViewportu() {
	prepocitejViditelnouCast();
	const klavesnice = sledujKlavesnici();
	if (klavesnice === 'konec' || klavesnice === 'drzena') prevezmiRozmer();
	posunPlatna();
}
// každý posluchač jde přes předanou registraci a do seznamu instance, aby ho destroy() odebral i bez hostitele
function naslouchej<K extends keyof GlobalEventHandlersEventMap>(cil: EventTarget, typ: K, fn: (udalost: GlobalEventHandlersEventMap[K]) => void, dalsi?: AddEventListenerOptions) { posluchace.push({ cil, typ, fn: fn as EventListener, volby: dalsi }); registruj(cil, typ, fn as EventListener, dalsi); }
function napojOvladani() {
	const ukazatele = new Map<number, { x: number; y: number }>();
	let tazeni = false, start: { x: number; y: number; px: number; py: number; prerusenyLet?: Let2d | null } | null = null, sevreni: { d: number; k: number; sx: number; sy: number; px: number; py: number } | null = null, posledniTap = { cas: 0, x: 0, y: 0, uzel: -1 };
	zrusGesto = () => { posledniTap.cas = 0; ukazatele.clear(); start = null; sevreni = null; tazeni = false; platno.classList.remove('tahnu'); };   // pointerup po pauze pak nic nevybere
	naslouchej(platno, 'pointerdown', (e) => {
		if (e.button !== 0) return;   // jen primární tlačítko: dotyk a hrot pera mají 0, pravé a prostřední myši i tlačítko pera ne (review B3d r2)
		if (uOkrajeObrazovky(e)) return;   // okraj obrazovky nech Obsidianu (swipe panelů): bez zachycení, tažení i podržení
		const prerusenyLet = prerusLet();   // gesto přebírá právě zobrazený pohled, bez dalšího kroku letu
		platno.setPointerCapture(e.pointerId);
		const [x, y] = bodPlatna(e);
		ukazatele.set(e.pointerId, { x, y });
		zavriVysledky();
		if (ukazatele.size === 1) {
			start = { x, y, px: pohled.x, py: pohled.y, prerusenyLet };
			tazeni = false;
			zrusDrzeni();
			casovacDrzeni = okno.setTimeout(() => { casovacDrzeni = null; tazeni = true; dvojitaAkce(zasah(x, y)); }, 550);
		} else if (ukazatele.size === 2) {
			posledniTap.cas = 0;
			zrusDrzeni();
			const [a, b] = [...ukazatele.values()];
			sevreni = { d: Math.hypot(a.x - b.x, a.y - b.y), k: pohled.k, sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, px: pohled.x, py: pohled.y };
			tazeni = true;
		}
	});
	naslouchej(platno, 'pointermove', (e) => {
		if (!ukazatele.has(e.pointerId)) return;
		const [x, y] = bodPlatna(e);
		ukazatele.set(e.pointerId, { x, y });
		if (ukazatele.size === 2 && sevreni) {
			const [a, b] = [...ukazatele.values()];
			const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
			const k = omezK(sevreni.k * Math.pow(d / Math.max(1, sevreni.d), CITLIVOST_SEVRENI)), pomer = k / sevreni.k;
			pohled = { k, x: mx - (sevreni.sx - sevreni.px) * pomer, y: my - (sevreni.sy - sevreni.py) * pomer };
			zneplatniStatiku();
			return;
		}
		if (ukazatele.size === 1 && start) {
			const dx = x - start.x, dy = y - start.y;
			if (!tazeni && Math.hypot(dx, dy) > 5) { tazeni = true; posledniTap.cas = 0; zrusDrzeni(); platno.classList.add('tahnu'); }
			if (tazeni) { pohled.x = start.px + dx; pohled.y = start.py + dy; zneplatniStatiku(); }
		}
	});
	const konec = (e: PointerEvent) => {
		if (!ukazatele.has(e.pointerId)) return;
		if (e.type === 'pointercancel') posledniTap.cas = 0;
		ukazatele.delete(e.pointerId);
		zrusDrzeni();
		platno.classList.remove('tahnu');
		if (ukazatele.size === 0) {
			if (!tazeni && start && e.type === 'pointerup') {
				const ted = performance.now();
				const [x, y] = bodPlatna(e);
				const dvojity = posledniTap.uzel >= 0 && posledniTap.cas > 0 && ted - posledniTap.cas < 350 && Math.hypot(x - posledniTap.x, y - posledniTap.y) < 24;
				const i = zasah(x, y);
				if (dvojity) { let_ = start.prerusenyLet!; if (let_) pozadujSnimek(); dvojitaAkce(posledniTap.uzel); posledniTap = { cas: 0, x: 0, y: 0, uzel: -1 }; }
				else { if (i >= 0) letNa(i, true); else vyber(-1); posledniTap = { cas: ted, x, y, uzel: i }; }
			}
			start = null; sevreni = null; tazeni = false;
		} else if (ukazatele.size === 1) {
			const [z] = [...ukazatele.values()];
			start = { x: z.x, y: z.y, px: pohled.x, py: pohled.y };
			sevreni = null; tazeni = true;
		}
	};
	naslouchej(platno, 'pointerup', konec);
	naslouchej(platno, 'pointercancel', konec);
	naslouchej(platno, 'wheel', (e) => {
		prerusLet();
		posledniTap.cas = 0;
		e.preventDefault();
		const faktor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
		const [x, y] = bodPlatna(e);
		priblizK(x, y, faktor);
	}, { passive: false });
	naslouchej(platno, 'dblclick', (e) => e.preventDefault());
	// překryvná klávesnice: visualViewport hlásí zmenšení a posun viditelné části; posluchače jdou přes registraci jako ostatní.
	// Přepočet hned po připojení : instance může vzniknout nad už zmenšeným viewportem (list otevřený s klávesnicí)
	// a žádná událost by pak nepřišla
	// konec klávesnice hlášený viewportem zpracuje rozměr hned (poZmeneViewportu)
	if (okno.visualViewport) {
		naslouchej(okno.visualViewport, 'resize', poZmeneViewportu);
		naslouchej(okno.visualViewport, 'scroll', poZmeneViewportu);
	}
	prepocitejViditelnouCast();   // stav při připojení
	// rozměry z kontejneru pohledu (observer na něm), ne z okna: změna velikosti panelu, skrytí listu (nulová plocha) i návrat; viditelnost listu navíc hlásí hostitel (nastavViditelnost).
	// Změna geometrie kořene mění i jeho viditelnou část : kořen zmenšený na plně viditelnou výšku bez události viewportu musí třídu klavesnice a posun odložit
	// Klávesnice (sledujKlavesnici) se pozná dřív, než se rozměr převezme: zmenšení kvůli ní plochu nemění.
	function poZmeneVelikosti() {
		prepocitejViditelnouCast();
		if (sledujKlavesnici() !== 'klavesnice') prevezmiRozmer();
		posunPlatna();
	}
	pozorovatel = new okno.ResizeObserver(poZmeneVelikosti);
	pozorovatel.observe(kontejner);
	// fokus opustil pole mapy: držení plochy se ověří znovu, klávesnice se mohla zavřít bez události viewportu 
	naslouchej(koren, 'focusout', () => { if (plochaPredKlavesnici) poZmeneViewportu(); });
	// Escape jen z pohledu (plátno má tabindex, hledání je uvnitř kořene), ne z celého dokumentu
	naslouchej(koren, 'keydown', (e) => {
		if (e.key === 'Escape') { if (!prvek('panel-menu').hidden) { zavriMenuPanelu(); e.stopPropagation(); } else if (!prvek('vysledky').hidden) zavriVysledky(); else vyber(-1); }
	});
}

// --- hledání ---
function zavriVysledky() { prvek('vysledky').hidden = true; }
function hledej(dotaz: string) {
	const seznam = prvek('vysledky');
	const q = bezDiakritiky(dotaz.trim());
	if (q.length < 2) { zavriVysledky(); return; }
	const shody = [];
	for (let i = 1; i < pocet; i++) {
		const poz = hledaciJmeno[i].indexOf(q);
		if (poz < 0) continue;
		shody.push({ i, skore: (poz === 0 ? 0 : 1) * 100 + (typ[i] === 0 ? 0 : 10) + jmeno[i].length });
		if (shody.length > 400) break;
	}
	shody.sort((a, b) => a.skore - b.skore);
	seznam.replaceChildren();
	if (!shody.length) { const li = vytvorPrvek(dokument, 'li'); li.className = 'prazdne'; li.textContent = texty.nicNenalezeno; seznam.append(li); }
	for (const { i } of shody.slice(0, 12)) {
		const li = vytvorPrvek(dokument, 'li');
		const nazev = vytvorPrvek(dokument, 'span'); nazev.className = 'nazev'; nazev.textContent = (typ[i] === 0 ? '▣ ' : '· ') + jmeno[i];
		const cestaEl = vytvorPrvek(dokument, 'span'); cestaEl.className = 'cesta'; cestaEl.textContent = cesta[i];
		li.append(nazev, cestaEl);
		li.dataset.uzel = String(i);
		seznam.append(li);
	}
	seznam.hidden = false;
}

// --- UI ---
function napojMenuPanelu() {
 naslouchej(koren, 'keydown', (e) => {
  if (e.key === 'Escape' && !prvek('panel-menu').hidden) { e.preventDefault(); e.stopPropagation(); zavriMenuPanelu(); }
  else if (e.key.toLowerCase() === 'r') zavriMenuPanelu();
 }, { capture: true });
 naslouchej(koren, 'focusout', (e) => { if (e.relatedTarget && !koren.contains(e.relatedTarget as Node)) zavriMenuPanelu(); });
 naslouchej(koren, 'pointerdown', (e) => { if (!(e.target as Element).closest('.mozek-panel-menu, .panel-cisla')) zavriMenuPanelu(); }, { capture: true });
 naslouchej(prvek('panel-cisla'), 'click', (e) => {
  const tlacitko = (e.target as Element).closest<HTMLButtonElement>('button[data-seznam]');
  if (tlacitko && !tlacitko.disabled) otevriMenuPanelu(tlacitko.dataset.seznam!);
 });
 naslouchej(prvek('panel-menu'), 'click', (e) => {
  const tlacitko = (e.target as Element).closest<HTMLButtonElement>('button[data-uzel]');
  if (tlacitko) letZPanelu(Number(tlacitko.dataset.uzel));
 });
 naslouchej(prvek('panel-zpet'), 'click', () => {
  let predchozi: string | undefined;
  while ((predchozi = historiePanelu.pop()) !== undefined) {
   const i = cesta.indexOf(predchozi);
   if (i >= 0) { letZPanelu(i, true); return; }
  }
  naplnPanel();
 });
}
function napojUI() {
	if (volby.obnov) naslouchej(prvek('obnovit'), 'click', () => volby.obnov?.());
	const nastaveni = prvek('nastaveni'), tlacitko = prvek('nastaveni-tlacitko');
	naslouchej(tlacitko, 'click', () => { nastaveni.hidden = !nastaveni.hidden; tlacitko.setAttribute('aria-expanded', String(!nastaveni.hidden)); });
	const ostatni = prvek('ostatni');
	ostatni.checked = ostatniZapnute;
	naslouchej(ostatni, 'change', () => nastavOstatni(ostatni.checked));
	const zavislosti = prvek('zavislosti');
	zavislosti.checked = zavislostiZapnute;
	naslouchej(zavislosti, 'change', () => { zavislostiZapnute = zavislosti.checked; uloz(KLIC.zavislosti, zavislostiZapnute ? '1' : '0'); if (!zavislostiZapnute) prvek('zavislosti-info').textContent = ''; zneplatniStatiku(); });
	const hloubka3d = prvek('hloubka');
	hloubka3d.checked = hloubkaZapnuta;
	naslouchej(hloubka3d, 'change', () => nastavHloubku(hloubka3d.checked));
	naslouchej(prvek('rozbalit-vse'), 'click', () => { sbalene = new Set(); ulozSbalene(); naplnPanel(); zneplatniStatiku(); });
	naslouchej(prvek('sbalit-vse'), 'click', () => {
		sbalene = new Set();
		for (let i = 1; i < pocet; i++) if (typ[i] === 0 && potomci[i].length) sbalene.add(cesta[i]);
		ulozSbalene(); naplnPanel(); zneplatniStatiku();
	});
	const paleta = prvek('paleta');
	paleta.value = String(paletaIdx);
	naslouchej(paleta, 'change', () => { paletaIdx = Number(paleta.value) || 0; uloz(KLIC.paleta, String(paletaIdx)); obarvi(); zneplatniStatiku(); });
	const hledat = prvek('hledat');
	naslouchej(hledat, 'input', () => hledej(hledat.value));
	// jeden delegovaný posluchač na seznamu : položky se s každým dotazem vyměňují a registrace na každé z nich by u hostitele i v seznamu instance zůstala až do destroy
	naslouchej(prvek('vysledky'), 'click', (e) => {
		const cilKliku = e.target as Element | null;
		const polozka = cilKliku && typeof cilKliku.closest === 'function' ? (cilKliku.closest<HTMLElement>('li[data-uzel]')) : null;
		if (!polozka) return;
		zavriVysledky(); prvek('hledat').value = ''; letNa(Number(polozka.dataset.uzel));
	});
	naslouchej(hledat, 'focus', () => { if (hledat.value) hledej(hledat.value); });
	naslouchej(hledat, 'keydown', (e) => {
		if (e.key === 'Enter') { const prvni = prvek('vysledky').querySelector<HTMLElement>('li:not(.prazdne)'); if (prvni) prvni.click(); }
	});
	naslouchej(prvek('panel-zavrit'), 'click', () => vyber(-1));
	naslouchej(prvek('panel-zrusit'), 'click', () => vyber(-1));
	naslouchej(prvek('panel-sbalit'), 'click', () => { if (vybrany >= 0) prepniSbaleni(vybrany); });
	naslouchej(prvek('panel-obsidian'), 'click', () => { if (vybrany >= 0 && typ[vybrany] !== 0) otevriVObsidianu(vybrany); });
	naslouchej(prvek('pohled-2d'), 'click', () => nastavPohled('2d'));
	naslouchej(prvek('pohled-3d'), 'click', () => nastavPohled('3d'));
	const krouzeni = prvek('krouzeni');
	krouzeni.checked = nacti(KLIC.krouzeni) !== '0';
	naslouchej(krouzeni, 'change', () => { uloz(KLIC.krouzeni, krouzeni.checked ? '1' : '0'); if (pohled3d) pohled3d.nastavKrouzeni(krouzeni.checked); });
	naslouchej(prvek('celek'), 'click', () => { zavriMenuPanelu(); if (vybrany >= 0 && prvek('celek').textContent === texty.detail) { letNa(vybrany, false, true); return; } if (pohled3dAktivni) pohled3d!.celek(); else celek2d(); });
}
// Přepínač pohledu: 3D jen když je WebGL; bez něj (nebo po neobnovené ztrátě kontextu) zůstane tlačítko neaktivní s důvodem.
// Návrat s výběrem používá stejný let jako klik ve 2D, až po převzetí rozměru plochy.
function nastavPohled(rezim: string, ulozit = true, centruj = true) {
 zavriMenuPanelu();
	const tri = rezim === '3d' && pohled3d && pohled3d.podporovano;
	if (tri && !pohled3dAktivni) { zrusSnimek(); let_ = null; pohled3dAktivni = true; koren.classList.add('pohled-3d'); pohled3d!.zapni(); }
	else if (!tri && pohled3dAktivni) { pohled3dAktivni = false; pohled3d!.vypni(); koren.classList.remove('pohled-3d'); prevezmiRozmer(); if (centruj && vybrany >= 0 && !pozastaveno) letNa(vybrany, true); statikaSpinava = true; pozadujSnimek(); }
	// skutečný stav až po zapnutí: zapni() může synchronně selhat a přes vypadek3d přepnout zpět do 2D
	const ted = pohled3dAktivni;
	prvek('pohled-2d').setAttribute('aria-pressed', String(!ted));
	prvek('pohled-3d').setAttribute('aria-pressed', String(ted));
	if (ulozit) uloz(KLIC.pohled, ted ? '3d' : '2d');
	aktualizujCelek();
}
function oznacPodporu3d() {
	const tlacitko = prvek('pohled-3d'), info = prvek('pohled-info'), ok = pohled3d && pohled3d.podporovano;
	tlacitko.disabled = !ok;
	info.textContent = ok ? '' : texty.nelze3d(pohled3d ? pohled3d.duvodNepodpory : texty.bez3dVPluginu);
}
function vypadek3d() { nastavPohled('2d', false); oznacPodporu3d(); }
// rozhraní pro mozek3d.js: data a odvozené struktury jen ke čtení, akce přes funkce 2D (výběr, panel)
function jadroPro3d() {
	const stav = prvek('stav');
	return {
		pocet, rodic, typ, vaha, jmeno, cesta, hloubka, potomci, konecPodstromu, vazby, odchozi, prichozi,
		get barva() { return barva; }, get barvaRgb() { return barvaRgb; }, get paleta() { return PALETY[paletaIdx]; },
		get sbalene() { return sbalene; }, get zavislostiZapnute() { return zavislostiZapnute; }, get vybrany() { return vybrany; },
		jeTelefon, vyber, vazbyUzlu, polomerUrovne, odchylka, hexNaRgb, rgbNaCss, velikostPopisku, pismoPopisku, sirkaTextu, zavriVysledky,
		// 2D rozložení a pravidla popisků pro 3D odvozené z 2D (k8): pozice, tečny, tloušťky, rozestupy, hlavní větev, orientace
		get px() { return px; }, get py() { return py; }, get smer() { return smer; }, get tloustka() { return tloustka; }, get rozestup() { return rozestup; }, vetev,
		get otoceno() { return otoceno; }, get natazeni() { return natazeni; },
		ZLATY_UHEL, MAX_KRIVEK, PRAH_ROZESTUPU, PREHLED_DO, POPISEK_OD, MAX_POPISKU, RUST_POPISKU_SE_ZOOMEM: ROZPOCET_POPISKU.rustSZoomem,
		rozpocetPopiskuZaklad: (w: number, h: number) => sevri(Math.round(ROZPOCET_POPISKU.zaklad + w * h * ROZPOCET_POPISKU.naPx), ROZPOCET_POPISKU.min, ROZPOCET_POPISKU.max),
		infoZavislosti: (text: string) => { prvek('zavislosti-info').textContent = text; },
		hlaska: (text: string) => { stav.classList.remove('chyba'); stav.textContent = text || ''; stav.hidden = !text; },
		vypadek3d, oznacPodporu3d, zmerSnimek, aktualizujCelek, texty,
		platno3d: prvek('platno3d'), popisky3d: prvek('popisky3d'),
		registruj, rozmery: (): [number, number] => [sirka, vyska], jePozastaveno: () => pozastaveno, uOkrajeObrazovky
	};
}
function nastavOstatni(zapnout: boolean) {
	ostatniZapnute = Boolean(zapnout);
	uloz(KLIC.ostatni, ostatniZapnute ? '1' : '0');
	prestavStruktury();
}
// přestavba nad zdrojovaData ve stejné instanci (Ostatní soubory, nastavData): strom, rozložení, barvy, orientace;
// výběr se dohledá podle cesty, pohled (posun, měřítko) a volby zůstávají
function prestavStruktury() {
 klicCelku = '';
	const vybranaCesta = vybrany >= 0 ? cesta[vybrany] : null;
	let_ = null;
	zavriVysledky();
	pripravStruktury(zdrojovaData);
	rozloz(); obarvi(); srovnejOrientaci();
	kotva = null; zavislostiCache = null; verzeViditelnosti = 0;
	viditelne = []; individualni = null!;
	zasahyPopisku.clear(); zasahyPopiskuVyberu.clear(); uzlyPopiskuVyberu = [];
	vyber(vybranaCesta === null ? -1 : cesta.indexOf(vybranaCesta));
	if (pohled3d) pohled3d.zmenData(jadroPro3d());
	zneplatniStatiku();
}
function nastavHloubku(zapnout: boolean) {
	hloubkaZapnuta = Boolean(zapnout);
	uloz(KLIC.hloubka, hloubkaZapnuta ? '1' : '0');
	const pole = prvek('hloubka');
	if (pole) pole.checked = hloubkaZapnuta;
	zneplatniStatiku();
}
function nactiVolby() {
	const p = Number(nacti(KLIC.paleta));
	paletaIdx = Number.isInteger(p) && p >= 0 && p < PALETY.length ? p : 0;
	try { const s: unknown = JSON.parse(nacti(KLIC.sbalene) || '[]'); if (Array.isArray(s)) sbalene = new Set(s.filter((x) => typeof x === 'string')); } catch { sbalene = new Set(); }
	zavislostiZapnute = nacti(KLIC.zavislosti) === '1';
	hloubkaZapnuta = nacti(KLIC.hloubka) !== '0';
	ostatniZapnute = nacti(KLIC.ostatni) === '1';
}

// první fit až s nenulovou plochou: list v Obsidianu může vzniknout bez rozměru, pak ho zavolá ResizeObserver
function prvniFit() {
	fitHotov = true;
	srovnejOrientaci();
	prizpusobPohled();
	// návrat (Zpět): uložený pohled místo úvodního; kFit z úvodního pohledu drží meze zoomu stejné jako bez návratu
	if (cekajiciPohled) { pouzijStavPohledu(cekajiciPohled); cekajiciPohled = null; }
	kresliStatiku();
	pohled3d?.obnovVelikost();
	pozadujSnimek();
}
// obsluhy (ukazatele, observer, UI) se napojí jen jednou za život instance: první start nad neplatnými daty je nenapojí a nastavData
// je pak napojí s prvním úspěšným startem, bez duplicit . Napojení je transakce : když registrace uprostřed
// vyhodí (hostitel, chybějící prvek), už přidané posluchače a observer se odeberou a příznak zůstane dole, příští start napojí znovu
function napojObsluhy() {
	if (obsluhyNapojeny) return;
	const napojenoPred = posluchace.length;
	try {
		napojOvladani();
		napojUI();
		napojMenuPanelu();
	} catch (chyba) {
		odpojObsluhy(napojenoPred);
		throw chyba;
	}
	obsluhyNapojeny = true;
}
// odebere posluchače přidané od pozice `od` v seznamu instance a observer kontejneru; posluchač, u něhož registrace vyhodila, je
// v seznamu bez skutečné registrace a removeEventListener na něm nic neudělá
function odpojObsluhy(od: number) {
	for (const p of posluchace.splice(od)) p.cil.removeEventListener(p.typ, p.fn, p.volby);
	if (pozorovatel) { pozorovatel.disconnect(); pozorovatel = null; }
}
function start(vstup: DataMapy) {
	const stav = prvek('stav');
	nactiVolby();
	try {
		zdrojovaData = overData(vstup);
		pripravStruktury(zdrojovaData);
		const zacatekRozlozeni = performance.now();
		rozloz();
		const rozlozeniMs = performance.now() - zacatekRozlozeni;
		obarvi();
		zmenVelikost();
		napojObsluhy();
		stav.hidden = true;
		stav.classList.remove('chyba');
		if (!pozastaveno) prvniFit();
		pohled3d?.destroy();
		pohled3d = vytvorPohled3d(jadroPro3d());
		pohled3d?.obnovKameru(kameraObnovy);
		if (pohled3d) pohled3d.nastavKrouzeni(prvek('krouzeni').checked);
		oznacPodporu3d();
		nastavPohled(rezimObnovy ?? (nacti(KLIC.pohled) === '3d' ? '3d' : '2d'), false);
		rezimObnovy = null;
		ladeni = {
			get posledniVykresleniMs() { return posledniVykresleniMs; }, get pohled() { return { ...pohled }; }, prekresli() { kresliStatiku(); return posledniVykresleniMs; },
			get pocetUzlu() { return pocet; }, get pocetVazeb() { return vazby.length; }, rozlozeniMs, get pocetViditelnych() { return viditelne.length; },
			get popisky() { return [...zasahyPopisku].map(([id, o]) => ({ id, ...o })); }, get zvyrazneneBody() { return uzlyPopiskuVyberu.map((v) => ({ id: v.id, x: v.x, y: v.y, r: v.r })); }, get popiskyVyberu() { return [...zasahyPopiskuVyberu].map(([id, o]) => ({ id, ...o })); },
			get rozpocetPopisku() { return rozpocetPopisku(); }, get vetve() { return Array.from(vetev); }, get kFit() { return kFit; },
			get leti() { return let_ !== null; },
			get ohraniceniFitu() { return fitObrazovka ? [...fitObrazovka] : null; },
			get otoceno() { return otoceno; }, get natazeni() { return natazeni; }, get hlavniVetve() { return potomci[0].filter((d) => typ[d] === 0); },
			get hloubka() { return hloubkaZapnuta; }, nastavHloubku, get vybrany() { return vybrany; },
			zasah, poziceUzlu, promitni: (i: number) => { const s = meritkoZ(i); return { xy: naObrazovku(px[i], py[i], s), z: zet[i], s }; },
			get hloubky() { return Array.from(hloubka); }, get typy() { return Array.from(typ); }, get polomery() { const r = new Array<number>(pocet); for (let i = 0; i < pocet; i++) r[i] = Math.hypot(pxZakl[i], pyZakl[i]); return r; },
			get cesty() { return cesta; }, get pozice() { return [Array.from(px), Array.from(py), Array.from(zet)]; }, prepinace: ladeniPrepinace, vyber, letNa, priblizK, pripraveno: true,
			get rezim() { return pohled3dAktivni ? '3d' : '2d'; }, nastavPohled, get pohled3d() { return pohled3d ? pohled3d.ladeni : null; }, get podpora3d() { return pohled3d ? { podporovano: pohled3d.podporovano, duvod: pohled3d.duvodNepodpory } : null; },
			get sbalene() { return [...sbalene]; },
			get rozmery() { return [sirka, vyska]; }, get pozastaveno() { return pozastaveno; }, get nezakryta() { return nezakryta ? { ...nezakryta } : null; }, get meridlo() { return { ...meridlo }; }
		};
	} catch (chyba: unknown) {
		stav.hidden = false;
		stav.classList.add('chyba');
		stav.textContent = texty.nacteniSelhalo((chyba as Error).message);
	}
}
// nová data (Obnovit v B2, změna vaultu): strom, rozložení a barvy se přestaví ve stejné instanci, volby, pohled i DOM zůstanou;
// neplatný tvar dat vyhodí chybu volajícímu, instance zůstane nad starými daty; po chybném startu (žádná stará data) je to první
// start nad novými daty: chyba jde jako při vzniku do stavového řádku, obsluhy se napojí právě jednou
function nastavData(novaData: DataMapy) {
	if (zniceno) return;
	if (!ladeni.pripraveno) { start(novaData); return; }
	zdrojovaData = overData(novaData);
	prestavStruktury();
}
// volby zvenku (B2 nastavení) pod týmiž klíči mozek.* jako hodnoty při vzniku; null klíč zapomene; hostiteli se nic nehlásí,
// změna Ostatních souborů přestaví strom, ostatní volby jen přebarví nebo překreslí. Hodnoty se uloží i před úspěšným startem
// : do UI a struktur se promítnou až s ním (start čte hodnoty přes nactiVolby)
function nastavVolby(zmeny: Readonly<Record<string, string | null>>) {
	if (zniceno) return;
	for (const [klic, hodnota] of Object.entries(zmeny)) { if (hodnota === null || hodnota === undefined) delete hodnoty[klic]; else hodnoty[klic] = String(hodnota); }
	if (!ladeni.pripraveno) return;
	const ostatniPred = ostatniZapnute, paletaPred = paletaIdx;
	nactiVolby();
	prvek('ostatni').checked = ostatniZapnute; prvek('zavislosti').checked = zavislostiZapnute; prvek('hloubka').checked = hloubkaZapnuta;
	prvek('paleta').value = String(paletaIdx); prvek('krouzeni').checked = nacti(KLIC.krouzeni) !== '0';
	if (!zavislostiZapnute) prvek('zavislosti-info').textContent = '';
	if (pohled3d) pohled3d.nastavKrouzeni(prvek('krouzeni').checked);
	if (ostatniZapnute !== ostatniPred) prestavStruktury();
	else { if (paletaIdx !== paletaPred) obarvi(); naplnPanel(); }
	if (Object.prototype.hasOwnProperty.call(zmeny, KLIC.pohled)) nastavPohled(nacti(KLIC.pohled) === '3d' ? '3d' : '2d', false);
	zneplatniStatiku();
}
// událost resolved v Obsidianu: jen vazby, strom a rozložení zůstanou ; po destroy nic
function nastavVazby(links: Vazba[]) {
	if (zniceno || !zdrojovaData || !indexyZdroje) return;
	if (JSON.stringify(zdrojovaData.links) === JSON.stringify(links)) return;
	zdrojovaData = { ...zdrojovaData, links: Array.isArray(links) ? links : [] };
	pripravVazby(zdrojovaData);
	zavislostiCache = null;
	if (vybrany >= 0) { vyberVazby = vazbyUzlu(vybrany); naplnPanel(); }
	if (pohled3d) pohled3d.zmenData(jadroPro3d(), { jenVazby: true });
	zneplatniStatiku();
}
// úklid pohledu (onClose), i uprostřed podržení a letu: posluchače, časovač, rAF, observer, plátna, DOM kořene
function destroy() {
	if (zniceno) return;
	zniceno = true;
	for (const p of posluchace) p.cil.removeEventListener(p.typ, p.fn, p.volby);
	posluchace.length = 0;
	zrusDrzeni();
	zastavKontroluDrzeni();   // časovač kontroly držení 
	zrusSnimek(); let_ = null;
	if (pozorovatel) { pozorovatel.disconnect(); pozorovatel = null; }
	pohled3d?.destroy();
	pohled3d = null; pohled3dAktivni = false;
	sprity.clear(); sirkyTextu.clear();
	for (const c of [platno, statika, vrstvaHierarchie]) { c.width = 0; c.height = 0; }
	koren.remove();
}
start(data);
return { get ladeni() { return ladeni; }, meridlo, destroy, nastavData, nastavVolby, nastavVazby, zmenVelikost, nastavViditelnost, stavPohledu, obnovPohled };
}
