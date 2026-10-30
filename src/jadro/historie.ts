import type { DataMapy, VznikUzlu } from '../adapter.ts';

export function konstantyHistorie() { return { zakladS: 15, logS: 15, zakladSouboru: 100, minS: 20, maxS: 60, nabehMs: 400, letMs: 700, intervalMs: 1000, podil: 0.75, okraj: 0.05, minObal: 0.1 } as const; }
export function delkaHistorie(n: number): number {
 const HISTORIE = konstantyHistorie();
 return Math.min(HISTORIE.maxS, Math.max(HISTORIE.minS, HISTORIE.zakladS + HISTORIE.logS * Math.log10(Math.max(1, n) / HISTORIE.zakladSouboru))) * 1000;
}
export function pripravHistorii(nodes: DataMapy['nodes'], vznik: readonly (VznikUzlu | null)[]) {
 const soubory = nodes.flatMap((uzel, i) => uzel[2] !== 0 && vznik[i] ? [i] : []);
 soubory.sort((a, b) => vznik[a]!.cas - vznik[b]!.cas || vznik[a]!.ctime - vznik[b]!.ctime || (nodes[a][4] < nodes[b][4] ? -1 : nodes[a][4] > nodes[b][4] ? 1 : 0));
 const poradi = new Float64Array(nodes.length).fill(Infinity);
 soubory.forEach((i, poradiSouboru) => { poradi[i] = poradiSouboru; });
 for (let i = nodes.length - 1; i > 0; i--) {
  const rodic = nodes[i][0]!;
  poradi[rodic] = Math.min(poradi[rodic], poradi[i]);
 }
 const trvani = delkaHistorie(soubory.length);
 return { soubory, poradi, trvani, vznik };
}
export type CasovaOsa = ReturnType<typeof pripravHistorii>;
export function odhaleno(osa: CasovaOsa, cas: number): number {
 return Math.min(osa.soubory.length, Math.max(1, Math.floor(Math.max(0, cas) / osa.trvani * Math.max(0, osa.soubory.length - 1)) + 1));
}
export function alfaVzniku(osa: CasovaOsa, i: number, cas: number, nabehMs = konstantyHistorie().nabehMs): number {
 const zacatek = osa.poradi[i] / Math.max(1, osa.soubory.length - 1) * osa.trvani;
 return cas < zacatek ? 0 : Math.min(1, (cas - zacatek) / nabehMs + 0.02);
}
export interface ObalHistorie { x0: number; y0: number; x1: number; y1: number }
export interface ZaberHistorie { x: number; y: number; k: number }
export function uOkrajeHistorie(obal: ObalHistorie, sirka: number, vyska: number): boolean {
 const HISTORIE = konstantyHistorie();
 return obal.x0 <= sirka * HISTORIE.okraj || obal.y0 <= vyska * HISTORIE.okraj || obal.x1 >= sirka * (1 - HISTORIE.okraj) || obal.y1 >= vyska * (1 - HISTORIE.okraj);
}
/** Obaly jsou promítnuté při měřítku Celku; výřez zůstává v jeho rámu. */
export function cilHistorie(vstup: { viditelny: ObalHistorie; cely: ObalHistorie; sirka: number; vyska: number; celek: ZaberHistorie; maximum: number; rucni: boolean; konec: boolean; spustit: boolean }): ZaberHistorie | null {
 const HISTORIE = konstantyHistorie();
 if (vstup.rucni) return null;
 if (vstup.konec) return { ...vstup.celek };
 if (!vstup.spustit) return null;
 const { viditelny, cely, sirka, vyska, celek } = vstup;
 const w = Math.max(viditelny.x1 - viditelny.x0, (cely.x1 - cely.x0) * HISTORIE.minObal, 1);
 const h = Math.max(viditelny.y1 - viditelny.y0, (cely.y1 - cely.y0) * HISTORIE.minObal, 1);
 const k = Math.max(celek.k, Math.min(vstup.maximum, celek.k * HISTORIE.podil * Math.min(sirka / w, vyska / h)));
 const pomer = k / celek.k;
 const posun = (stred: number, rozmer: number) => Math.max(rozmer * (1 - pomer), Math.min(0, rozmer / 2 - stred * pomer));
 return { k, x: celek.x * pomer + posun((viditelny.x0 + viditelny.x1) / 2, sirka), y: celek.y * pomer + posun((viditelny.y0 + viditelny.y1) / 2, vyska) };
}
export function diagnostikaVzniku(vznik: readonly (VznikUzlu | null)[], typy: readonly number[]) {
 const mesice: Record<string, number> = {}, dny: Record<string, number> = {}, zdroje = { frontmatter: 0, ctime: 0, mtime: 0 };
 let souboru = 0;
 vznik.forEach((zaznam, i) => {
  if (!zaznam || typy[i] === 0) return;
  souboru++;
  const den = new Date(zaznam.cas).toISOString().slice(0, 10), mesic = den.slice(0, 7);
  mesice[mesic] = (mesice[mesic] ?? 0) + 1; dny[den] = (dny[den] ?? 0) + 1; zdroje[zaznam.zdroj]++;
 });
 return { mesice: Object.fromEntries(Object.entries(mesice).sort()), zdroje, souboru, podilNejcastejsihoDne: souboru ? Math.max(...Object.values(dny)) / souboru : 0 };
}
