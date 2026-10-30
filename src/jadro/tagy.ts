import type { TagMapy } from '../adapter.ts';

export interface BodTagu { x: number; y: number; z: number; r: number }
export function barvaTagu(paleta: number): string { return ['#ca4551', '#ce4854', '#d14b57'][paleta] ?? '#ca4551'; }
export function svetlaBarvaTagu(paleta: number): string { return ['#fc898f', '#fb878e', '#fa858c'][paleta] ?? '#fc898f'; }
export function normalizujHledani(text: string): string { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
export function shodaTagu(name: string, dotaz: string): boolean { return normalizujHledani(name).includes(normalizujHledani(dotaz.trim())); }
export function viditelnostTagu(tags: readonly TagMapy[], tagLinks: boolean, allTags: boolean, poznamka: number, tag: number): { uzly: number[]; cary: [number, number][] } {
 const uzly: number[] = [], cary: [number, number][] = [];
 tags.forEach((zaznam, index) => {
  const vybrany = index === tag, uPoznamky = poznamka >= 0 && zaznam.notes.includes(poznamka);
  if (allTags || vybrany || (tagLinks && uPoznamky)) uzly.push(index);
  if (vybrany) for (const note of zaznam.notes) cary.push([index, note]);
  else if (uPoznamky && (tagLinks || allTags)) cary.push([index, poznamka]);
 });
 return { uzly, cary };
}
function polomerTagu(pocet: number): number { return Math.min(18, 3 + Math.sqrt(pocet) * 0.35); }

type Smer = { x: number; y: number; z: number };
function obalMapy(uzly: Smer[]) {
 const serazene = [...uzly].sort((a, b) => a.x - b.x || a.y - b.y);
 const zatoceni = (a: Smer, b: Smer, c: Smer) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
 const pulka = (body: Smer[]) => {
  const obal: Smer[] = [];
  for (const bod of body) { while (obal.length > 1 && zatoceni(obal[obal.length - 2], obal[obal.length - 1], bod) <= 0) obal.pop(); obal.push(bod); }
  return obal;
 };
 const dolni = pulka(serazene), horni = pulka([...serazene].reverse());
 const obal = [...dolni.slice(0, -1), ...horni.slice(0, -1)];
 return obal.map((a, i) => {
  const b = obal[(i + 1) % obal.length], delka = Math.hypot(b.x - a.x, b.y - a.y);
  const x = (b.y - a.y) / delka, y = (a.x - b.x) / delka;
  return { x, y, r: a.x * x + a.y * y };
 });
}
function umistovac(rovina: boolean) {
 const mrizka = new Map<number | string, BodTagu[]>();
 const klicBunky = (x: number, y: number, z: number) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 65536 ? ((x + 65536) * 131072 + y + 65536) * 131072 + z + 65536 : `${x},${y},${z}`;
 return (bod: BodTagu): boolean => {
  const gx = Math.floor(bod.x / 64), gy = Math.floor(bod.y / 64), gz = Math.floor(bod.z / 64);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = rovina ? 0 : -1; dz <= (rovina ? 0 : 1); dz++) {
   for (const jiny of mrizka.get(klicBunky(gx + dx, gy + dy, gz + dz)) ?? []) if ((bod.x - jiny.x) ** 2 + (bod.y - jiny.y) ** 2 + (bod.z - jiny.z) ** 2 < (bod.r + jiny.r + 12) ** 2) return false;
  }
  const klic = klicBunky(gx, gy, gz), bunka = mrizka.get(klic) ?? [];
  bunka.push(bod); mrizka.set(klic, bunka); return true;
 };
}

function rozlozTagy(tags: readonly TagMapy[], x: ArrayLike<number>, y: ArrayLike<number>, nasobek: number, rezerva: number, poz?: ArrayLike<number>): BodTagu[] {
 const MEZERA_TAGU = 32, ROZESTUP_TAGU = 56, UHEL = 2 * Math.PI;
 const uzly = Array.from(x, (v, i) => ({ x: v, y: y[i], z: 0 }));
 const obal = obalMapy(uzly.map(b => ({ x: b.x * nasobek, y: b.y * nasobek, z: 0 })));
 const usece = Array.from({ length: 72 }, () => 0);
 for (const [i, uzel] of uzly.entries()) {
  const usec = (Math.round(Math.atan2(uzel.y, uzel.x) * 72 / UHEL) + 72) % 72;
  usece[usec] = Math.max(usece[usec], Math.hypot(uzel.x * nasobek, uzel.y * nasobek, poz ? poz[i * 3 + 2] : 0));
 }
 const obrys = usece.map((r, i) => Math.max(r, ...[-2, -1, 1, 2].map(d => usece[(i + d + 72) % 72])));
 const zaklad = Array.from({ length: 720 }, (_, i) => {
  const u = i * UHEL / 720, cx = Math.cos(u), cy = Math.sin(u), odstup = MEZERA_TAGU + 18 + rezerva;
  let r = Infinity;
  for (const hrana of obal) {
   const kolmo = cx * hrana.x + cy * hrana.y;
   if (kolmo > 0) r = Math.min(r, (hrana.r + odstup) / kolmo);
  }
  if (!Number.isFinite(r) || r < odstup) r = Math.max(odstup, ...uzly.map(b => Math.hypot(b.x, b.y) * nasobek + odstup));
  const usec = i / 10;
  r = Math.max(r, obrys[Math.floor(usec)] + odstup, obrys[(Math.floor(usec) + 1) % 72] + odstup);
  return { u, r };
 });
 const obsazene: Set<number>[] = [], odmitnute: Map<number, number>[] = [], volne: Map<number, number[]>[] = [];
 const vrstvy: { u: number; r: number }[][] = [], body: BodTagu[] = new Array<BodTagu>(tags.length), umisti = umistovac(!poz);
 const serazene = tags.map((tag, index) => ({ tag, index })).sort((a, b) => b.tag.notes.length - a.tag.notes.length || a.index - b.index);
 for (const { tag, index } of serazene) {
  let sx = 0, sy = 0;
  for (const note of tag.notes) { const u = Math.atan2(y[note], x[note]); sx += Math.cos(u); sy += Math.sin(u); }
  const smer = Math.atan2(sy, sx), r = polomerTagu(tag.notes.length);
  const z = poz ? tag.notes.reduce((sum, note) => sum + poz[note * 3 + 2], 0) * 0.2 / Math.max(1, tag.notes.length) : 0;
  for (let vrstva = 0; ; vrstva++) {
   if (!vrstvy[vrstva]) {
    const vzorky = zaklad.map(bod => ({ u: bod.u, r: bod.r + vrstva * ROZESTUP_TAGU }));
    const delky = [0];
    for (let i = 1; i <= vzorky.length; i++) {
     const a = vzorky[i - 1], b = vzorky[i % vzorky.length];
     delky.push(delky[i - 1] + Math.hypot(a.r * Math.cos(a.u) - b.r * Math.cos(b.u), a.r * Math.sin(a.u) - b.r * Math.sin(b.u)));
    }
    const delka = delky[delky.length - 1], kapacita = Math.max(1, Math.floor(delka / 52));
    let vzorek = 0;
    vrstvy[vrstva] = Array.from({ length: kapacita }, (_, i) => {
     while (vzorek < 719 && delky[vzorek + 1] < i * delka / kapacita) vzorek++;
     return vzorky[vzorek];
    });
   }
   const sloty = vrstvy[vrstva], obsazena = obsazene[vrstva] ?? (obsazene[vrstva] = new Set());
   const odmitnuta = odmitnute[vrstva] ?? (odmitnute[vrstva] = new Map());
   const u = (smer + UHEL) % UHEL;
   if (!poz) {
    const volnePolomery = volne[vrstva] ?? (volne[vrstva] = new Map());
    const kandidati = volnePolomery.get(r) ?? Array.from({ length: sloty.length }, (_, i) => i);
    volnePolomery.set(r, kandidati);
    let nalezen = false;
    while (kandidati.length) {
     let dole = 0, nahore = kandidati.length;
     while (dole < nahore) { const pul = (dole + nahore) >>> 1; if (sloty[kandidati[pul]].u < u) dole = pul + 1; else nahore = pul; }
     const pred = (dole + kandidati.length - 1) % kandidati.length, za = dole % kandidati.length;
     const nejblizsi = Math.cos(sloty[kandidati[pred]].u - smer) > Math.cos(sloty[kandidati[za]].u - smer) ? pred : za;
     const cislo = kandidati.splice(nejblizsi, 1)[0];
     if (obsazena.has(cislo) || r >= (odmitnuta.get(cislo) ?? Infinity)) continue;
     const slot = sloty[cislo], bod = { x: slot.r * Math.cos(slot.u), y: slot.r * Math.sin(slot.u), z: 0, r };
     if (umisti(bod)) { body[index] = bod; obsazena.add(cislo); nalezen = true; break; }
     odmitnuta.set(cislo, r);
    }
    if (nalezen) break;
    continue;
   }
   let dole = 0, nahore = sloty.length;
   while (dole < nahore) { const pul = (dole + nahore) >>> 1; if (sloty[pul].u < u) dole = pul + 1; else nahore = pul; }
   const pred = (dole + sloty.length - 1) % sloty.length, za = dole % sloty.length;
   const preferovany = Math.cos(sloty[pred].u - smer) > Math.cos(sloty[za].u - smer) ? pred : za;
   let nalezen = false;
   for (let krok = 0; krok < sloty.length; krok++) {
    const cislo = (preferovany + Math.ceil(krok / 2) * (krok % 2 ? 1 : -1) + sloty.length) % sloty.length;
    const slot = sloty[cislo];
    if (poz && Math.cos(slot.u - smer) < Math.cos(Math.PI / 7.2)) continue;
    const hladin = poz ? Math.max(1, Math.floor(slot.r * 0.4 / 28)) : 1;
    for (let hladina = 0; hladina < hladin; hladina++) {
     const dz = Math.ceil(hladina / 2) * (hladina % 2 ? 1 : -1), zSlot = poz ? Math.round(z / 28) + dz : 0;
     const klic = cislo * 10000 + zSlot + 5000;
     if (obsazena.has(klic) || r >= (odmitnuta.get(klic) ?? Infinity)) continue;
     const bod = { x: slot.r * Math.cos(slot.u), y: slot.r * Math.sin(slot.u), z: zSlot * 28, r };
     if (umisti(bod)) { body[index] = bod; obsazena.add(klic); nalezen = true; break; }
     odmitnuta.set(klic, r);
    }
    if (nalezen) break;
   }
   if (nalezen) break;
  }
 }
 return body;
}

export function rozlozTagy2d(tags: readonly TagMapy[], x: ArrayLike<number>, y: ArrayLike<number>, nasobek = 1, rezerva = 0): BodTagu[] {
 return rozlozTagy(tags, x, y, nasobek, rezerva);
}
export function rozlozTagy3d(tags: readonly TagMapy[], poz: ArrayLike<number>): BodTagu[] {
 const x = Array.from({ length: poz.length / 3 }, (_, i) => poz[i * 3]);
 const y = x.map((_, i) => poz[i * 3 + 1]);
 return rozlozTagy(tags, x, y, 1, 0, poz);
}

export interface TagNaPlatne { key?: string; index: number; x: number; y: number; r: number; name: string; velky: boolean }
interface MetalickyLak { sprity: Map<string, HTMLCanvasElement>; vytvorPlatno(dokument: Document): HTMLCanvasElement }
function metalickySprit(dokument: Document, polomer: number, klicTagu: string, metal: MetalickyLak, meritkoZarizeni: number): HTMLCanvasElement {
 const cache = metal.sprity;
 // Plátno má přesně kreslenou velikost v pixelech zařízení: větší sprite se jen zmenšoval při každém drawImage (B10 k3: 5× pomalejší All tags).
 const velikost = Math.max(2, Math.ceil(polomer * 2 * meritkoZarizeni)), jiskri = polomer > 5;
 let seminko = 2166136261;
 for (let i = 0; i < klicTagu.length; i++) seminko = Math.imul(seminko ^ klicTagu.charCodeAt(i), 16777619) >>> 0;
 // Klíčů je nejvýš 11 + 52 × 4 = 219 < 256 (strop cache): průměr 6-10 px bez jisker a 11-36 px s jiskrami, obojí × DPR ≤ 2.
 // Při 64 vzorech cache ve 3D přiblížení s All tags přetékala (750 různých klíčů za snímek, 91 ms místo 6 ms).
 const vzor = seminko % 4, klic = `${velikost}:${jiskri ? vzor : -1}`;
 const ulozeny = cache.get(klic);
 if (ulozeny) return ulozeny;
 const platno = metal.vytvorPlatno(dokument); platno.width = platno.height = velikost;
 const c = platno.getContext('2d')!, r = velikost / 2;
 const lak = c.createRadialGradient(r * 0.65, r * 0.6, 0, r, r, r);
 lak.addColorStop(0, '#fc898f'); lak.addColorStop(0.42, '#ab2938'); lak.addColorStop(1, '#981823');
 c.fillStyle = lak; c.beginPath(); c.arc(r, r, r, 0, Math.PI * 2); c.fill();
 if (jiskri) {
  let stav = vzor + 1;
  const dalsi = () => { stav = (Math.imul(stav, 1664525) + 1013904223) >>> 0; return stav / 4294967296; };
  c.fillStyle = '#f16770';
  for (let i = 0; i < 3 + vzor % 4; i++) {
   const uhel = dalsi() * Math.PI * 2, odstup = Math.sqrt(dalsi()) * r * 0.72;
   // poloměr jiskry v pixelech zařízení odpovídá původní jiskře 0,7-1,2 px kreslené z dvojnásobného plátna
   c.beginPath(); c.arc(r + Math.cos(uhel) * odstup, r + Math.sin(uhel) * odstup, (0.35 + dalsi() * 0.25) * meritkoZarizeni, 0, Math.PI * 2); c.fill();
  }
 }
 if (cache.size >= 256) cache.delete(cache.keys().next().value!);
 cache.set(klic, platno); return platno;
}
export function kresliTagy(c: CanvasRenderingContext2D, body: TagNaPlatne[], cary: { a: number[]; b: number[] }[], barva: string, cas: number, zoom: number, rozpocet: number, svetlaBarva = barva, metal?: MetalickyLak): boolean {
 c.save(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.85; c.strokeStyle = barva; c.fillStyle = barva;
 const husty = cary.length > 200;
 c.lineWidth = husty ? 0.45 : 1.3;
 c.beginPath();
 for (const { a, b } of cary) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
 c.stroke();
 c.fillStyle = svetlaBarva;
 if (!husty) for (const { a, b } of cary) {
  const t = (cas / 2200) % 1;
  c.beginPath(); c.arc(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1.7, 0, Math.PI * 2); c.fill();
 }
 c.font = '12px sans-serif'; c.textBaseline = 'middle';
 const obsazene: number[][] = [];
 let pocet = 0;
 const dokument = c.canvas?.ownerDocument, lak = dokument && metal ? metal : undefined;
 // měřítko kontextu = DPR plátna (setTransform(dpr, …)); mock kontexty v testech getTransform nemají
 const meritkoZarizeni = lak && typeof c.getTransform === 'function' ? c.getTransform().a || 1 : 1;
 for (const bod of body) {
  // Plná tečka pod lakem zůstává: hlídá ji brána B9 (fills.includes(barva), harness-b9/harness.js) a stojí ~0,6 µs,
  // zatímco drawImage spritu stojí ~3 µs bez ohledu na jeho velikost (měření B10 k4, softwarové plátno Chromia).
  c.fillStyle = barva;
  c.beginPath(); c.arc(bod.x, bod.y, bod.r, 0, Math.PI * 2); c.fill();
  if (lak) c.drawImage(metalickySprit(dokument, bod.r, bod.key ?? bod.name, lak, meritkoZarizeni), bod.x - bod.r, bod.y - bod.r, bod.r * 2, bod.r * 2);
  if ((!bod.velky && zoom < 2) || pocet >= rozpocet) continue;
  const x = bod.x + bod.r + 5, w = c.measureText(bod.name).width;
  if (obsazene.some(o => x < o[2] && x + w > o[0] && bod.y - 8 < o[3] && bod.y + 8 > o[1])) continue;
  obsazene.push([x, bod.y - 8, x + w, bod.y + 8]); c.fillStyle = svetlaBarva; c.fillText(bod.name, x, bod.y); pocet++;
 }
 c.restore();
 return !husty && cary.length > 0;
}

export function vytvorKresleniTagu(vytvorPlatno: MetalickyLak['vytvorPlatno']) {
 const metal: MetalickyLak = { sprity: new Map(), vytvorPlatno };
 return (...args: Parameters<typeof kresliTagy>): boolean => { args[8] = metal; return kresliTagy(...args); };
}
