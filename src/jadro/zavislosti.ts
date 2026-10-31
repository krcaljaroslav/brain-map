export type HustotaVazeb = 0 | 25 | 50 | 75 | 100;
export function konstantyVazeb() { return { MAX_KRIVEK_3D: 3000, KLID_KAMERY_MS: 200 }; }
export type ParVazby = [number, number];
export type PoziceVazby = { x: number; y: number; predKamerou?: boolean };
export type ZaberVazeb = { sirka: number; vyska: number };

export function nactiHustotu(hodnota: unknown): HustotaVazeb {
 if (hodnota === true || hodnota === '1') return 50;
 if (hodnota === false || hodnota === '0') return 0;
 if (hodnota === 0 || hodnota === 25 || hodnota === 50 || hodnota === 75 || hodnota === 100) return hodnota;
 if (hodnota === '25' || hodnota === '50' || hodnota === '75' || hodnota === '100') return Number(hodnota) as HustotaVazeb;
 return 0;
}

export function vZaberu(pozice: PoziceVazby | undefined, zaber: ZaberVazeb): boolean {
 return !!pozice && pozice.predKamerou !== false && pozice.x >= -zaber.sirka * 0.05 && pozice.x <= zaber.sirka * 1.05 && pozice.y >= -zaber.vyska * 0.05 && pozice.y <= zaber.vyska * 1.05;
}
export function seradPary(pary: ParVazby[]): ParVazby[] {
 return pary.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}
// Produkční cache už drží seřazené páry; čistý vstup testů může být neuspořádaný.
export function vyberVazby(pary: ParVazby[], pocet: number, pozice: (uzel: number) => PoziceVazby | undefined, zaber: ZaberVazeb, procento: HustotaVazeb, strop = Infinity, serazene = false) {
 if (procento === 0) return { krivky: [] as ParVazby[], celkem: 0 };
 const kandidati = (serazene ? pary : seradPary([...pary])).filter(([klic]) => vZaberu(pozice(Math.floor(klic / pocet)), zaber) || vZaberu(pozice(klic % pocet), zaber));
 const n = Math.ceil(procento / 100 * Math.min(strop, kandidati.length));
 return { krivky: kandidati.slice(0, n), celkem: kandidati.length };
}

export function vytvorCacheAgregace() {
 let predchoziPredci: Int32Array | null = null, predchoziOdhalene: Uint8Array | null = null;
 let pary: ParVazby[] = [], predchoziVazby: number[][] | null = null, prepocet = 0;
 return {
 get prepocet() { return prepocet; },
 nacti(vazby: number[][], predci: Int32Array, odhalene: Uint8Array): ParVazby[] {
  if (predchoziVazby === vazby && predchoziPredci?.length === predci.length && predci.every((p, i) => p === predchoziPredci![i]) && odhalene.length === predchoziOdhalene?.length && odhalene.every((p, i) => p === predchoziOdhalene![i])) return pary;
  const mapa = new Map<number, number>(), pocet = predci.length;
  for (const [a, b] of vazby) {
   if (!odhalene[a] || !odhalene[b]) continue;
   const va = predci[a], vb = predci[b];
   if (va === vb) continue;
   const klic = va < vb ? va * pocet + vb : vb * pocet + va;
   mapa.set(klic, (mapa.get(klic) || 0) + 1);
  }
  pary = seradPary([...mapa.entries()]);
  predchoziPredci = predci.slice(); predchoziOdhalene = odhalene.slice(); predchoziVazby = vazby; prepocet++;
  return pary;
 }
 };
}

// Mezi prahy alfa=0.5 se sémantické kotvy nemění ani při zoomu.
export function vytvorCachePrahu() {
 let podpis = '', struktura: unknown, prahy: number[] = [];
 return function interval(klic: string, identita: unknown, k: number, vetve: () => number[][]): number {
  if (podpis !== klic || struktura !== identita) {
   podpis = klic; struktura = identita;
   prahy = vetve().map(faktory => {
    if (faktory.some(f => f === 0)) return Infinity;
    let dolni = 0, horni = Math.max(...faktory.map(f => 1.45 / f));
    for (let krok = 0; krok < 52; krok++) {
     const stred = (dolni + horni) / 2;
     const alfa = faktory.reduce((a, f) => { const t = Math.max(0, Math.min(1, (f * stred - 0.55) / 0.9)); return a * t * t * (3 - 2 * t); }, 1);
     if (alfa > 0.5) horni = stred; else dolni = stred;
    }
    return horni;
   }).sort((a, b) => a - b);
  }
  let dolni = 0, horni = prahy.length;
  while (dolni < horni) { const stred = (dolni + horni) >>> 1; if (k >= prahy[stred]) dolni = stred + 1; else horni = stred; }
  return dolni;
 };
}

// Pořadí párů je pořadí agregace; výběr jen ukládá indexy do opakovaně použitého pole.
export function pripravPary2d(pary: ParVazby[], pocetUzlu: number) {
 const indexy = new Map<number, number>(), konce: number[] = [];
 const a = new Uint32Array(pary.length), b = new Uint32Array(pary.length), pocty = new Float64Array(pary.length);
 function konec(uzel: number) {
  let index = indexy.get(uzel);
  if (index === undefined) { index = konce.length; indexy.set(uzel, index); konce.push(uzel); }
  return index;
 }
 for (let i = 0; i < pary.length; i++) {
  a[i] = konec(Math.floor(pary[i][0] / pocetUzlu)); b[i] = konec(pary[i][0] % pocetUzlu); pocty[i] = pary[i][1];
 }
 const x = new Float64Array(konce.length), y = new Float64Array(konce.length), uvnitr = new Uint8Array(konce.length);
 const vybrane = new Uint32Array(pary.length);
 return {
  konce: Uint32Array.from(konce), a, b, pocty, x, y, vybrane, n: 0, celkem: 0,
  vyber(procento: HustotaVazeb, sirka: number, vyska: number) {
   this.celkem = 0;
   if (procento === 0) { this.n = 0; return; }
   for (let i = 0; i < x.length; i++) uvnitr[i] = x[i] >= -sirka * 0.05 && x[i] <= sirka * 1.05 && y[i] >= -vyska * 0.05 && y[i] <= vyska * 1.05 ? 1 : 0;
   for (let i = 0; i < a.length; i++) if (uvnitr[a[i]] || uvnitr[b[i]]) vybrane[this.celkem++] = i;
   this.n = Math.ceil(procento / 100 * this.celkem);
  }
 };
}
