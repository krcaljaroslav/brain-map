import { vychoziTextyMapy } from './texty-mapy.ts';
export interface Kamera3d { kam: number[]; cil: number[]; nahoru: number[] }

// Historie listu nesmí dodat NaN, extrémní souřadnice ani degenerovanou bázi kamery.
export function platnaKamera3d(stav: any): Kamera3d | null {
 if (!stav || typeof stav !== 'object') return null;
 const { kam, cil, nahoru } = stav;
 if (![kam, cil, nahoru].every(v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7))) return null;
 const smer = kam.map((n: number, i: number) => n - cil[i]);
 const d = Math.hypot(...smer), u = Math.hypot(...nahoru);
 const kriz = [smer[1]*nahoru[2]-smer[2]*nahoru[1], smer[2]*nahoru[0]-smer[0]*nahoru[2], smer[0]*nahoru[1]-smer[1]*nahoru[0]];
 if (d < 1e-3 || d > 1e7 || u < 0.5 || u > 2 || Math.hypot(...kriz) / (d*u) < 1e-4) return null;
 return { kam: [...kam], cil: [...cil], nahoru: [...nahoru] };
}

// Adaptace webového rendereru: lokální DOM/čas, explicitní lifecycle, bez globální registrace.
export interface Jadro3d {
	platno3d: HTMLCanvasElement;
	popisky3d: HTMLCanvasElement;
	registruj(cil: EventTarget, typ: string, fn: (e: any) => void, volby?: AddEventListenerOptions): void;
	rozmery(): [number, number];
	jePozastaveno(): boolean;
	uOkrajeObrazovky(e: PointerEvent): boolean;
	[vlastnost: string]: any;
}
export function vytvorPohled3d(jadro: Jadro3d) { return modul3d().tovarna(jadro); }
export function rozlozZ2d(jadro: any) { return modul3d().rozlozZ2d(jadro); }
export function sestavGeometrii(jadro: any, rozlozeni: any) { return modul3d().sestavGeometrii(jadro, rozlozeni); }
// 3D pohled mapy Mozek (druhý, přepínatelný pohled vedle 2D). Rozložení je odvozené z hotového 2D neuronu: x a y bere z 2D
// rozložení (stejné měřítko a orientace), hloubka z roste podél větví - každá větev dostane deterministický náklon mimo rovinu,
// potomci ho dědí a přidávají vlastní, listy drží u své složky. Zepředu tak mapa vypadá jako 2D, po otočení se větve rozbíhají
// i do hloubky. Kreslení vlastním WebGL1 bez knihovny: kmeny větví jako pásy natočené ke kameře (prohnutá zvlněná křivka se
// stejnými parametry jako kresliVetev ve 2D, tloušťka podle tloustka[] a perspektivy, zúžení k potomkovi, druhý širší průchod
// jako záře), stopky listů jako prohnuté čáry, body se září, mlžný opar u svazků (billboardy s alfou 2D chomáče), vše aditivně,
// popisky na 2D plátně nad WebGL s pravidly 2D přehledu. Ovládání kamery typu trackball: jeden prst nebo levé tlačítko = volná
// rotace, dva prsty = zoom a posun, kolečko = zoom, pravé tlačítko nebo Shift/Ctrl/Cmd = posun, WASD + Q/E let, R celek,
// F k vybranému, Esc zruší výběr; ťuknutí na bod = výběr a přelet, po doletu a po 10 s klidu pomalé kroužení.
// Výpočty a shadery z webu 4a8725eb; každé volání vytváří vlastní uzávěr, výběr a panel poskytuje mapa.ts.
function modul3d() {
const KROUZENI = { uhlovaRychlost: 0.022, elevaceDeg: 8, periodaElevaceS: 90, dychani: 0.04, periodaDychaniS: 60, prodlevaMs: 10000, nabehMs: 2000 };
// dosednutí po ťuknutí: kamera se zastaví tak daleko, aby v zorném poli byl vybraný bod, jeho rodič a děti - poloměr záběru je větší
// z poloměru viditelného podstromu a 0,75× vzdálenosti k rodiči, sevřený mezi 2 % a 30 % poloměru mapy (dřív pevných 40-140 jednotek
// z Mini World Map, kde je svět mnohem menší; u nás kamera končila uvnitř chomáče paprsků vazeb a bez kontextu)
const PRELET = { podilPodstromu: 1.05, podilRodice: 0.75, minPolomer: 0.02, maxPolomer: 0.3, rezerva: 1.15, azimutRad: 15 * Math.PI / 180, minMs: 800, maxMs: 1800, msNaJednotku: 0.45 };
// čáry blízko kamery slábnou (podíl aktuální vzdálenosti kamery od cíle): paprsek, který prochází těsně kolem oka, by jinak byl šmouha přes celou obrazovku
const BLIZKO_CAR = [0.05, 0.2];
// úvodní záběr: zepředu (jako 2D), kamera tak daleko, aby obal promítnutých bodů zabral tento podíl užší strany
const PODIL_ZABERU = 0.9;
// zoom kolečkem a posun zrychlené po přejímce (Jaroslav 20. 10.): kolečko 2,5× proti vzoru (1,2), posun myší 2×, dvěma prsty 5× (vzor 0,3)
const RYCHLOST_ROTACE = 1.0, RYCHLOST_ZOOMU = 3.0, RYCHLOST_POSUNU = { mys: 0.6, dotyk: 1.5 };
const ZORNY_UHEL = 60 * Math.PI / 180;
const PRAH_TAPU = 5;                       // px: menší pohyb mezi stiskem a puštěním je ťuknutí, ne tažení
const MAX_DPR_TELEFON = 1.5, MAX_DPR = 2;
// hloubka z: náklon větve mimo rovinu se dědí z rodiče (DEDENI_NAKLONU) a přidává vlastní hash s rozptylem podle hloubky
// (obdoba ROZPTYL_Z ve 2D, ale v plném rozsahu); rozsah z se nakonec nastaví na HLOUBKA_PODIL delší strany 2D rozložení
const ROZPTYL_NAKLONU = [0, 1, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2];
const DEDENI_NAKLONU = 0.6, SKLON = 0.9, HLOUBKA_PODIL = 0.45;
const MAX_KUSU_PASU = 24, KUSU_STOPKY = 4;
// pás kmene: jádro a širší průhledná záře (jako kresliVetev: výplň 0,6 a tah 2,6× širší; záře 0,2 místo 0,14 ve 2D, protože měkký okraj pásu (1−s)² dává menší plochu než plný tah); meze tloušťky v px jako ve 2D
const PAS_JADRO = { nasobek: 1, alfa: 0.6, minPx: 0.6, maxPx: 28 }, PAS_ZARE = { nasobek: 2.6, alfa: 0.2, minPx: 2, maxPx: 80 };
const SILNA_VETEV = { hloubka: 2, tloustka: 2 };   // větev je „silná“ (má záři i v LOD 1 a nikdy není čarou), když je mělká nebo tlustá
// LOD: při pohybu se sleduje medián intervalu rAF; nad prahem se stupeň zvýší (1: záře jen u silných větví, 2: tenké větve jako čáry, bez oparu);
// v rámci relace neklesá, aby se obraz nepřepínal sem a tam. Vzorek je každý snímek navazující na předchozí: pohyb, který si ho vyžádal
// (řetěz animace, souvislé gesto, kolečko), začal do LOD_MEZERA_MS po konci JS předchozího snímku. Delší mezera je nečinnost mezi pohyby
// a snímek se nepočítá, nasbírané vzorky ale zůstávají; dlouhý snímek sám o sobě měření nikdy neruší - právě pomalá scéna má stupeň zvednout.
const LOD_PRAH_MS = 45, LOD_VZORKU = 40, MAX_LOD = 2, LOD_MEZERA_MS = 120;
const MAX_SKUPIN_VAZEB = 400, MAX_IMPULZU_SMER = 48;
const DOBA_PRELETU_CELEK = 1200;
const DOJEZD_CELKU_PO_RESIZE_MS = 240;   // nejkratší zbytek letu Celku po změně velikosti (jako závěrečná fáze vzdálenosti)
const POPISKU_VYBERU = { desktop: 24, telefon: 10 };
const ODSTUP_POPISKU_VETVE = 1.5, ODSTUP_POPISKU_NOUZE = 4;   // jako ve 2D: popisek hlavní větve nejdál tolikrát svou výšku od uzlu, jinak dál podél větve ven

// --- vektory a matice (sloupcově, jako WebGL) ---
const sub = (a: any, b: any) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: any, b: any) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const nasob = (a: any, k: any) => [a[0] * k, a[1] * k, a[2] * k];
const skalar = (a: any, b: any) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kriz = (a: any, b: any) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const delka = (a: any) => Math.hypot(a[0], a[1], a[2]);
const jednotkovy = (a: any) => { const d = delka(a) || 1; return [a[0] / d, a[1] / d, a[2] / d]; };
const sevri = (v: any, lo: any, hi: any) => Math.min(hi, Math.max(lo, v));
const hladce = (t: any) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
// otočení vektoru v kolem jednotkové osy k o úhel (Rodriguesův vzorec)
function otocKolem(v: any, k: any, uhel: any) {
	const c = Math.cos(uhel), s = Math.sin(uhel), kv = kriz(k, v), kd = skalar(k, v) * (1 - c);
	return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
// Kvaternion ortonormální báze kamery. Kladná skalární složka volí kratší oblouk k jednotkové orientaci.
function orientaceKamery(oko: any, nahoru: any) {
	const z = jednotkovy(oko);
	let bok = kriz(nahoru, z);
	if (delka(bok) < 1e-6) bok = kriz(Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], z);
	const x = jednotkovy(bok), y = kriz(z, x);
	const m = [x, y, z], q = [0, 0, 0, 0], stopa = x[0] + y[1] + z[2];
	if (stopa > 0) {
		const s = Math.sqrt(stopa + 1) * 2;
		q[3] = s / 4; q[0] = (y[2] - z[1]) / s; q[1] = (z[0] - x[2]) / s; q[2] = (x[1] - y[0]) / s;
	} else {
		const i = x[0] > y[1] && x[0] > z[2] ? 0 : y[1] > z[2] ? 1 : 2, b = (i + 1) % 3, c = (i + 2) % 3;
		const s = Math.sqrt(1 + m[i][i] - m[b][b] - m[c][c]) * 2;
		q[i] = s / 4; q[b] = (m[b][i] + m[i][b]) / s; q[c] = (m[c][i] + m[i][c]) / s; q[3] = (m[b][c] - m[c][b]) / s;
	}
	if (q[3] < 0) for (let i = 0; i < 4; i++) q[i] = -q[i];
	const osa = jednotkovy(q.slice(0, 3)), uhel = 2 * Math.acos(sevri(q[3], -1, 1));
	return { osa, uhel };
}
function pohledovaMatice(oko: any, cil: any, nahoru: any) {
	const f = jednotkovy(sub(cil, oko));
	let s = kriz(f, nahoru);
	if (delka(s) < 1e-6) s = kriz(f, Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
	s = jednotkovy(s);
	const u = kriz(s, f);
	return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -skalar(s, oko), -skalar(u, oko), skalar(f, oko), 1]);
}
function perspektivniMatice(fov: any, pomer: any, blizko: any, daleko: any) {
	const f = 1 / Math.tan(fov / 2), nf = 1 / (blizko - daleko);
	return new Float32Array([f / pomer, 0, 0, 0, 0, f, 0, 0, 0, 0, (daleko + blizko) * nf, -1, 0, 0, 2 * daleko * blizko * nf, 0]);
}
function nasobMatice(a: any, b: any) {
	const o = new Float32Array(16);
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
	return o;
}
function hladceKubicky(t: any) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// --- 3D rozložení odvozené z 2D (deterministické: stejná data a orientace = stejné pozice) ---
// x, y = hotové 2D rozložení (px, py; y obrácené, ať je nahoře nahoře), střed obalu v počátku. Hloubka z roste podél větví:
// složka zdědí část náklonu rodiče a přidá vlastní (hash cesty, rozptyl podle hloubky), z = z rodiče + délka větve × náklon × SKLON;
// list pokračuje ve sklonu složky s vlastním rozptylem, takže svazek má tloušťku i v z. Nakonec se z přeškáluje tak, aby jeho rozsah
// byl HLOUBKA_PODIL delší strany 2D rozložení (z boku je mapa zřetelně prostorová, zepředu se promítá přesně na 2D).
function rozlozZ2d(j: any) {
	const { pocet, rodic, typ, vaha, cesta, hloubka, odchylka, px, py } = j;
	const poz = new Float32Array(pocet * 3), polomerSveta = new Float32Array(pocet), naklon = new Float64Array(pocet), z = new Float64Array(pocet);
	const rozptyl = (h: any) => ROZPTYL_NAKLONU[Math.min(h, ROZPTYL_NAKLONU.length - 1)];
	for (let i = 1; i < pocet; i++) {
		const p = rodic[i], L = Math.hypot(px[i] - px[p], py[i] - py[p]);
		if (typ[i] === 0) {
			naklon[i] = sevri(naklon[p] * DEDENI_NAKLONU + odchylka(cesta[i], 'naklon3d') * rozptyl(hloubka[i]), -1, 1);
			z[i] = z[p] + L * naklon[i] * SKLON;
		} else z[i] = z[p] + L * (naklon[p] * DEDENI_NAKLONU + odchylka(cesta[i], 'naklon3d') * 0.5) * SKLON;
	}
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
	for (let i = 0; i < pocet; i++) { x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]); y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]); z0 = Math.min(z0, z[i]); z1 = Math.max(z1, z[i]); }
	const delsiStrana = Math.max(x1 - x0, y1 - y0, 1e-6), kZ = HLOUBKA_PODIL * delsiStrana / Math.max(1e-9, z1 - z0);
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
	for (let i = 0; i < pocet; i++) {
		poz[i * 3] = px[i] - cx; poz[i * 3 + 1] = -(py[i] - cy); poz[i * 3 + 2] = (z[i] - cz) * kZ;
		polomerSveta[i] = i === 0 ? 14 : typ[i] === 2 ? 1.7 : typ[i] === 1 ? 2.4 : Math.min(20, 3.2 + 0.55 * Math.sqrt(vaha[i]));
	}
	// obaly podstromů (těžiště a poloměr) pro opar a směr popisku hlavní větve, jako spocitejObalky ve 2D
	const sumX = new Float64Array(pocet), sumY = new Float64Array(pocet), sumZ = new Float64Array(pocet), poc = new Int32Array(pocet);
	for (let i = pocet - 1; i >= 0; i--) {
		sumX[i] += poz[i * 3]; sumY[i] += poz[i * 3 + 1]; sumZ[i] += poz[i * 3 + 2]; poc[i] += 1;
		if (i > 0) { const r = rodic[i]; sumX[r] += sumX[i]; sumY[r] += sumY[i]; sumZ[r] += sumZ[i]; poc[r] += poc[i]; }
	}
	const tez = new Float32Array(pocet * 3), podR = new Float32Array(pocet);
	for (let i = 0; i < pocet; i++) { tez[i * 3] = sumX[i] / poc[i]; tez[i * 3 + 1] = sumY[i] / poc[i]; tez[i * 3 + 2] = sumZ[i] / poc[i]; }
	for (let i = 0; i < pocet; i++) for (let a = i; a >= 0; a = rodic[a]) {
		const d = Math.hypot(poz[i * 3] - tez[a * 3], poz[i * 3 + 1] - tez[a * 3 + 1], poz[i * 3 + 2] - tez[a * 3 + 2]);
		if (d > podR[a]) podR[a] = d;
	}
	let R = 1;
	for (let i = 0; i < pocet; i++) R = Math.max(R, Math.hypot(poz[i * 3], poz[i * 3 + 1], poz[i * 3 + 2]));
	return { poz, polomerSveta, tez, podR, R, otoceno: j.otoceno, natazeni: j.natazeni, rozsah: { x: x1 - x0, y: y1 - y0, z: (z1 - z0) * kZ } };
}
// Geometrie větví, stopek a oparu z rozložení (jednou po rozložení). Větev rodič→složka: bezierova křivka s tečnami podle smer
// (jako kresliVetev: tečna rodiče 0,38 délky, potomka 0,3), zvlněná po délce s hashem cesty, z lineárně; pás = 2 vrcholy na vzorek
// (strana ±1), zúžení od w0 (rodič) k w1 (potomek) ve světových jednotkách (1 jednotka ≈ 1 px při úvodním záběru, jako tloustka × kFit
// ve 2D). Pásy jdou v jednom TRIANGLE_STRIP s degenerovanými přechody, silné větve první (LOD kreslí záři jen jim). Stopka listu: 4 kusy
// bezieru jako pridejStopku, síla slábne s velikostí svazku. Opar: billboard na těžišti každého podstromu s poloměrem obalu.
function sestavGeometrii(j: any, rozlozeni: any) {
	const { pocet, rodic, typ, vaha, cesta, hloubka, potomci, odchylka, smer, tloustka, barvaRgb } = j;
	const p = rozlozeni.poz, smerSveta = (i: any) => -smer[i];   // 2D má y dolů, svět y nahoru: úhel se obrací
	const X = new Float64Array(MAX_KUSU_PASU + 1), Y = new Float64Array(MAX_KUSU_PASU + 1), Z = new Float64Array(MAX_KUSU_PASU + 1);
	const bezier = (a0: any, c1: any, c2: any, b0: any, t: any) => { const mt = 1 - t; return mt * mt * mt * a0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * b0; };
	const derivace = (a0: any, c1: any, c2: any, b0: any, t: any) => { const mt = 1 - t; return 3 * mt * mt * (c1 - a0) + 6 * mt * t * (c2 - c1) + 3 * t * t * (b0 - c2); };
	const silna = (b: any) => hloubka[b] <= SILNA_VETEV.hloubka || tloustka[b] >= SILNA_VETEV.tloustka;
	const vetve: any[] = [];
	for (let i = 1; i < pocet; i++) if (typ[i] === 0) vetve.push(i);
	vetve.sort((a: any, b: any) => (Number(silna(b)) - Number(silna(a))) || (a - b));
	const pas = { poz: [] as number[], tecna: [] as number[], strana: [] as number[], sirka: [] as number[], barva: [] as number[], uzel: [] as number[] }, tenke = { poz: [] as number[], barva: [] as number[], uzel: [] as number[] };
	let pasSilnychVrcholu = 0;
	for (const b of vetve) {
		const a = rodic[b], ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
		const L = Math.hypot(bx - ax, by - ay);
		if (L < 0.5) continue;
		const ua = a === 0 ? Math.atan2(by - ay, bx - ax) : smerSveta(a), ub = smerSveta(b);
		const c1x = ax + Math.cos(ua) * L * 0.38, c1y = ay + Math.sin(ua) * L * 0.38, c2x = bx - Math.cos(ub) * L * 0.3, c2y = by - Math.sin(ub) * L * 0.3;
		const kusu = sevri(Math.round(L / 20), 6, MAX_KUSU_PASU);
		const amplituda = L * 0.05 * (1 + 0.4 * odchylka(cesta[b], 'vlna'));
		const vln = (1.5 + odchylka(cesta[b], 'frekvence') * 0.5) * Math.PI * 2, faze = odchylka(cesta[b], 'faze') * Math.PI;
		for (let s = 0; s <= kusu; s++) {
			const t = s / kusu;
			let dx = derivace(ax, c1x, c2x, bx, t), dy = derivace(ay, c1y, c2y, by, t);
			const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
			const vlna = amplituda * Math.sin(t * Math.PI) * Math.sin(t * vln + faze);
			X[s] = bezier(ax, c1x, c2x, bx, t) - dy * vlna; Y[s] = bezier(ay, c1y, c2y, by, t) + dx * vlna; Z[s] = az + (bz - az) * t;
		}
		const w1 = tloustka[b], w0 = Math.max(w1, Math.min(tloustka[a] * 0.85, w1 * 1.8));
		const [r, g, bl] = barvaRgb[b].map((v: any) => v / 255);
		const pridej = (s: any, strana: any) => {
			const s0 = Math.max(0, s - 1), s1 = Math.min(kusu, s + 1);
			pas.poz.push(X[s], Y[s], Z[s]); pas.tecna.push(X[s1] - X[s0], Y[s1] - Y[s0], Z[s1] - Z[s0]);
			pas.strana.push(strana); pas.sirka.push(w0 + (w1 - w0) * s / kusu); pas.barva.push(r, g, bl); pas.uzel.push(b);
		};
		if (pas.uzel.length) pridej(0, -1);   // degenerovaný přechod od předchozího pásu
		for (let s = 0; s <= kusu; s++) { pridej(s, -1); pridej(s, 1); }
		pridej(kusu, 1);
		if (silna(b)) pasSilnychVrcholu = pas.uzel.length;
		else for (let s = 0; s < kusu; s++) { tenke.poz.push(X[s], Y[s], Z[s], X[s + 1], Y[s + 1], Z[s + 1]); tenke.barva.push(r, g, bl, r, g, bl); tenke.uzel.push(b, b); }
	}
	const stopky = { poz: [] as number[], barva: [] as number[], sila: [] as number[], uzel: [] as number[] }, opar = { poz: [] as number[], roh: [] as number[], vel: [] as number[], barva: [] as number[], sila: [] as number[], uzel: [] as number[] };
	for (let i = 0; i < pocet; i++) {
		if (typ[i] !== 0) continue;
		const listy = potomci[i].filter((d: any) => typ[d] !== 0);
		if (listy.length) {
			const sila = 0.3 * Math.min(1, 5 / Math.sqrt(listy.length));   // stopka slábne s velikostí svazku, jinak 300 stopek splyne v bílý klín
			const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2], ua = i === 0 ? null : smerSveta(i);
			for (const d of listy) {
				const bx = p[d * 3], by = p[d * 3 + 1], bz = p[d * 3 + 2], L = Math.hypot(bx - ax, by - ay);
				const u0 = ua === null ? Math.atan2(by - ay, bx - ax) : ua, ub = smerSveta(d);
				const c1x = ax + Math.cos(u0) * L * 0.38, c1y = ay + Math.sin(u0) * L * 0.38, c2x = bx - Math.cos(ub) * L * 0.3, c2y = by - Math.sin(ub) * L * 0.3;
				const [r, g, bl] = barvaRgb[d].map((v: any) => v / 255);
				let qx = ax, qy = ay, qz = az;
				for (let s = 1; s <= KUSU_STOPKY; s++) {
					const t = s / KUSU_STOPKY, x = bezier(ax, c1x, c2x, bx, t), y = bezier(ay, c1y, c2y, by, t), zz = az + (bz - az) * t;
					stopky.poz.push(qx, qy, qz, x, y, zz); stopky.barva.push(r, g, bl, r, g, bl); stopky.sila.push(sila, sila); stopky.uzel.push(d, d);
					qx = x; qy = y; qz = zz;
				}
			}
		}
		if (i === 0 || !potomci[i].length) continue;
		const [r, g, bl] = barvaRgb[i].map((v: any) => v / 255), sila = Math.min(0.9, 0.3 + Math.log2(vaha[i] + 1) / 11);
		const tx = rozlozeni.tez[i * 3], ty = rozlozeni.tez[i * 3 + 1], tz = rozlozeni.tez[i * 3 + 2], rr = rozlozeni.podR[i];
		const rohy = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
		if (opar.uzel.length) { opar.poz.push(tx, ty, tz); opar.roh.push(-1, -1); opar.vel.push(rr); opar.barva.push(r, g, bl); opar.sila.push(sila); opar.uzel.push(i); }
		for (const [rx, ry] of rohy) { opar.poz.push(tx, ty, tz); opar.roh.push(rx, ry); opar.vel.push(rr); opar.barva.push(r, g, bl); opar.sila.push(sila); opar.uzel.push(i); }
		opar.poz.push(tx, ty, tz); opar.roh.push(1, 1); opar.vel.push(rr); opar.barva.push(r, g, bl); opar.sila.push(sila); opar.uzel.push(i);
	}
	const f32 = (a: any) => new Float32Array(a), i32 = (a: any) => new Int32Array(a);
	return {
		pas: { poz: f32(pas.poz), tecna: f32(pas.tecna), strana: f32(pas.strana), sirka: f32(pas.sirka), barva: f32(pas.barva), uzel: i32(pas.uzel), vrcholu: pas.uzel.length, silnychVrcholu: pasSilnychVrcholu },
		tenke: { poz: f32(tenke.poz), barva: f32(tenke.barva), sila: new Float32Array(tenke.uzel.length).fill(0.45), uzel: i32(tenke.uzel), vrcholu: tenke.uzel.length },
		stopky: { poz: f32(stopky.poz), barva: f32(stopky.barva), sila: f32(stopky.sila), uzel: i32(stopky.uzel), vrcholu: stopky.uzel.length },
		opar: { poz: f32(opar.poz), roh: f32(opar.roh), vel: f32(opar.vel), barva: f32(opar.barva), sila: f32(opar.sila), uzel: i32(opar.uzel), vrcholu: opar.uzel.length }
	};
}

// --- shadery ---
const VS_BODY = `
attribute vec3 aPoz; attribute vec3 aBarva; attribute float aVel; attribute float aStav; attribute float aDruh;
uniform mat4 uMvp; uniform mat4 uMv; uniform float uMeritko; uniform vec2 uMlha; uniform float uMaxBod; uniform float uPevnePx;
varying vec3 vBarva; varying float vAlfa; varying float vJadro; varying float vDruh;
void main() {
	vec4 v = uMv * vec4(aPoz, 1.0);
	float d = max(1.0, -v.z);
	gl_Position = uMvp * vec4(aPoz, 1.0);
	float jadroPx = uPevnePx > 0.0 ? uPevnePx : aVel * uMeritko / d;
	float celek = clamp(jadroPx * 3.0, 2.5, uMaxBod);
	gl_PointSize = celek;
	vJadro = clamp(jadroPx / celek, 0.08, 0.5);
	float m = clamp((d - uMlha.x) / (uMlha.y - uMlha.x), 0.0, 1.0);
	vAlfa = aStav * mix(1.0, 0.3, m);
	vBarva = aBarva; vDruh = aDruh;
}`;
const FS_BODY = `
precision mediump float;
varying vec3 vBarva; varying float vAlfa; varying float vJadro; varying float vDruh;
void main() {
	vec2 q = gl_PointCoord * 2.0 - 1.0;
	float r = length(q);
	if (r > 1.0) discard;
	float jadro = 1.0 - smoothstep(vJadro * 0.6, vJadro, r);
	float zare = exp(-r * r * 3.5) * (1.0 - jadro);
	vec3 svetla = mix(vBarva, vec3(1.0), 0.65);
	float a = jadro * 0.95 + zare * 0.32;
	vec3 c = svetla * jadro * 0.95 + vBarva * zare * 0.32;
	if (vDruh > 1.5 && vDruh < 2.5) { float prs = 1.0 - smoothstep(0.05, 0.1, abs(r - 0.62)); a += prs * 0.9; c += vBarva * prs * 0.9; }
	gl_FragColor = vec4(c * vAlfa, a * vAlfa);
}`;
const VS_CARY = `
attribute vec3 aPoz; attribute vec3 aBarva; attribute float aSila; attribute float aStav;
uniform mat4 uMvp; uniform mat4 uMv; uniform vec2 uMlha; uniform vec2 uBlizko;
varying vec4 vC;
void main() {
	vec4 v = uMv * vec4(aPoz, 1.0);
	float d = max(1.0, -v.z);
	gl_Position = uMvp * vec4(aPoz, 1.0);
	float m = clamp((d - uMlha.x) / (uMlha.y - uMlha.x), 0.0, 1.0);
	float a = aSila * aStav * mix(1.0, 0.35, m) * smoothstep(uBlizko.x, uBlizko.y, d);
	vC = vec4(aBarva * a, a);
}`;
const FS_CARY = `precision mediump float; varying vec4 vC; void main() { gl_FragColor = vC; }`;
// pás kmene: vrchol se odsadí v prostoru kamery kolmo na tečnu i na směr pohledu (pás je vždy natočený ke kameře), šířka ve světových
// jednotkách se převede na px a sevře mezi uMinPx a uMaxPx (tenké vzdálené větve nezmizí, blízké nezaplní obrazovku)
const VS_PASY = `
attribute vec3 aPoz; attribute vec3 aTecna; attribute float aStrana; attribute float aSirka; attribute vec3 aBarva; attribute float aStav;
uniform mat4 uMv; uniform mat4 uProj; uniform float uMeritko; uniform float uNasobek; uniform float uMinPx; uniform float uMaxPx; uniform float uAlfa; uniform vec2 uMlha; uniform vec2 uBlizko;
varying float vStrana; varying vec4 vC;
void main() {
	vec4 v = uMv * vec4(aPoz, 1.0);
	vec3 t = mat3(uMv) * aTecna;
	vec3 n = cross(t, v.xyz);
	float nl = length(n);
	n = nl > 1e-6 ? n / nl : vec3(1.0, 0.0, 0.0);
	float d = max(1.0, -v.z);
	float wPx = clamp(aSirka * uNasobek * uMeritko / d, uMinPx, uMaxPx);
	float w = wPx * d / uMeritko;
	gl_Position = uProj * vec4(v.xyz + n * (aStrana * w * 0.5), 1.0);
	float m = clamp((d - uMlha.x) / (uMlha.y - uMlha.x), 0.0, 1.0);
	float a = uAlfa * aStav * mix(1.0, 0.35, m) * smoothstep(uBlizko.x, uBlizko.y, d);
	vStrana = aStrana; vC = vec4(aBarva, a);
}`;
const FS_PASY = `
precision mediump float;
varying float vStrana; varying vec4 vC;
uniform float uMekky;
void main() {
	float s = abs(vStrana);
	float okraj = uMekky > 0.5 ? (1.0 - s) * (1.0 - s) : 1.0 - smoothstep(0.6, 1.0, s);
	float a = vC.a * okraj;
	gl_FragColor = vec4(vC.rgb * a, a);
}`;
// opar: billboard na těžišti podstromu, poloměr v px jako chomáč ve 2D (podR × 1,15 + 3, 5-70 px), alfa z 2D sémantického zoomu (aAlfa per snímek)
const VS_OPAR = `
attribute vec3 aPoz; attribute vec2 aRoh; attribute float aVel; attribute vec3 aBarva; attribute float aSila; attribute float aAlfa;
uniform mat4 uMv; uniform mat4 uProj; uniform float uMeritko; uniform vec2 uMlha;
varying vec2 vRoh; varying float vA; varying vec3 vBarva;
void main() {
	vec4 v = uMv * vec4(aPoz, 1.0);
	float d = max(1.0, -v.z);
	float rPx = clamp(aVel * uMeritko / d * 1.15 + 3.0, 5.0, 70.0);
	float r = rPx * d / uMeritko;
	gl_Position = uProj * vec4(v.xyz + vec3(aRoh * r, 0.0), 1.0);
	float m = clamp((d - uMlha.x) / (uMlha.y - uMlha.x), 0.0, 1.0);
	vRoh = aRoh; vA = aSila * aAlfa * mix(1.0, 0.45, m); vBarva = aBarva;
}`;
const FS_OPAR = `
precision mediump float;
varying vec2 vRoh; varying float vA; varying vec3 vBarva;
void main() {
	float r2 = dot(vRoh, vRoh);
	if (r2 > 1.0) discard;
	float a = vA * 0.7 * exp(-4.0 * r2) * (1.0 - r2);
	gl_FragColor = vec4(vBarva * a, a);
}`;

function prelozShader(gl: any, typ: any, zdroj: any) {
	const s = gl.createShader(typ);
	gl.shaderSource(s, zdroj); gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + log); }
	return s;
}
// program: shadery se po slinkování odpojí a smažou hned (slinkovaný kód drží program), při chybě se uvolní i rozdělaný program
function sestavProgram(gl: any, vs: any, fs: any, atributy: any, uniformy: any) {
	const p = gl.createProgram();
	let sv: any = null, sf: any = null;
	try {
		sv = prelozShader(gl, gl.VERTEX_SHADER, vs); sf = prelozShader(gl, gl.FRAGMENT_SHADER, fs);
		gl.attachShader(p, sv); gl.attachShader(p, sf);
		atributy.forEach((a: any, i: any) => gl.bindAttribLocation(p, i, a));
		gl.linkProgram(p);
		gl.detachShader(p, sv); gl.detachShader(p, sf); gl.deleteShader(sv); gl.deleteShader(sf); sv = sf = null;
		if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('program: ' + gl.getProgramInfoLog(p));
	} catch (chyba: any) {
		if (sv) gl.deleteShader(sv);
		if (sf) gl.deleteShader(sf);
		gl.deleteProgram(p);
		throw chyba;
	}
	const u: Record<string, any> = {};
	for (const n of uniformy) u[n] = gl.getUniformLocation(p, n);
	return { program: p, atributy, u };
}

function tovarna(j: Jadro3d) {
 const texty = j.texty ?? vychoziTextyMapy();
	const okno = j.popisky3d.ownerDocument.defaultView!;
	const posluchace: { cil: EventTarget; typ: string; fn: (e: any) => void; volby?: AddEventListenerOptions }[] = [];
	function naslouchej(cil: EventTarget, typ: string, fn: (e: any) => void, volby?: AddEventListenerOptions) {
		posluchace.push({ cil, typ, fn, volby });
		j.registruj(cil, typ, fn, volby);
	}
	let zniceno = false, idSnimku = 0, casovacStartu: number | null = null;
	let { pocet, rodic, typ, vaha, jmeno, cesta, hloubka, potomci } = j;
	const platnoGl = j.platno3d, platnoP = j.popisky3d, pctx = platnoP.getContext('2d')!;
	let gl: any = null, progBody: any = null, progCary: any = null, progPasy: any = null, progOpar: any = null, ztracen = false;
	let podporovano = false, duvodNepodpory = '';
	let aktivni = false, rozlozeni: any = null, geometrie: any = null, rozlozeniMs = 0;
	let sirka = 0, vyska = 0, dpr = 1, maxBod = 64;
	let cekajiciKamera: Kamera3d | null = null;
	let kam = [0, 0, 1], cil = [0, 0, 0], nahoru = [0, 1, 0], dZakladni = 1;
	let mv: any, mvp: any, proj: any, meritkoCss = 1;
	let let_: any = null, posledniVstup = 0, kotvaKrouzeni: any = null, casKrouzeni = 0, casovacKlidu: any = null, krouzeniZapnute = true;
	let smyckaBezi = false, posledniCas = 0, spinave = true, posledniKlicVyberu = '', snimku = 0, posledniSnimekMs = 0;
	// LOD: konec JS posledního snímku, čas žádosti o čekající snímek a začátek vstupu (první sloučená událost gesta), který si ho vyžádal
	let lod = 0, lodRucni = false, konecSnimku = 0, casPozadavku = 0, vstupOd = Infinity, zpomaleniMs = 0;
	const intervalyRaf: any[] = [];
	const stisknute = new Set();
	let shift = false;
	// per uzel odvozené pole
	let skryty: any, kotva: any, stav: any, druh: any, barvy: any, alfaPopisku: any, prechod: any, oparAlfa: any;
	let ekrX: any, ekrY: any, ekrD: any, ekrR: any;
	// GL zdroje
	const buf: Record<string, any> = {};
	let pocetZavislostiVrcholu = 0, pocetZvyraznenychVrcholu = 0, pocetBoduVyberu = 0;
	let impulzy: any[] = [], uzlyPopiskuVyberu: any[] = [], zasahyPopisku = new Map(), zasahyPopiskuVyberu = new Map(), pocetZavislosti = { krivky: 0, celkem: 0 }, zvPozPosledni: any = null;
	let barvaRgbNahrana: any = null;   // pole barev 2D, z něhož jsou nahrané barvy geometrie; jiné pole = změna palety, barvy vrcholů se obnoví
	const casySnimku: any[] = [];

	// --- WebGL inicializace ---
	// Levná jednorázová sonda při načtení (kvůli neaktivnímu tlačítku): kontext na dočasném plátně, hned uvolněný. Skutečný kontext,
	// shadery a buffery vznikají až při první volbě 3D, výchozí 2D tak nedrží žádný WebGL zdroj.
	function sondaWebgl() {
		let g: any = null;
		try { const c = platnoP.ownerDocument.createElement('canvas'); c.width = c.height = 1; g = c.getContext('webgl') || c.getContext('experimental-webgl'); } catch { g = null; }
		if (!g) { duvodNepodpory = texty.bezWebgl; return false; }
		const ext = g.getExtension('WEBGL_lose_context');
		if (ext) ext.loseContext();
		return true;
	}
	function ziskejKontext() {
		try {
			gl = platnoGl.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
				|| platnoGl.getContext('experimental-webgl', { alpha: true, antialias: false, depth: false });
		} catch { gl = null; }
		if (!gl) { duvodNepodpory = texty.bezWebgl; return false; }
		napojKontext();   // životní cyklus od získání kontextu, dřív než vznikne první shader nebo buffer
		return true;
	}
	function napojKontext() {
		naslouchej(platnoGl, 'webglcontextlost', (e: any) => {
			e.preventDefault();
			ztracen = true;
			uvolniZdroje();   // objekty zanikly s kontextem, zůstaly by jen neplatné odkazy

			podporovano = false; duvodNepodpory = texty.ztracenWebgl;
			j.vypadek3d(duvodNepodpory);
		});
		naslouchej(platnoGl, 'webglcontextrestored', () => {
			ztracen = false;
			rozlozeni = null; geometrie = null;
			podporovano = true; duvodNepodpory = '';
			j.oznacPodporu3d();
		});
	}
	// uvolnění GL zdrojů před novým sestavením (přepočet rozložení po otočení, obnova kontextu): buffery i programy se mažou explicitně,
	// jinak by každé otočení displeje nechalo na GPU starou sadu až do zániku plátna; po ztrátě kontextu jsou pryč samy, jen se zapomenou
	function uvolniZdroje() {
		if (gl && !ztracen) {
			for (const k of Object.keys(buf)) if (buf[k]) gl.deleteBuffer(buf[k]);
			for (const p of [progBody, progCary, progPasy, progOpar]) if (p) gl.deleteProgram(p.program);
		}
		for (const k of Object.keys(buf)) buf[k] = null;
		progBody = progCary = progPasy = progOpar = null;
	}
	function sestavZdroje() {
		uvolniZdroje();
		try {
			progBody = sestavProgram(gl, VS_BODY, FS_BODY, ['aPoz', 'aBarva', 'aVel', 'aStav', 'aDruh'], ['uMvp', 'uMv', 'uMeritko', 'uMlha', 'uMaxBod', 'uPevnePx']);
			progCary = sestavProgram(gl, VS_CARY, FS_CARY, ['aPoz', 'aBarva', 'aSila', 'aStav'], ['uMvp', 'uMv', 'uMlha', 'uBlizko']);
			progPasy = sestavProgram(gl, VS_PASY, FS_PASY, ['aPoz', 'aTecna', 'aStrana', 'aSirka', 'aBarva', 'aStav'], ['uMv', 'uProj', 'uMeritko', 'uNasobek', 'uMinPx', 'uMaxPx', 'uAlfa', 'uMlha', 'uBlizko', 'uMekky']);
			progOpar = sestavProgram(gl, VS_OPAR, FS_OPAR, ['aPoz', 'aRoh', 'aVel', 'aBarva', 'aSila', 'aAlfa'], ['uMv', 'uProj', 'uMeritko', 'uMlha']);
		} catch (chyba: any) { uvolniZdroje(); throw chyba; }   // selhání jednoho programu nesmí nechat živé ty předchozí (xcheck k3)
		const rozsah = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
		// strop průměru bodu včetně záře: blízké body by jinak zaplnily půl obrazovky a fill rate GPU (ne JS) určoval čas snímku (SwiftShader u vybraného uzlu 0,15-0,5 s/snímek při 220 px)
		maxBod = Math.min(rozsah ? rozsah[1] : 64, 72 * dpr);
		const staticke = {
			poz: rozlozeni.poz, vel: rozlozeni.polomerSveta,
			pasPoz: geometrie.pas.poz, pasTecna: geometrie.pas.tecna, pasStrana: geometrie.pas.strana, pasSirka: geometrie.pas.sirka, pasBarva: geometrie.pas.barva,
			tenkePoz: geometrie.tenke.poz, tenkeBarva: geometrie.tenke.barva, tenkeSila: geometrie.tenke.sila,
			stopPoz: geometrie.stopky.poz, stopBarva: geometrie.stopky.barva, stopSila: geometrie.stopky.sila,
			oparPoz: geometrie.opar.poz, oparRoh: geometrie.opar.roh, oparVel: geometrie.opar.vel, oparBarva: geometrie.opar.barva, oparSila: geometrie.opar.sila
		};
		for (const [k, data] of Object.entries(staticke)) { buf[k] = gl.createBuffer(); nahraj(k, data); }
		for (const k of ['barva', 'stav', 'druh', 'pasStav', 'tenkeStav', 'stopStav', 'oparAlfa', 'zavPoz', 'zavBarva', 'zavSila', 'zavStav', 'zvPoz', 'zvBarva', 'zvSila', 'zvStav', 'vybPoz', 'vybBarva', 'vybVel', 'vybStav', 'vybDruh', 'impPoz', 'impBarva', 'impVel', 'impStav', 'impDruh']) buf[k] = gl.createBuffer();
		// barvy vrcholů podle aktuální palety: geometrie mohla vzniknout dřív (paleta změněná ve 2D během ztráty kontextu, xcheck k3)
		obnovBarvyGeometrie();
		spinave = true;
	}
	// změna palety: body dostanou barvy v prebuduj, kmeny, tenké čáry, stopky a opar je mají na vrcholech - přepíšou se podle uzlu každého
	// vrcholu a nahrají znovu; programy ani rozložení se nemění
	function obnovBarvyGeometrie() {
		const barvaRgb = j.barvaRgb;
		for (const [cast, klic] of [[geometrie.pas, 'pasBarva'], [geometrie.tenke, 'tenkeBarva'], [geometrie.stopky, 'stopBarva'], [geometrie.opar, 'oparBarva']]) {
			const { barva, uzel } = cast;
			for (let v = 0; v < uzel.length; v++) { const c = barvaRgb[uzel[v]]; barva[v * 3] = c[0] / 255; barva[v * 3 + 1] = c[1] / 255; barva[v * 3 + 2] = c[2] / 255; }
			nahraj(klic, barva);
		}
		barvaRgbNahrana = barvaRgb;
	}
	function nahraj(klic: any, data: any, dynamicky = false) { gl.bindBuffer(gl.ARRAY_BUFFER, buf[klic]); gl.bufferData(gl.ARRAY_BUFFER, data, dynamicky ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
	}
	function pripojAtribut(prog: any, jmenoAtributu: any, klic: any, slozek: any) {
		const idx = prog.atributy.indexOf(jmenoAtributu);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf[klic]); gl.enableVertexAttribArray(idx); gl.vertexAttribPointer(idx, slozek, gl.FLOAT, false, 0, 0);
	}
	// rozložení a geometrie z aktuálního 2D (orientace a natažení podle displeje); po změně orientace se přepočítá a kamera vrátí na úvodní záběr
	function prepocitejRozlozeni() {
		const z = okno.performance.now();
		rozlozeni = rozlozZ2d(j);
		geometrie = sestavGeometrii(j, rozlozeni);
		rozlozeniMs = okno.performance.now() - z;
		alfaPopisku = new Float32Array(pocet); prechod = new Float32Array(pocet); oparAlfa = new Float32Array(geometrie.opar.vrcholu);
		if (gl && !ztracen) sestavZdroje();
	}
	function zmenVelikost() {
		dpr = Math.min(okno.devicePixelRatio || 1, j.jeTelefon() ? MAX_DPR_TELEFON : MAX_DPR);
		[sirka, vyska] = j.rozmery();
		if (!sirka || !vyska || j.jePozastaveno()) { pozastav(); return; }
		for (const c of [platnoGl, platnoP]) { c.width = Math.round(sirka * dpr); c.height = Math.round(vyska * dpr); }
		meritkoCss = vyska / (2 * Math.tan(ZORNY_UHEL / 2));
		if (rozlozeni) {
			if (rozlozeni.otoceno !== j.otoceno || rozlozeni.natazeni !== j.natazeni) {
				// selhání sestavení po otočení musí přepnout do 2D jako při zapnutí a obnově, jinak by 3D zamrzlo nad prázdnými programy (xcheck k4)
				try { prepocitejRozlozeni(); } catch (chyba: any) { podporovano = false; duvodNepodpory = texty.selhalWebgl + chyba.message; j.vypadek3d(duvodNepodpory); return; }
				const zaber = vychoziZaber(); kam = zaber.kam; cil = zaber.cil; nahoru = [0, 1, 0]; let_ = null; kotvaKrouzeni = null;
			}
			const zaber = vychoziZaber();
			dZakladni = zaber.d;
			// Celek letí k výchozímu záběru: po změně velikosti míří na nový a konec sedí přesně na něj (xcheck k10b A).
			// Bezpečná vzdálenost jen přibere kouli kolem nového cíle. Rozdíl mezi zobrazeným stavem a novou interpolací
			// v čase posledního snímku (navaz) plynule zmizí do konce letu, takže cíl ani vzdálenost neskočí v žádné fázi letu.
			// Pozdní resize dostane aspoň DOJEZD_CELKU_PO_RESIZE_MS: časová osa letu se od posledního snímku natáhne, t zůstane spojité.
			// Pevný termín (xcheck k10c A): resize se shodným cílovým záběrem let nemění vůbec; změna cíle smí konec posunout,
			// ale nikdy za konecPuvodni + DOJEZD_CELKU_PO_RESIZE_MS, ať přijde resize-ů kolik chce.
			if (let_ && let_.orientace && !(shodnyBod(zaber.kam, let_.doKam) && shodnyBod(zaber.cil, let_.doCile))) {
				const l = let_, t0 = l.t || 0;
				const casSnimku = l.start + t0 * l.trvani, konec = l.start + l.trvani;
				const novyKonec = Math.min(casSnimku + DOJEZD_CELKU_PO_RESIZE_MS, l.konecPuvodni + DOJEZD_CELKU_PO_RESIZE_MS);
				if (novyKonec > konec) { l.trvani = (novyKonec - casSnimku) / (1 - t0); l.start = casSnimku - t0 * l.trvani; }
				Object.assign(l, { doKam: zaber.kam, doCile: zaber.cil, doD: zaber.d });
				if (l.orientace.uhel >= 1e-3) for (let i = 0; i < pocet; i++) l.bezpecnaD = Math.max(l.bezpecnaD, delka(sub(poziceUzlu(i), zaber.cil)) * 1.08);
				const s = cilAVzdalenostCelku(l, t0);
				l.navaz = { t0, cil: sub(cil, s.cil), d: vzdalenost() - s.d };
			}
		}
		pozadujSnimek();
	}

	// --- odvozená data podle stavu 2D (sbalení, výběr, paleta, závislosti) ---
	function prebuduj() {
		const sbalene = j.sbalene, vybrany = j.vybrany, barvaRgb = j.barvaRgb;
		if (barvaRgb !== barvaRgbNahrana) obnovBarvyGeometrie();
		skryty = new Uint8Array(pocet); kotva = new Int32Array(pocet); stav = new Float32Array(pocet); druh = new Float32Array(pocet); barvy = new Float32Array(pocet * 3);
		for (let i = 0; i < pocet; i++) {
			const r = rodic[i];
			skryty[i] = i > 0 && (skryty[r] || (r !== 0 && sbalene.has(cesta[r]))) ? 1 : 0;
			kotva[i] = skryty[i] ? kotva[r] : i;
			druh[i] = i === 0 ? 3 : typ[i] === 0 ? (sbalene.has(cesta[i]) && potomci[i].length ? 2 : 1) : 0;
			barvy[i * 3] = barvaRgb[i][0] / 255; barvy[i * 3 + 1] = barvaRgb[i][1] / 255; barvy[i * 3 + 2] = barvaRgb[i][2] / 255;
		}
		// zvýraznění výběru: vybraný, cesta ke kořeni (slábne), přímí potomci a cíle vazeb; ostatní ztlumené. Kmeny a stopky hierarchie
		// se zvýrazní svým stavem (pás zůstane prohnutý), paprsky vazeb jsou samostatné čáry
		const zvyraz = new Float32Array(pocet);
		uzlyPopiskuVyberu = []; impulzy = [];
		const zvPoz: any[] = [], zvBarva: any[] = [], zvSila: any[] = [];
		const pridejCaru = (a: any, b: any, rgb: any, sila: any) => { zvPoz.push(rozlozeni.poz[a * 3], rozlozeni.poz[a * 3 + 1], rozlozeni.poz[a * 3 + 2], rozlozeni.poz[b * 3], rozlozeni.poz[b * 3 + 1], rozlozeni.poz[b * 3 + 2]); zvBarva.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); zvSila.push(sila, sila); };
		if (vybrany >= 0) {
			const stred = kotva[vybrany];
			zvyraz[stred] = 1;
			uzlyPopiskuVyberu.push(stred);
			let alfa = 1;
			for (let d = stred, a = rodic[d]; a >= 0; d = a, a = rodic[a], alfa *= 0.65) {
				zvyraz[a] = Math.max(zvyraz[a], alfa);
				if (uzlyPopiskuVyberu.length === 1) uzlyPopiskuVyberu.push(a);
			}
			if (stred === vybrany) {
				const deti = potomci[vybrany].filter((d: any) => !skryty[d]).sort((p: any, q: any) => vaha[q] - vaha[p]);
				const tlum = Math.min(1, 6 / Math.sqrt(deti.length || 1));
				for (const d of deti) zvyraz[d] = Math.max(zvyraz[d], Math.max(0.5, tlum));
				uzlyPopiskuVyberu.push(...deti);
			}
			const paleta = j.paleta, vazby = j.vazbyUzlu(vybrany);
			for (const s of [{ mapa: vazby.ven, hex: paleta.ven, odStredu: true }, { mapa: vazby.dovnitr, hex: paleta.dovnitr, odStredu: false }]) {
				const skupiny = new Map();
				for (const [uzel, n] of s.mapa) { const k = kotva[uzel]; skupiny.set(k, (skupiny.get(k) || 0) + n); }
				const serazene = [...skupiny.entries()].sort((p: any, q: any) => q[1] - p[1]).slice(0, MAX_SKUPIN_VAZEB);
				const maxN = serazene.length ? serazene[0][1] : 1, rgb = j.hexNaRgb(s.hex);
				// stovky paprsků z jednoho bodu by se sečetly v bílou plochu: od ~100 skupin síla klesá s odmocninou počtu
				const tlumPoctu = Math.min(1, 10 / Math.sqrt(serazene.length || 1));
				serazene.forEach(([k, n]: any, poradi: any) => {
					if (k === stred) return;
					const sila = Math.log2(n + 1) / Math.log2(maxN + 1);
					zvyraz[k] = Math.max(zvyraz[k], 0.9);
					pridejCaru(stred, k, rgb, (0.18 + 0.42 * sila) * tlumPoctu);
					if (poradi < MAX_IMPULZU_SMER) impulzy.push({ a: stred, b: k, odStredu: s.odStredu, pocet: 1 + Math.min(2, Math.round(sila * 2)), rgb, faze: j.odchylka(String(k), 'faze') });
				});
			}
		}
		for (let i = 0; i < pocet; i++) stav[i] = skryty[i] ? 0 : vybrany < 0 ? 1 : (zvyraz[i] || 0.12);
		// stav na vrcholy pásů, tenkých čar a stopek podle uzlu potomka (skrytá nebo ztlumená větev zhasne i s kmenem)
		const stavVrcholu = (uzly: any) => { const s = new Float32Array(uzly.length); for (let v = 0; v < uzly.length; v++) s[v] = stav[uzly[v]]; return s; };
		nahraj('barva', barvy); nahraj('stav', stav); nahraj('druh', druh);
		nahraj('pasStav', stavVrcholu(geometrie.pas.uzel)); nahraj('tenkeStav', stavVrcholu(geometrie.tenke.uzel)); nahraj('stopStav', stavVrcholu(geometrie.stopky.uzel));
		pocetZvyraznenychVrcholu = zvSila.length; zvPozPosledni = zvPoz;
		if (pocetZvyraznenychVrcholu) { nahraj('zvPoz', new Float32Array(zvPoz)); nahraj('zvBarva', new Float32Array(zvBarva)); nahraj('zvSila', new Float32Array(zvSila)); nahraj('zvStav', new Float32Array(zvSila.length).fill(1)); }
		// vybraný bod se zářivějším dvorcem
		pocetBoduVyberu = 0;
		if (vybrany >= 0) {
			const s = kotva[vybrany], rgb = barvaRgb[s];
			nahraj('vybPoz', new Float32Array([rozlozeni.poz[s * 3], rozlozeni.poz[s * 3 + 1], rozlozeni.poz[s * 3 + 2], rozlozeni.poz[s * 3], rozlozeni.poz[s * 3 + 1], rozlozeni.poz[s * 3 + 2]]));
			nahraj('vybBarva', new Float32Array([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1, 1, 1]));
			nahraj('vybVel', new Float32Array([rozlozeni.polomerSveta[s] * 1.6, rozlozeni.polomerSveta[s] * 2.4]));
			nahraj('vybStav', new Float32Array([1, 0.45])); nahraj('vybDruh', new Float32Array([0, 0]));
			pocetBoduVyberu = 2;
		}
		prebudujZavislosti();
		spinave = false;
	}
	// závislosti mezi kotvami (sbalená větev se počítá do své složky), stejný strop a přepínač jako ve 2D
	function prebudujZavislosti() {
		pocetZavislostiVrcholu = 0;
		pocetZavislosti = { krivky: 0, celkem: 0 };
		if (!j.zavislostiZapnute) return;
		const mapa = new Map();
		for (const [a, b] of j.vazby) {
			const va = kotva[a], vb = kotva[b];
			if (va === vb) continue;
			const klic = va < vb ? va * pocet + vb : vb * pocet + va;
			mapa.set(klic, (mapa.get(klic) || 0) + 1);
		}
		const vse = [...mapa.entries()].sort((p: any, q: any) => q[1] - p[1]), krivky = vse.slice(0, j.MAX_KRIVEK), maxPocet = vse.length ? vse[0][1] : 1;
		pocetZavislosti = { krivky: krivky.length, celkem: vse.length };
		const rgb = j.hexNaRgb(j.paleta.vazba), tlum = j.vybrany >= 0 ? 0.15 : 1;
		const poz = new Float32Array(krivky.length * 6), barva = new Float32Array(krivky.length * 6), sila = new Float32Array(krivky.length * 2), st = new Float32Array(krivky.length * 2).fill(tlum);
		krivky.forEach(([klic, n]: any, q: any) => {
			const a = Math.floor(klic / pocet), b = klic % pocet, o = q * 6, s = Math.log2(n + 1) / Math.log2(maxPocet + 1);
			poz[o] = rozlozeni.poz[a * 3]; poz[o + 1] = rozlozeni.poz[a * 3 + 1]; poz[o + 2] = rozlozeni.poz[a * 3 + 2];
			poz[o + 3] = rozlozeni.poz[b * 3]; poz[o + 4] = rozlozeni.poz[b * 3 + 1]; poz[o + 5] = rozlozeni.poz[b * 3 + 2];
			for (let k = 0; k < 2; k++) { barva[o + k * 3] = rgb[0] / 255; barva[o + k * 3 + 1] = rgb[1] / 255; barva[o + k * 3 + 2] = rgb[2] / 255; }
			sila[q * 2] = sila[q * 2 + 1] = 0.05 + 0.3 * s;
		});
		pocetZavislostiVrcholu = krivky.length * 2;
		if (pocetZavislostiVrcholu) { nahraj('zavPoz', poz); nahraj('zavBarva', barva); nahraj('zavSila', sila); nahraj('zavStav', st); }
		if (aktivni) j.infoZavislosti(vse.length > krivky.length ? texty.krivkySkryte(krivky.length, vse.length, vse.length - krivky.length) : texty.krivek(vse.length));
	}

	// --- kamera ---
	function stavKamery(): Kamera3d | null {
		return cekajiciKamera ? platnaKamera3d(cekajiciKamera) : rozlozeni ? { kam: kam.slice(), cil: cil.slice(), nahoru: nahoru.slice() } : null;
	}
	function obnovKameru(stav: unknown) {
		cekajiciKamera = platnaKamera3d(stav);
		if (!rozlozeni) return;
		const z = vychoziZaber(), ulozena = cekajiciKamera;
		const rozumna = ulozena && [...ulozena.kam, ...ulozena.cil].every(n => Math.abs(n) <= Math.max(1, rozlozeni.R) * 100);
		kam = rozumna ? ulozena.kam.slice() : z.kam;
		cil = rozumna ? ulozena.cil.slice() : z.cil;
		nahoru = rozumna ? ulozena.nahoru.slice() : [0, 1, 0];
		cekajiciKamera = null; let_ = null; kotvaKrouzeni = null;
		vstup(); pozadujSnimek();
	}
	function vzdalenost() { return delka(sub(kam, cil)); }
	function omezVzdalenost(d: any) { return sevri(d, Math.max(2, rozlozeni.R * 0.01), rozlozeni.R * 8); }
	// úvodní záběr: zepředu (osa z, bez elevace), takže se mapa promítá jako 2D neuron; kamera v nejmenší vzdálenosti, při níž obal
	// všech bodů zabere PODIL_ZABERU užší strany, cíl ve středu obalu (na šířku i na výšku stejně, orientaci už nese 2D rozložení)
	function vychoziZaber() {
		const smer = [0, 0, 1];
		const z = zaberNaVsechnyBody(smer, [0, 1, 0], PODIL_ZABERU);
		return { kam: add(z.cil, nasob(smer, z.d)), cil: z.cil, d: z.d };
	}
	// cíl ve středu obalu bodů kolmo na směr pohledu a nejmenší vzdálenost kamery od něj, při níž všechny body leží uvnitř podílu zorného pole
	function zaberNaVsechnyBody(smer: any, nahoruV: any, podil: any) {
		const f = nasob(jednotkovy(smer), -1), bok = jednotkovy(kriz(f, nahoruV)), n = kriz(bok, f);
		const ty = Math.tan(ZORNY_UHEL / 2) * podil, tx = ty * sirka / Math.max(1, vyska), p = rozlozeni.poz;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (let i = 0; i < pocet; i++) {
			const q = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]], x = skalar(q, bok), y = skalar(q, n);
			x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
		}
		let cil = add(nasob(bok, (x0 + x1) / 2), nasob(n, (y0 + y1) / 2)), d = 1;
		// perspektiva posouvá střed promítnutého obalu proti středu světového: pár iterací posune cíl podle promítnuté nesouměrnosti
		for (let krok = 0; krok < 4; krok++) {
			d = 1;
			for (let i = 0; i < pocet; i++) {
				const rel = [p[i * 3] - cil[0], p[i * 3 + 1] - cil[1], p[i * 3 + 2] - cil[2]];
				const z = -skalar(rel, f), x = Math.abs(skalar(rel, bok)), y = Math.abs(skalar(rel, n));
				d = Math.max(d, z + x / tx, z + y / ty);
			}
			let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
			for (let i = 0; i < pocet; i++) {
				const rel = [p[i * 3] - cil[0], p[i * 3 + 1] - cil[1], p[i * 3 + 2] - cil[2]], h = Math.max(1, d + skalar(rel, f));
				const u = skalar(rel, bok) / h, v = skalar(rel, n) / h;
				u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
			}
			cil = add(cil, add(nasob(bok, (u0 + u1) / 2 * d), nasob(n, (v0 + v1) / 2 * d)));
		}
		return { cil, d: omezVzdalenost(d) };
	}
	// trackball: posun ukazatele po plátně (v CSS px) otočí oko i vektor nahoru kolem osy kolmé na směr pohybu
	function otoc(dx: any, dy: any) {
		const nx = dx / (sirka * 0.5), ny = -dy / (sirka * 0.5), uhel = Math.hypot(nx, ny) * RYCHLOST_ROTACE;
		if (uhel < 1e-9) return;
		const oko = sub(kam, cil), smerOka = jednotkovy(oko), n = jednotkovy(nahoru), bok = jednotkovy(kriz(n, smerOka));
		const pohyb = add(nasob(n, ny), nasob(bok, nx));
		const osa = jednotkovy(kriz(pohyb, oko));
		if (!Number.isFinite(osa[0]) || delka(osa) < 0.5) return;
		kam = add(cil, otocKolem(oko, osa, uhel));
		nahoru = jednotkovy(otocKolem(nahoru, osa, uhel));
	}
	function posun(dx: any, dy: any, rychlost: any = RYCHLOST_POSUNU.mys) {
		const oko = sub(kam, cil), d = delka(oko);
		const zmX = dx / sirka * d * rychlost, zmY = dy / vyska * d * rychlost;
		const bok = jednotkovy(kriz(oko, nahoru)), n = jednotkovy(nahoru);
		const krok = add(nasob(bok, zmX), nasob(n, zmY));
		kam = add(kam, krok); cil = add(cil, krok);
	}
	function zoom(faktor: any) {
		if (!(faktor > 0) || faktor === 1) return;
		const oko = sub(kam, cil), d = omezVzdalenost(delka(oko) * faktor);
		kam = add(cil, nasob(jednotkovy(oko), d));
	}
	function vstup() {
		posledniVstup = okno.performance.now();
		kotvaKrouzeni = null;
		let_ = null;   // přerušený přelet nechá kameru tam, kde je
		j.aktualizujCelek?.();   // až po zrušení přeletu: během přeletu popisek Celek/Detail stojí (B5 k4)
		naplanujKlid();
	}
	function naplanujKlid() {
		if (casovacKlidu) okno.clearTimeout(casovacKlidu);
		casovacKlidu = null;
		if (zniceno || !aktivni || j.jePozastaveno() || !krouzeniZapnute) return;
		const za = Math.max(0, KROUZENI.prodlevaMs - (okno.performance.now() - posledniVstup)) + 20;
		casovacKlidu = okno.setTimeout(() => { casovacKlidu = null; pozadujSnimek(); }, za);
	}
	function sfericke(v: any) { const r = delka(v) || 1; return { r, theta: Math.atan2(v[0], v[2]), phi: Math.acos(sevri(v[1] / r, -1, 1)) }; }
	const zeSferickych = (s: any) => [s.r * Math.sin(s.phi) * Math.sin(s.theta), s.r * Math.cos(s.phi), s.r * Math.sin(s.phi) * Math.cos(s.theta)];
	function zacniPrelet(doKam: any, doCile: any, trvani: any, poTe: any) {
		let_ = { start: okno.performance.now(), trvani, odKam: kam.slice(), doKam, odCile: cil.slice(), doCile, poTe };
		kotvaKrouzeni = null;
		pozadujSnimek();
	}
	function krokPreletu(cas: any) {
		const t = Math.min(1, (cas - let_.start) / let_.trvani), k = hladceKubicky(t);
		if (let_.orientace) {
			// Jeden kubický náběh udrží i otočení o 180° pod 8° za snímek 16,7 ms.
			const l = let_, otoceni = hladce(sevri((t - 0.2) / 0.6, 0, 1));
			const uhel = l.orientace.uhel * (1 - otoceni), osa = l.orientace.osa;
			const smer = otocKolem([0, 0, 1], osa, uhel);
			// Klidové kroužení může mít nahoru mírně nekolmé k oku. Jeho odchylka mizí plynule, bez skoku na začátku.
			const lokalniNahoru = jednotkovy(add(nasob(l.lokalniNahoru, 1 - otoceni), [0, otoceni, 0]));
			nahoru = otocKolem(lokalniNahoru, osa, uhel);
			const s = cilAVzdalenostCelku(l, t), n = l.navaz, zbyva = n ? 1 - hladce((t - n.t0) / Math.max(1e-6, 1 - n.t0)) : 0;
			cil = zbyva ? add(s.cil, nasob(n.cil, zbyva)) : s.cil;
			kam = add(cil, nasob(smer, zbyva ? s.d + n.d * zbyva : s.d));
			l.t = t;
			if (t >= 1) { const z = vychoziZaber(); kam = z.kam; cil = z.cil; nahoru = [0, 1, 0]; kotvaKrouzeni = null; }
		} else {
			kam = add(let_.odKam, nasob(sub(let_.doKam, let_.odKam), k));
			cil = add(let_.odCile, nasob(sub(let_.doCile, let_.odCile), k));
		}
		if (t >= 1) { const hotovo = let_.poTe; let_ = null; posledniVstup = cas; if (hotovo) hotovo(); j.aktualizujCelek?.(); }
	}
	// shodný bod záběru v toleranci 1e-6 (resize, který cílový záběr nezmění)
	function shodnyBod(a: any, b: any) { return a.every((v: any, i: any) => Math.abs(v - b[i]) <= 1e-6); }
	// cíl a vzdálenost letu Celku v čase t podle parametrů letu (bez navázání po resize)
	function cilAVzdalenostCelku(l: any, t: any) {
		const otoceni = hladce(sevri((t - 0.2) / 0.6, 0, 1));
		const d = t < 0.2 ? l.odD + (l.bezpecnaD - l.odD) * hladceKubicky(t / 0.2)
			: t > 0.8 ? l.bezpecnaD + (l.doD - l.bezpecnaD) * hladceKubicky((t - 0.8) / 0.2) : l.bezpecnaD;
		return { cil: add(l.odCile, nasob(sub(l.doCile, l.odCile), otoceni)), d };
	}
	function poziceUzlu(i: any) { return [rozlozeni.poz[i * 3], rozlozeni.poz[i * 3 + 1], rozlozeni.poz[i * 3 + 2]]; }
	// viditelný zástupce uzlu podle aktuálního sbalení (nejvyšší sbalený předek), čtený přímo ze stavu 2D: pole kotva z prebuduj
	// může být po rozbalení předků hledáním ještě staré a přelet by mířil na sbalenou složku místo na hledaný bod
	function viditelnaKotva(i: any) {
		let k = i;
		for (let a = rodic[i]; a > 0; a = rodic[a]) if (j.sbalene.has(cesta[a])) k = a;
		return k;
	}
	// poloměr viditelného podstromu uzlu k (největší vzdálenost viditelného potomka; sbalená složka se počítá jako bod, dovnitř se nejde)
	function polomerPodstromu(k: any) {
		const p = poziceUzlu(k), zasobnik = [k];
		let r = 0;
		while (zasobnik.length) {
			const n = zasobnik.pop();
			for (const d of potomci[n]) {
				r = Math.max(r, delka(sub(poziceUzlu(d), p)));
				if (typ[d] === 0 && !j.sbalene.has(cesta[d])) zasobnik.push(d);
			}
		}
		return r;
	}
	// vzdálenost dosednutí: poloměr záběru z podstromu a rodiče (viz PRELET), vzdálenost tak, aby se vešel do užšího rozměru zorného pole
	function vzdalenostDosednuti(k: any) {
		const R = rozlozeni.R, dRodice = rodic[k] >= 0 ? delka(sub(poziceUzlu(rodic[k]), poziceUzlu(k))) : 0;
		const r = sevri(Math.max(polomerPodstromu(k) * PRELET.podilPodstromu, dRodice * PRELET.podilRodice), R * PRELET.minPolomer, R * PRELET.maxPolomer);
		const uhel = Math.min(ZORNY_UHEL, 2 * Math.atan(Math.tan(ZORNY_UHEL / 2) * sirka / Math.max(1, vyska)));
		return omezVzdalenost(r / Math.sin(uhel / 2) * PRELET.rezerva);
	}
	// přelet k bodu: cíl je viditelný zástupce uzlu, směr pohledu zůstane, natočí se o 15° v azimutu; po doletu hned kroužení
	function preletKUzlu(i: any) {
		const k = viditelnaKotva(i), p = poziceUzlu(k);
		const d = vzdalenostDosednuti(k);
		let smer = sub(kam, p);
		if (delka(smer) < 1e-3) smer = [0, 0, 1];
		const s = sfericke(smer);
		s.theta += PRELET.azimutRad; s.r = d;
		const doKam = add(p, zeSferickych(s)), cesta_ = delka(sub(doKam, kam));
		const trvani = sevri(PRELET.minMs + PRELET.msNaJednotku * cesta_, PRELET.minMs, PRELET.maxMs);
		zacniPrelet(doKam, p, trvani, () => { kotvaKrouzeni = null; posledniVstup = okno.performance.now() - KROUZENI.prodlevaMs - 1; naplanujKlid(); pozadujSnimek(); });
	}
	function celek() {
		if (!rozlozeni) return;
		const z = vychoziZaber(), orientace = orientaceKamery(sub(kam, cil), nahoru);
		let bezpecnaD = Math.max(vzdalenost(), z.d);
		// Při změně orientace zůstane oko vně koule obalující mapu pro oba konce pohybujícího se cíle.
		if (orientace.uhel >= 1e-3) for (let i = 0; i < pocet; i++) bezpecnaD = Math.max(bezpecnaD, delka(sub(poziceUzlu(i), cil)) * 1.08, delka(sub(poziceUzlu(i), z.cil)) * 1.08);
		zacniPrelet(z.kam, z.cil, DOBA_PRELETU_CELEK, () => naplanujKlid());
		Object.assign(let_, { orientace, odD: vzdalenost(), doD: z.d, bezpecnaD, konecPuvodni: let_.start + DOBA_PRELETU_CELEK,
			lokalniNahoru: otocKolem(nahoru, orientace.osa, -orientace.uhel) });
	}
	function letNa(i: any) { if (!rozlozeni) return; preletKUzlu(i); }
	// Detail (přelet na kotvu výběru) viditelně změní záběr (B5 k5, r2 nález 2): vzdálenost dosednutí jiná o víc než 1 % (tolerance
	// jeCelek), nebo kotva od středu dál než 1 % menšího rozměru plochy (cíl kamery se promítá do středu); natočení o azimut se nepočítá
	function detailZmeniZaber(i: any) {
		if (!rozlozeni) return false;
		const k = viditelnaKotva(i), d = vzdalenost();
		if (Math.abs(vzdalenostDosednuti(k) - d) > d * 0.01) return true;
		const p = promitni(k);
		return !p || Math.hypot(p.x - sirka / 2, p.y - vyska / 2) > Math.min(sirka, vyska) * 0.01;
	}
	// klidové kroužení: po prodlevě pomalá orbita kolem cíle s náběhem, kýváním elevace a dýcháním vzdálenosti
	function krokKrouzeni(cas: any, dt: any) {
		const klid = cas - posledniVstup;
		if (!krouzeniZapnute || klid <= KROUZENI.prodlevaMs) return false;
		const nabeh = Math.min(1, (klid - KROUZENI.prodlevaMs) / KROUZENI.nabehMs);
		if (!kotvaKrouzeni) { kotvaKrouzeni = sfericke(sub(kam, cil)); casKrouzeni = 0; }
		casKrouzeni += dt * nabeh;
		const t = casKrouzeni, a = kotvaKrouzeni;
		const elev = KROUZENI.elevaceDeg * Math.PI / 180 * Math.sin(2 * Math.PI * t / KROUZENI.periodaElevaceS);
		const dych = 1 + KROUZENI.dychani * Math.sin(2 * Math.PI * t / KROUZENI.periodaDychaniS);
		kam = add(cil, zeSferickych({ r: a.r * dych, theta: a.theta + KROUZENI.uhlovaRychlost * t, phi: sevri(a.phi + elev, 0.05, Math.PI - 0.05) }));
		return true;
	}
	function krokLetuKlavesami(dt: any) {
		if (!stisknute.size) return false;
		const d = vzdalenost(), rychlost = sevri(d * 0.8, 10, 600) * (shift ? 3 : 1);
		const vpred = jednotkovy(sub(cil, kam)), vpravo = jednotkovy(kriz(vpred, nahoru));
		let krok = [0, 0, 0];
		if (stisknute.has('w')) krok = add(krok, vpred);
		if (stisknute.has('s')) krok = sub(krok, vpred);
		if (stisknute.has('d')) krok = add(krok, vpravo);
		if (stisknute.has('a')) krok = sub(krok, vpravo);
		if (stisknute.has('e')) krok[1] += 1;
		if (stisknute.has('q')) krok[1] -= 1;
		if (delka(krok) < 1e-6) return false;
		krok = nasob(jednotkovy(krok), rychlost * dt);
		kam = add(kam, krok); cil = add(cil, krok);
		posledniVstup = okno.performance.now();
		return true;
	}

	// --- promítání, popisky, zásah ---
	function spocitejMatice() {
		mv = pohledovaMatice(kam, cil, nahoru);
		const d = vzdalenost(), R = rozlozeni.R;
		proj = perspektivniMatice(ZORNY_UHEL, sirka / Math.max(1, vyska), Math.max(0.5, (d - R * 1.5) * 0.5), d + R * 4);
		mvp = nasobMatice(proj, mv);
	}
	function promitniBod(x: any, y: any, z: any) {
		const m = mvp, w = m[3] * x + m[7] * y + m[11] * z + m[15];
		if (w <= 0.5) return null;
		return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * sirka, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * vyska, w];
	}
	function promitniVse() {
		if (!ekrX || ekrX.length !== pocet) { ekrX = new Float32Array(pocet); ekrY = new Float32Array(pocet); ekrD = new Float32Array(pocet); ekrR = new Float32Array(pocet); }
		const p = rozlozeni.poz;
		for (let i = 0; i < pocet; i++) {
			const q = promitniBod(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
			if (!q) { ekrD[i] = -1; continue; }
			ekrX[i] = q[0]; ekrY[i] = q[1]; ekrD[i] = q[2];
			ekrR[i] = rozlozeni.polomerSveta[i] * meritkoCss / q[2];
		}
	}
	function promitni(i: any) { spocitejMatice(); promitniVse(); return ekrD[i] > 0 ? { x: ekrX[i], y: ekrY[i], d: ekrD[i], r: ekrR[i] } : null; }
	function jasMlhy(d: any) { const [m0, m1] = mlha(); return 1 - 0.65 * sevri((d - m0) / (m1 - m0), 0, 1); }
	function mlha() { const d = vzdalenost(), R = rozlozeni.R; return [Math.max(1, d - R * 0.4), d + R * 1.1]; }
	// přiblížení proti úvodnímu záběru (obdoba pohled.k / kFit ve 2D): rozpočet popisků s ním roste, do PREHLED_DO platí přehledová pravidla
	function priblizeni() { return Math.max(1, dZakladni / Math.max(1e-6, vzdalenost())); }
	function rozpocetPopisku() { return Math.min(j.MAX_POPISKU, Math.round(j.rozpocetPopiskuZaklad(sirka, vyska) * Math.pow(priblizeni(), j.RUST_POPISKU_SE_ZOOMEM))); }
	// Sémantický zoom 2D převedený na 3D: px na světovou jednotku u uzlu = meritkoCss / vzdálenost; prechod složky podle rozestupu jejích
	// dětí na obrazovce, alfa uzlu = součin prechodů předků. Řídí kandidáty popisků (jako alfa v projdiPodstrom) a alfu oparu (1 − prechod).
	function spocitejAlfy() {
		const PRAH = j.PRAH_ROZESTUPU, rozestup = j.rozestup;
		alfaPopisku[0] = 1;
		prechod[0] = ekrD[0] > 0 ? hladce((rozestup[0] * meritkoCss / ekrD[0] - PRAH * 0.55) / (PRAH * 0.9)) : 1;
		for (let i = 1; i < pocet; i++) {
			const p = rodic[i];
			alfaPopisku[i] = stav[i] <= 0 ? 0 : alfaPopisku[p] * prechod[p];
			if (typ[i] === 0) prechod[i] = ekrD[i] > 0 ? hladce((rozestup[i] * meritkoCss / ekrD[i] - PRAH * 0.55) / (PRAH * 0.9)) : 1;
		}
		const uzly = geometrie.opar.uzel;
		for (let v = 0; v < uzly.length; v++) { const i = uzly[v]; oparAlfa[v] = stav[i] * alfaPopisku[i] * (druh[i] === 2 ? 0.35 : 1 - prechod[i]); }
	}
	function kresliPopisky() {
		const c = pctx;
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		c.clearRect(0, 0, sirka, vyska);
		c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = 'rgba(4,6,16,0.85)';
		const bunka = 64, obsazene = new Map();
		const volno = (x0: any, y0: any, x1: any, y1: any) => {
			if (x0 < 0 || y0 < 0 || x1 > sirka || y1 > vyska) return false;
			const bx0 = Math.floor(x0 / bunka), bx1 = Math.floor(x1 / bunka), by0 = Math.floor(y0 / bunka), by1 = Math.floor(y1 / bunka);
			for (let gx = bx0; gx <= bx1; gx++) for (let gy = by0; gy <= by1; gy++) {
				const seznam = obsazene.get(gx * 100003 + gy);
				if (seznam) for (const o of seznam) if (x0 < o[2] && x1 > o[0] && y0 < o[3] && y1 > o[1]) return false;
			}
			const obdelnik = [x0, y0, x1, y1];
			for (let gx = bx0; gx <= bx1; gx++) for (let gy = by0; gy <= by1; gy++) { const k = gx * 100003 + gy; if (!obsazene.has(k)) obsazene.set(k, []); obsazene.get(k).push(obdelnik); }
			return true;
		};
		const vybrany = j.vybrany;
		zasahyPopisku = new Map(); zasahyPopiskuVyberu = new Map();
		// popisky výběru první (vybraný, rodič, děti), kotoučky zvýrazněných bodů jsou obsazené
		if (vybrany >= 0) {
			const strop = sirka < 500 ? POPISKU_VYBERU.telefon : POPISKU_VYBERU.desktop;
			for (const i of uzlyPopiskuVyberu) if (ekrD[i] > 0) volno(ekrX[i] - ekrR[i] - 2, ekrY[i] - ekrR[i] - 2, ekrX[i] + ekrR[i] + 2, ekrY[i] + ekrR[i] + 2);
			let nakresleno = 0;
			for (const i of uzlyPopiskuVyberu) {
				if (nakresleno >= strop) break;
				if (ekrD[i] <= 0) continue;
				const misto = umisti(c, i, volno);
				if (!misto) continue;
				c.globalAlpha = 1;
				vypis(c, i, misto, 0.7);
				zasahyPopiskuVyberu.set(i, { x0: misto.x, y0: misto.y - misto.velikost * 0.6, x1: misto.x + misto.w, y1: misto.y + misto.velikost * 0.6 });
				nakresleno++;
			}
		}
		// kandidáti jako ve 2D přehledu: složky od alfy POPISEK_OD (rozkreslené předky), listy jen u složky s rozestupem dětí nad 34 px
		// (u kořene až v detailu); přednost složky před listy, hlavní větve první, pak těžší a mělčí
		const POPISEK_OD = j.POPISEK_OD, POPISEK_PLNY = POPISEK_OD + 0.1, prehled = priblizeni() < j.PREHLED_DO, rozestup = j.rozestup;
		const kandidati: any[] = [];
		for (let i = 1; i < pocet; i++) {
			if (ekrD[i] <= 0 || alfaPopisku[i] < POPISEK_OD) continue;
			if (stav[i] < 0.5 && (vybrany < 0 || stav[i] < 0.11)) continue;
			if (ekrX[i] < -20 || ekrY[i] < -20 || ekrX[i] > sirka + 20 || ekrY[i] > vyska + 20) continue;
			if (typ[i] !== 0) {
				const r = rodic[i];
				if (ekrD[r] <= 0 || rozestup[r] * meritkoCss / ekrD[r] <= 34 || (r === 0 && prehled)) continue;
			}
			kandidati.push(i);
		}
		kandidati.sort((p: any, q: any) => (typ[p] - typ[q])
			|| ((hloubka[p] === 1) !== (hloubka[q] === 1) ? hloubka[p] - hloubka[q] : 0)
			|| (vaha[q] - vaha[p]) || (hloubka[p] - hloubka[q]) || (p - q));
		const rozpocet = rozpocetPopisku(), pouzitaJmena = new Set();
		// body hlavních větví a středu jsou v mřížce obsazené: popisek jedné hlavní větve nesmí zakrýt bod druhé
		for (let i = 0; i < pocet; i++) if (hloubka[i] <= 1 && typ[i] === 0 && ekrD[i] > 0) volno(ekrX[i] - ekrR[i] - 2, ekrY[i] - ekrR[i] - 2, ekrX[i] + ekrR[i] + 2, ekrY[i] + ekrR[i] + 2);
		let nakresleno = 0;
		for (const i of kandidati) {
			if (nakresleno >= rozpocet) break;
			if (zasahyPopiskuVyberu.has(i)) continue;
			const slozka = typ[i] === 0, hlavni = hloubka[i] === 1;
			if (prehled && !hlavni) {
				// v přehledu se opakující název (slides, Transcripts, concepts) ukáže na podstrom hlavní větve jen jednou
				const klicJmena = j.vetev[i] + '|' + jmeno[i];
				if (pouzitaJmena.has(klicJmena)) continue;
				pouzitaJmena.add(klicJmena);
			}
			const misto = hlavni ? umistiPopisekVetve(c, i, volno) : umisti(c, i, volno);
			if (!misto) continue;
			const tlum = vybrany >= 0 ? (stav[i] >= 0.5 ? 0.9 : 0.25) : 1;
			c.globalAlpha = (0.7 + 0.3 * hladce((alfaPopisku[i] - POPISEK_OD) / (POPISEK_PLNY - POPISEK_OD))) * (slozka ? 0.95 : 0.85) * (0.9 + 0.1 * jasMlhy(ekrD[i])) * tlum;
			vypis(c, i, misto, slozka ? 0.55 : 0.7);
			zasahyPopisku.set(i, { x0: misto.x, y0: misto.y - misto.velikost * 0.6, x1: misto.x + misto.w, y1: misto.y + misto.velikost * 0.6 });
			nakresleno++;
		}
		c.globalAlpha = 1;
	}
	function umisti(c: any, i: any, volno: any) {
		const velikost = j.velikostPopisku(i), pismo = j.pismoPopisku(i, velikost), w = j.sirkaTextu(c, jmeno[i], pismo), h = velikost * 0.65, y = ekrY[i] + 1;
		let x = ekrX[i] + ekrR[i] + 5;
		if (!volno(x - 3, y - h, x + w + 3, y + h)) { x = ekrX[i] - ekrR[i] - 5 - w; if (!volno(x - 3, y - h, x + w + 3, y + h)) return null; }
		return { x, y, velikost, pismo, w };
	}
	// popisek hlavní větve jako ve 2D: kotva na prodloužení větve za uzlem (směr k promítnutému těžišti podstromu, jinak od středu),
	// text přiléhá po směru větve, při kolizi se kotva posouvá dál ven, nikdy napříč; nebo zmenšený, nebo vůbec
	function umistiPopisekVetve(c: any, i: any, volno: any) {
		const koren = promitniBod(rozlozeni.poz[0], rozlozeni.poz[1], rozlozeni.poz[2]), tez = promitniBod(rozlozeni.tez[i * 3], rozlozeni.tez[i * 3 + 1], rozlozeni.tez[i * 3 + 2]);
		const vx = ekrX[i], vy = ekrY[i], vr = ekrR[i];
		let ux = tez ? tez[0] - vx : 0, uy = tez ? tez[1] - vy : 0;
		if (Math.hypot(ux, uy) < vr + 4) { ux = koren ? vx - koren[0] : 1; uy = koren ? vy - koren[1] : 0; }
		const d = Math.hypot(ux, uy) || 1; ux /= d; uy /= d;
		const vodorovne = ux > 0.3 ? [0, 0.5, 1] : ux < -0.3 ? [1, 0.5, 0] : [0.5, 0, 1];
		const svisle = uy > 0.3 ? [-1, 0, 1] : uy < -0.3 ? [1, 0, -1] : [0, 1, -1];
		for (const [odstupOd, odstupDo] of [[0, ODSTUP_POPISKU_VETVE], [ODSTUP_POPISKU_VETVE, ODSTUP_POPISKU_NOUZE]]) for (let velikost = j.velikostPopisku(i); velikost >= 11; velikost -= 1.5) {
			const pismo = j.pismoPopisku(i, velikost), w = j.sirkaTextu(c, jmeno[i], pismo), h = velikost * 0.65;
			for (let odstup = 4 + velikost * odstupOd; odstup <= velikost * odstupDo; odstup += 4) {
				const pX = vx + ux * (vr + odstup), pY = vy + uy * (vr + odstup);
				for (const sv of svisle) for (const vo of vodorovne) {
					const x = pX - w * vo, y = pY - sv * h;
					if ((x + w / 2 - vx) * ux + (y - vy) * uy < 0) continue;
					if (volno(x - 3, y - h, x + w + 3, y + h)) return { x, y, velikost, pismo, w };
				}
			}
		}
		return null;
	}
	function vypis(c: any, i: any, misto: any, zesvetleni: any) {
		c.font = misto.pismo;
		c.strokeText(jmeno[i], misto.x, misto.y);
		c.fillStyle = j.rgbNaCss(j.barvaRgb[i].map((ch: any) => Math.round(ch + (255 - ch) * zesvetleni)), 1);
		c.fillText(jmeno[i], misto.x, misto.y);
	}
	// zásah: popisek výběru, pak nejbližší promítnutý bod v toleranci (přednost větší a bližší), pak běžný popisek
	function zasah(x: any, y: any) {
		if (!rozlozeni || !stav) return -1;
		spocitejMatice(); promitniVse();
		for (const [id, o] of zasahyPopiskuVyberu) if (x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) return id;
		let nej = -1, nejD = Infinity;
		for (let i = 0; i < pocet; i++) {
			if (ekrD[i] <= 0 || stav[i] <= 0) continue;
			const d = Math.hypot(ekrX[i] - x, ekrY[i] - y), r = Math.min(ekrR[i], 40);
			if (d > Math.max(r + 6, 14)) continue;
			const cena = d - r * 0.3 + ekrD[i] * 1e-6;
			if (cena < nejD) { nejD = cena; nej = i; }
		}
		if (nej >= 0) return nej;
		for (const [id, o] of zasahyPopisku) if (x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) return id;
		return -1;
	}

	// --- kreslení ---
	// pořadí nehraje roli (aditivní míchání je komutativní): opar, kmeny (jádro + záře), stopky a tenké čáry, závislosti, paprsky výběru, body, impulzy.
	// LOD 1 kreslí záři jen silným větvím, LOD 2 navíc tenké větve jako čáry a bez oparu.
	function kresliGl(cas: any, jenCary = false) {
		gl.viewport(0, 0, platnoGl.width, platnoGl.height);
		gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
		gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
		const [m0, m1] = mlha(), dk = vzdalenost(), blizko = [dk * BLIZKO_CAR[0], dk * BLIZKO_CAR[1]];
		if (!jenCary && lod < MAX_LOD && geometrie.opar.vrcholu) {
			gl.useProgram(progOpar.program);
			gl.uniformMatrix4fv(progOpar.u.uMv, false, mv); gl.uniformMatrix4fv(progOpar.u.uProj, false, proj); gl.uniform1f(progOpar.u.uMeritko, meritkoCss); gl.uniform2f(progOpar.u.uMlha, m0, m1);
			nahraj('oparAlfa', oparAlfa, true);
			pripojAtribut(progOpar, 'aPoz', 'oparPoz', 3); pripojAtribut(progOpar, 'aRoh', 'oparRoh', 2); pripojAtribut(progOpar, 'aVel', 'oparVel', 1); pripojAtribut(progOpar, 'aBarva', 'oparBarva', 3); pripojAtribut(progOpar, 'aSila', 'oparSila', 1); pripojAtribut(progOpar, 'aAlfa', 'oparAlfa', 1);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, geometrie.opar.vrcholu);
		}
		if (geometrie.pas.vrcholu) {
			gl.useProgram(progPasy.program);
			gl.uniformMatrix4fv(progPasy.u.uMv, false, mv); gl.uniformMatrix4fv(progPasy.u.uProj, false, proj); gl.uniform1f(progPasy.u.uMeritko, meritkoCss);
			gl.uniform2f(progPasy.u.uMlha, m0, m1); gl.uniform2f(progPasy.u.uBlizko, blizko[0], blizko[1]);
			pripojAtribut(progPasy, 'aPoz', 'pasPoz', 3); pripojAtribut(progPasy, 'aTecna', 'pasTecna', 3); pripojAtribut(progPasy, 'aStrana', 'pasStrana', 1); pripojAtribut(progPasy, 'aSirka', 'pasSirka', 1); pripojAtribut(progPasy, 'aBarva', 'pasBarva', 3); pripojAtribut(progPasy, 'aStav', 'pasStav', 1);
			const pruchod = (p: any, vrcholu: any) => { gl.uniform1f(progPasy.u.uNasobek, p.nasobek); gl.uniform1f(progPasy.u.uMinPx, p.minPx); gl.uniform1f(progPasy.u.uMaxPx, p.maxPx); gl.uniform1f(progPasy.u.uAlfa, p.alfa); gl.uniform1f(progPasy.u.uMekky, p === PAS_ZARE ? 1 : 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, vrcholu); };
			pruchod(PAS_JADRO, lod >= MAX_LOD ? geometrie.pas.silnychVrcholu : geometrie.pas.vrcholu);
			pruchod(PAS_ZARE, lod >= 1 ? geometrie.pas.silnychVrcholu : geometrie.pas.vrcholu);
		}
		gl.useProgram(progCary.program);
		gl.uniformMatrix4fv(progCary.u.uMvp, false, mvp); gl.uniformMatrix4fv(progCary.u.uMv, false, mv); gl.uniform2f(progCary.u.uMlha, m0, m1); gl.uniform2f(progCary.u.uBlizko, blizko[0], blizko[1]);
		const cary = (poz: any, barva: any, sila: any, st: any, vrcholu: any) => { if (!vrcholu) return; pripojAtribut(progCary, 'aPoz', poz, 3); pripojAtribut(progCary, 'aBarva', barva, 3); pripojAtribut(progCary, 'aSila', sila, 1); pripojAtribut(progCary, 'aStav', st, 1); gl.drawArrays(gl.LINES, 0, vrcholu); };
		cary('stopPoz', 'stopBarva', 'stopSila', 'stopStav', geometrie.stopky.vrcholu);
		if (lod >= MAX_LOD) cary('tenkePoz', 'tenkeBarva', 'tenkeSila', 'tenkeStav', geometrie.tenke.vrcholu);
		cary('zavPoz', 'zavBarva', 'zavSila', 'zavStav', pocetZavislostiVrcholu);
		cary('zvPoz', 'zvBarva', 'zvSila', 'zvStav', pocetZvyraznenychVrcholu);
		if (jenCary) return;
		gl.useProgram(progBody.program);
		gl.uniformMatrix4fv(progBody.u.uMvp, false, mvp); gl.uniformMatrix4fv(progBody.u.uMv, false, mv);
		gl.uniform1f(progBody.u.uMeritko, meritkoCss * dpr); gl.uniform2f(progBody.u.uMlha, m0, m1); gl.uniform1f(progBody.u.uMaxBod, maxBod); gl.uniform1f(progBody.u.uPevnePx, 0);
		pripojAtribut(progBody, 'aPoz', 'poz', 3); pripojAtribut(progBody, 'aBarva', 'barva', 3); pripojAtribut(progBody, 'aVel', 'vel', 1); pripojAtribut(progBody, 'aStav', 'stav', 1); pripojAtribut(progBody, 'aDruh', 'druh', 1);
		gl.drawArrays(gl.POINTS, 0, pocet);
		if (pocetBoduVyberu) {
			pripojAtribut(progBody, 'aPoz', 'vybPoz', 3); pripojAtribut(progBody, 'aBarva', 'vybBarva', 3); pripojAtribut(progBody, 'aVel', 'vybVel', 1); pripojAtribut(progBody, 'aStav', 'vybStav', 1); pripojAtribut(progBody, 'aDruh', 'vybDruh', 1);
			gl.drawArrays(gl.POINTS, 0, pocetBoduVyberu);
		}
		if (impulzy.length) kresliImpulzy(cas);
	}
	// impulzy po čarách vazeb ve směru vazby (ven od vybraného, dovnitř k němu), velikost pevně 6 px
	function kresliImpulzy(cas: any) {
		let n = 0;
		for (const im of impulzy) n += im.pocet;
		const poz = new Float32Array(n * 3), barva = new Float32Array(n * 3), st = new Float32Array(n).fill(0.9), vel = new Float32Array(n).fill(1), dr = new Float32Array(n);
		let q = 0;
		for (const im of impulzy) {
			const a = poziceUzlu(im.odStredu ? im.a : im.b), b = poziceUzlu(im.odStredu ? im.b : im.a);
			for (let k = 0; k < im.pocet; k++) {
				let t = ((cas / 2600) + im.faze + k / im.pocet) % 1;
				if (t < 0) t += 1;
				poz[q * 3] = a[0] + (b[0] - a[0]) * t; poz[q * 3 + 1] = a[1] + (b[1] - a[1]) * t; poz[q * 3 + 2] = a[2] + (b[2] - a[2]) * t;
				barva[q * 3] = im.rgb[0] / 255; barva[q * 3 + 1] = im.rgb[1] / 255; barva[q * 3 + 2] = im.rgb[2] / 255;
				q++;
			}
		}
		nahraj('impPoz', poz, true); nahraj('impBarva', barva, true); nahraj('impVel', vel, true); nahraj('impStav', st, true); nahraj('impDruh', dr, true);
		gl.uniform1f(progBody.u.uPevnePx, 2.2 * dpr);
		pripojAtribut(progBody, 'aPoz', 'impPoz', 3); pripojAtribut(progBody, 'aBarva', 'impBarva', 3); pripojAtribut(progBody, 'aVel', 'impVel', 1); pripojAtribut(progBody, 'aStav', 'impStav', 1); pripojAtribut(progBody, 'aDruh', 'impDruh', 1);
		gl.drawArrays(gl.POINTS, 0, n);
		gl.uniform1f(progBody.u.uPevnePx, 0);
	}
	function pozadujSnimek() {
		if (zniceno || !aktivni || !rozlozeni || j.jePozastaveno() || smyckaBezi) return;
		smyckaBezi = true;
		casPozadavku = okno.performance.now();
		idSnimku = okno.requestAnimationFrame(snimek);
	}
	// LOD z intervalu rAF: vzorek je snímek navazující na předchozí - pohyb, který si ho vyžádal, začal do LOD_MEZERA_MS po konci JS předchozího
	// snímku (řetěz animace žádá hned, gesto podle první sloučené události pointermove, kolečko podle události; prohlížeč s vstupem zarovnaným na
	// snímek doručí událost až s dalším snímkem, proto se bere začátek pohybu, ne doručení). Delší mezera = nečinnost mezi pohyby: snímek se
	// přeskočí, vzorky zůstanou. Od intervalu se odečte čekání na vstup, aby pomalý pohyb ruky s rychlými snímky stupeň nezvedl; dlouhý
	// snímek vzorky nikdy nemaže. Medián z LOD_VZORKU nad prahem stupeň zvýší, nic ho nesnižuje.
	function sledujLod(cas: any) {
		if (lodRucni || lod >= MAX_LOD || !(posledniCas > 0) || !(konecSnimku > 0)) return;
		const mezera = Math.max(0, Math.min(casPozadavku, vstupOd) - konecSnimku);
		if (mezera > LOD_MEZERA_MS) return;
		intervalyRaf.push(Math.max(0, cas - posledniCas - mezera));
		if (intervalyRaf.length < LOD_VZORKU) return;
		const serazene = intervalyRaf.slice().sort((p: any, q: any) => p - q);
		if (serazene[serazene.length >> 1] > LOD_PRAH_MS) lod++;
		intervalyRaf.length = 0;
	}
	// začátek vstupu, který si žádá snímek: u gesta první sloučená událost (getCoalescedEvents), jinak čas události
	function zaznamenejVstup(e: any) {
		const sloucene = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
		const od = sloucene && sloucene.length ? sloucene[0].timeStamp : e.timeStamp;
		if (Number.isFinite(od) && od < vstupOd) vstupOd = od;
	}
	// smyčka běží jen při pohybu: přelet, let klávesami, kroužení, impulzy výběru; gesta si snímek vyžádají samy
	function snimek(cas: any) {
		idSnimku = 0;
		smyckaBezi = false;
		if (zniceno || !aktivni || j.jePozastaveno()) return;
		const zacatek = okno.performance.now();
		const dt = posledniCas ? Math.min(0.1, (cas - posledniCas) / 1000) : 0.016;
		let dalsi = false;
		if (let_) { krokPreletu(cas); dalsi = true; }
		else if (krokLetuKlavesami(dt)) dalsi = true;
		else if (krokKrouzeni(cas, dt)) dalsi = true;
		sledujLod(cas);
		posledniCas = cas; vstupOd = Infinity;
		if (ztracen || !gl) { konecSnimku = okno.performance.now(); if (dalsi) pozadujSnimek(); return; }
		const klicVyberu = j.vybrany + '|' + (j.zavislostiZapnute ? 1 : 0);
		if (spinave || klicVyberu !== posledniKlicVyberu) { posledniKlicVyberu = klicVyberu; prebuduj(); }
		spocitejMatice();
		promitniVse();
		spocitejAlfy();
		kresliGl(cas);
		kresliPopisky();
		j.zmerSnimek?.(zacatek);
		if (impulzy.length) dalsi = true;
		snimku++;
		posledniSnimekMs = okno.performance.now() - zacatek;
		casySnimku.push(posledniSnimekMs);
		if (casySnimku.length > 240) casySnimku.shift();
		if (zpomaleniMs > 0) { const konec = okno.performance.now() + zpomaleniMs; while (okno.performance.now() < konec) { /* ladicí zpomalení snímku (kontrola LOD) */ } }
		konecSnimku = okno.performance.now();
		if (dalsi) pozadujSnimek();
	}

	// --- ovládání ---
	const ukazatele = new Map();
	let gesto: any = null;
	function napojOvladani() {
		platnoP.tabIndex = 0;
		naslouchej(platnoP, 'pointerdown', (e: any) => {
			if (!aktivni || j.jePozastaveno() || j.uOkrajeObrazovky(e)) return;
			platnoP.setPointerCapture(e.pointerId);
			platnoP.focus({ preventScroll: true });
			ukazatele.set(e.pointerId, { x: e.clientX, y: e.clientY });
			j.zavriVysledky();
			vstup();
			if (ukazatele.size === 1) {
				gesto = { typ: (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) ? 'posun' : 'rotace', x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, pohyb: false, tap: e.button === 0 && !e.ctrlKey && !e.metaKey };
			} else if (ukazatele.size === 2) {
				const [a, b] = [...ukazatele.values()];
				gesto = { typ: 'dvaPrsty', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, pohyb: true, tap: false };
			} else gesto = null;
			platnoP.classList.add('tahnu');
			e.preventDefault();
		});
		naslouchej(platnoP, 'pointermove', (e: any) => {
			if (!ukazatele.has(e.pointerId)) return;
			ukazatele.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (!gesto) return;
			zaznamenejVstup(e);
			if (gesto.typ === 'dvaPrsty') {
				if (ukazatele.size !== 2) return;
				const [a, b] = [...ukazatele.values()];
				const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
				if (gesto.d > 0 && d > 0) zoom(gesto.d / d);
				posun(mx - gesto.mx, my - gesto.my, RYCHLOST_POSUNU.dotyk);
				gesto.d = d; gesto.mx = mx; gesto.my = my;
			} else {
				if (ukazatele.size !== 1) return;
				const dx = e.clientX - gesto.x, dy = e.clientY - gesto.y;
				if (Math.hypot(e.clientX - gesto.startX, e.clientY - gesto.startY) > PRAH_TAPU) gesto.pohyb = true;
				if (gesto.typ === 'rotace') otoc(dx, dy); else posun(dx, dy, e.pointerType === 'mouse' ? RYCHLOST_POSUNU.mys : RYCHLOST_POSUNU.dotyk);
				gesto.x = e.clientX; gesto.y = e.clientY;
			}
			vstup();
			pozadujSnimek();
		});
		const konec = (e: any) => {
			if (!ukazatele.has(e.pointerId)) return;
			ukazatele.delete(e.pointerId);
			vstup();   // dřív než ťuknutí: to spouští přelet, který by vstup zrušil
			if (ukazatele.size === 0) {
				platnoP.classList.remove('tahnu');
				if (gesto && gesto.tap && !gesto.pohyb && e.type === 'pointerup') tapni(e.clientX, e.clientY);
				gesto = null;
			} else if (ukazatele.size === 1) {
				const [z] = [...ukazatele.values()];
				gesto = { typ: 'rotace', x: z.x, y: z.y, startX: z.x, startY: z.y, pohyb: true, tap: false };
			} else if (ukazatele.size === 2) {
				// ze tří prstů zpět na dva: pinch/pan zbývajících dvou pokračuje od jejich současné polohy (bez skoku a bez ťuknutí)
				const [a, b] = [...ukazatele.values()];
				gesto = { typ: 'dvaPrsty', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, pohyb: true, tap: false };
			}
		};
		naslouchej(platnoP, 'pointerup', konec);
		naslouchej(platnoP, 'pointercancel', konec);
		naslouchej(platnoP, 'contextmenu', (e: any) => e.preventDefault());
		naslouchej(platnoP, 'dblclick', (e: any) => e.preventDefault());
		naslouchej(platnoP, 'wheel', (e: any) => {
			e.preventDefault();
			// exponenciála: pro malé kroky jako dřívější 1 + x, ale kladná i pro velké záporné deltaY (rychlé točení kolečkem)
			// exponent sevřený, ať Math.exp nepodteče na 0 ani nepřeteče (xcheck k11); meze vzdálenosti hlídá zoom()
			const faktor = Math.exp(sevri(e.deltaY * (e.deltaMode === 2 ? 0.025 : e.deltaMode === 1 ? 0.01 : 0.00025) * RYCHLOST_ZOOMU, -20, 20));
			zoom(faktor);
			zaznamenejVstup(e);
			vstup();
			pozadujSnimek();
		}, { passive: false });
		naslouchej(platnoP, 'keydown', (e: any) => {
			if (!aktivni || j.jePozastaveno() || platnoP.ownerDocument.activeElement !== platnoP) return;
			const k = e.key.toLowerCase();
			if (e.ctrlKey || e.metaKey || e.altKey || !['w', 'a', 's', 'd', 'q', 'e', 'f', 'r', 'escape'].includes(k)) return;
			e.stopPropagation();
			shift = e.shiftKey;
			if ('wasdqe'.includes(k) && k.length === 1) { stisknute.add(k); vstup(); pozadujSnimek(); e.preventDefault(); }
			else if (k === 'f') { if (j.vybrany >= 0) letNa(j.vybrany); e.preventDefault(); }
			else if (k === 'r') { vstup(); celek(); e.preventDefault(); }
			else if (k === 'escape') { j.vyber(-1); e.preventDefault(); }
		});
		naslouchej(platnoP, 'keyup', (e: any) => { const k = e.key.toLowerCase(); if (stisknute.has(k)) e.stopPropagation(); shift = e.shiftKey; stisknute.delete(k); j.aktualizujCelek?.(); });
		naslouchej(platnoP, 'blur', () => { stisknute.clear(); j.aktualizujCelek?.(); });

	}
	function tapni(x: any, y: any) {
		const r = platnoP.getBoundingClientRect(), i = zasah(x - r.left, y - r.top);
		// výběr až po startu přeletu: popisek Celek/Detail se během přeletu nemění, aktualizuje ho jeho konec (B5 k4)
		if (i >= 0) { preletKUzlu(i); j.vyber(i); } else j.vyber(-1);
		pozadujSnimek();
	}

	// --- zapnutí a vypnutí pohledu ---
	let napojeno = false;
	function zapni() {
		if (zniceno || !podporovano) return false;
		aktivni = true;
		if (j.jePozastaveno()) return true;
		posledniCas = 0; konecSnimku = 0; vstupOd = Infinity;
		if (!rozlozeni) {
			j.hlaska(texty.pocitam3d);
			// mimo hlavní snímek: až se hláška vykreslí
			casovacStartu = okno.setTimeout(() => {
				casovacStartu = null;
				if (zniceno || j.jePozastaveno() || !aktivni) { j.hlaska(null); return; }
				try {
					if (!gl && !ziskejKontext()) throw new Error(duvodNepodpory);
					zmenVelikost();   // dřív než zdroje (strop bodu podle dpr) a než úvodní kamera (vzdálenost podle poměru stran)
					prepocitejRozlozeni();
					dZakladni = vychoziZaber().d;
					obnovKameru(cekajiciKamera);
					if (!napojeno) { napojOvladani(); napojeno = true; }
				} catch (chyba: any) {
					podporovano = false; duvodNepodpory = texty.selhalWebgl + chyba.message;
					j.hlaska(null); j.vypadek3d(duvodNepodpory);
					return;
				}
				j.hlaska(null);
				vstup();
				pozadujSnimek();
			}, 0);
			return true;
		}
		zmenVelikost();
		spinave = true;
		vstup();
		pozadujSnimek();
		return true;
	}
	function zrusGesto() {
		for (const id of ukazatele.keys()) if (platnoP.hasPointerCapture(id)) platnoP.releasePointerCapture(id);
		ukazatele.clear(); gesto = null; platnoP.classList.remove('tahnu');
	}
	function pozastav() {
		if (idSnimku) okno.cancelAnimationFrame(idSnimku);
		idSnimku = 0; smyckaBezi = false;
		if (casovacStartu !== null) okno.clearTimeout(casovacStartu);
		casovacStartu = null;
		if (casovacKlidu !== null) okno.clearTimeout(casovacKlidu);
		casovacKlidu = null;
		stisknute.clear(); shift = false; let_ = null; kotvaKrouzeni = null;
		zrusGesto();
	}
	function vypni() { aktivni = false; pozastav(); j.hlaska(null); }
	function obnovVelikost() {
		if (zniceno || !aktivni) return;
		if (j.jePozastaveno()) { pozastav(); return; }
		if (!rozlozeni) { if (casovacStartu === null) zapni(); return; }
		const [w, h] = j.rozmery();
		if (w !== sirka || h !== vyska) { zrusGesto(); stisknute.clear(); shift = false; }
		zmenVelikost(); j.aktualizujCelek?.(); posledniCas = 0; naplanujKlid(); pozadujSnimek();
	}
	function destroy() {
		if (zniceno) return;
		zniceno = true; vypni();
		for (const p of posluchace) p.cil.removeEventListener(p.typ, p.fn, p.volby);
		posluchace.length = 0;
		uvolniZdroje();
		if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
		gl = null; rozlozeni = null; geometrie = null;
		for (const c of [platnoGl, platnoP]) { c.width = c.height = 0; }
	}

	function zneplatni() { spinave = true; pozadujSnimek(); }
	function zmenData(noveJadro: any, { jenVazby = false } = {}) {
		j = noveJadro;
		if (jenVazby) { spinave = true; pozadujSnimek(); return; }
		({ pocet, rodic, typ, vaha, jmeno, cesta, hloubka, potomci } = j);
		vstup(); stav = null; impulzy = []; zasahyPopisku.clear(); zasahyPopiskuVyberu.clear();
		if (rozlozeni && aktivni) {
			try { prepocitejRozlozeni(); dZakladni = vychoziZaber().d; }
			catch (chyba: any) { podporovano = false; duvodNepodpory = texty.selhalWebgl + chyba.message; j.vypadek3d(); }
		} else { uvolniZdroje(); rozlozeni = null; geometrie = null; }
		spinave = true; pozadujSnimek();
	}
	function nastavKrouzeni(zapnout: any) { krouzeniZapnute = Boolean(zapnout); if (!krouzeniZapnute) kotvaKrouzeni = null; naplanujKlid(); }

	podporovano = sondaWebgl();

	return {
		get podporovano() { return podporovano; }, get duvodNepodpory() { return duvodNepodpory; }, get aktivni() { return aktivni; },
		jeCelek: () => !!rozlozeni && vzdalenost() >= dZakladni * 0.99, detailZmeniZaber,
		stavKamery, obnovKameru, zapni, vypni, destroy, pozastav, obnovVelikost, zneplatni, zmenData, letNa, celek, pozadujSnimek, zmenVelikost, nastavKrouzeni, get krouzeni() { return krouzeniZapnute; },
		// Diagnostika patří instanci, bez vazby na hash celého okna.
		ladeni: {
			get pozice() { return rozlozeni ? Array.from(rozlozeni.poz) : null; },
			get pripraveno() { return aktivni && !!rozlozeni && !!stav; }, get rozlozeniMs() { return rozlozeniMs; }, get R() { return rozlozeni ? rozlozeni.R : 0; },
			get kamera() { return { kam: kam.slice(), cil: cil.slice(), nahoru: nahoru.slice(), vzdalenost: rozlozeni ? vzdalenost() : 0 }; },
			get leti() { return !!let_; }, get krouzi() { return !!kotvaKrouzeni; }, get snimku() { return snimku; }, get posledniSnimekMs() { return posledniSnimekMs; },
			get casySnimku() { return casySnimku.slice(); }, vynulujCasy() { casySnimku.length = 0; },
			get popisky() { return [...zasahyPopisku].map(([id, o]: any) => ({ id, ...o })); }, get popiskyVyberu() { return [...zasahyPopiskuVyberu].map(([id, o]: any) => ({ id, ...o })); },
			get zavislosti() { return { ...pocetZavislosti }; }, get impulzu() { return impulzy.length; }, get skrytych() { let n = 0; if (skryty) for (let i = 0; i < pocet; i++) n += skryty[i]; return n; },
			promitni, zasah, poziceUzlu: (i: any) => rozlozeni ? poziceUzlu(i) : null, polomerSveta: (i: any) => rozlozeni ? rozlozeni.polomerSveta[i] : 0,
			nastavKlid(ms: any) { posledniVstup = okno.performance.now() - ms; kotvaKrouzeni = null; naplanujKlid(); pozadujSnimek(); },
			ztratKontext() { const ext = gl && gl.getExtension('WEBGL_lose_context'); if (!ext) return false; ext.loseContext(); return true; },
			get dpr() { return dpr; }, get rozmer() { return [sirka, vyska]; },
			get prstu() { return ukazatele.size; }, get gesto() { return gesto ? gesto.typ : null; },
			viditelnaKotva, vzdalenostDosednuti: (i: any) => rozlozeni ? vzdalenostDosednuti(viditelnaKotva(i)) : 0, polomerPodstromu: (i: any) => rozlozeni ? polomerPodstromu(i) : 0,
			get rozpocetPopisku() { return rozlozeni ? rozpocetPopisku() : 0; }, get priblizeni() { return rozlozeni ? priblizeni() : 1; }, get dZakladni() { return dZakladni; },
			// k8: rozsahy rozložení (x, y ze 2D, z hloubka) a počty vrcholů geometrie, LOD (čtení i ruční nastavení), kamera podle azimutu a elevace
			get rozsah() { return rozlozeni ? { ...rozlozeni.rozsah, podilZ: rozlozeni.rozsah.z / Math.max(rozlozeni.rozsah.x, rozlozeni.rozsah.y), otoceno: rozlozeni.otoceno, natazeni: rozlozeni.natazeni } : null; },
			get geometrie() { return geometrie ? { pasVrcholu: geometrie.pas.vrcholu, pasSilnychVrcholu: geometrie.pas.silnychVrcholu, tenkeVrcholu: geometrie.tenke.vrcholu, stopekVrcholu: geometrie.stopky.vrcholu, oparVrcholu: geometrie.opar.vrcholu } : null; },
			get lod() { return lod; }, nastavLod(n: any, rucni: any = true) { lod = sevri(Math.round(n), 0, MAX_LOD); lodRucni = rucni; intervalyRaf.length = 0; pozadujSnimek(); },
			// k9: počet nasbíraných vzorků LOD; umělé zpomalení každého snímku (ms, 0 vypne) pro kontrolu LOD; barevné buffery částí geometrie s uzlem vrcholu a barvy uzlů 2D
			get lodVzorku() { return intervalyRaf.length; }, zpomalSnimek(ms: any) { zpomaleniMs = Math.max(0, Number(ms) || 0); },
			castiGeometrie() { return geometrie ? { pas: { buffer: buf.pasBarva, uzel: geometrie.pas.uzel }, tenke: { buffer: buf.tenkeBarva, uzel: geometrie.tenke.uzel }, stopky: { buffer: buf.stopBarva, uzel: geometrie.stopky.uzel }, opar: { buffer: buf.oparBarva, uzel: geometrie.opar.uzel } } : null; },
			get barvyUzlu() { return j.barvaRgb; },
			// promítnuté pozice uzlů v aktuální kameře (CSS px) pro srovnání tvaru s 2D
			promitnutePozice(ids: any) { if (!rozlozeni) return null; spocitejMatice(); promitniVse(); return ids.map((i: any) => ekrD[i] > 0 ? [ekrX[i], ekrY[i]] : null); },
			// kamera ve vzdálenosti d (výchozí aktuální) kolem cíle: azimut kolem svislé osy, elevace nad rovinou xz; nahoru = y
			nastavKameru(azimutDeg: any, elevaceDeg: any, d: any) {
				if (!rozlozeni) return; const r = d || vzdalenost(), az = azimutDeg * Math.PI / 180, el = elevaceDeg * Math.PI / 180;
				kam = add(cil, [r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az)]); nahoru = [0, 1, 0]; let_ = null; kotvaKrouzeni = null; pozadujSnimek();
			},
			// obal promítnutých viditelných bodů v CSS px [x0, y0, x1, y1]
			obalBodu() { if (!rozlozeni) return null; spocitejMatice(); promitniVse(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < pocet; i++) { if (ekrD[i] <= 0 || (stav && stav[i] <= 0)) continue; x0 = Math.min(x0, ekrX[i]); y0 = Math.min(y0, ekrY[i]); x1 = Math.max(x1, ekrX[i]); y1 = Math.max(y1, ekrY[i]); } return [x0, y0, x1, y1]; },
			// paprsky výběru (čáry vazeb) na plátně: průměrná délka ořezaná na plátno v podílu půlky úhlopříčky a podíl paprsků delších než půlka úhlopříčky
			delkyPaprsku() {
				if (!rozlozeni || !zvPozPosledni) return null;
				if (spinave) prebuduj();
				spocitejMatice();
				const m = mvp, W = sirka, H = vyska, polDiag = Math.hypot(W, H) / 2, zv = zvPozPosledni, blizko = 0.5;
				const klip = (x: any, y: any, z: any) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[3] * x + m[7] * y + m[11] * z + m[15]];
				let n = 0, soucet = 0, dlouhych = 0, koncuMimo = 0;
				for (let q = 0; q + 5 < zv.length; q += 6) {
					let a = klip(zv[q], zv[q + 1], zv[q + 2]), b = klip(zv[q + 3], zv[q + 4], zv[q + 5]);
					n++;
					// vzdálený konec paprsku (druhý vrchol) za kamerou nebo mimo plátno: takový paprsek protne celé plátno bez cíle v záběru
					if (b[2] < blizko || Math.abs(b[0] / b[2]) > 1 || Math.abs(b[1] / b[2]) > 1) koncuMimo++;
					if (a[2] < blizko && b[2] < blizko) continue;
					if (a[2] < blizko || b[2] < blizko) { const t = (blizko - a[2]) / (b[2] - a[2]), pr = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, blizko]; if (a[2] < blizko) a = pr; else b = pr; }
					const x0 = (a[0] / a[2] * 0.5 + 0.5) * W, y0 = (0.5 - a[1] / a[2] * 0.5) * H, x1 = (b[0] / b[2] * 0.5 + 0.5) * W, y1 = (0.5 - b[1] / b[2] * 0.5) * H;
					const dx = x1 - x0, dy = y1 - y0;
					let t0 = 0, t1 = 1, ok = true;
					for (const [pp, qq] of [[-dx, x0], [dx, W - x0], [-dy, y0], [dy, H - y0]]) {
						if (pp === 0) { if (qq < 0) { ok = false; break; } continue; }
						const r = qq / pp;
						if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
					}
					const L = ok ? Math.hypot(dx, dy) * (t1 - t0) : 0;
					soucet += L; if (L > polDiag) dlouhych++;
				}
				return { paprsku: n, prumerPodil: n ? soucet / n / polDiag : 0, podilDlouhych: n ? dlouhych / n : 0, podilKoncuMimo: n ? koncuMimo / n : 0 };
			},
			// podíl rozsvícených vzorků plátna WebGL po jednom nakreslení (každý krok-tý pixel; jas = součet RGB nad prahem)
			vzorekJasu(krok: any = 6, prah: any = 90, jenCary: any = false) { if (!gl || !rozlozeni || ztracen) return null; if (spinave) prebuduj(); spocitejMatice(); promitniVse(); spocitejAlfy(); kresliGl(okno.performance.now(), jenCary); const w = platnoGl.width, h = platnoGl.height, px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let n = 0, svetle = 0; for (let y = 0; y < h; y += krok) for (let x = 0; x < w; x += krok) { const o = (y * w + x) * 4; n++; if (px[o] + px[o + 1] + px[o + 2] > prah) svetle++; } return { podil: svetle / n, vzorku: n }; }
		}
	};
}
return { tovarna, rozlozZ2d, sestavGeometrii };
}
