/**
 * Adaptér vaultu: ze seznamu souborů (vault.getFiles()) a resolvedLinks postaví
 * {nodes, links, stats} ve formátu data.json webu. Sémantika stromu je převzatá
 * se stejnými pravidly pro cesty a vazby:
 * položky složky řazené podle jména bez ohledu na velikost písmen, složky a soubory
 * promíchané; skryté a vyloučené složky pryč; list = soubor; složka zůstane, když
 * v podstromu leží jakýkoli soubor; váha složky = počet všech souborů v podstromu.
 * Typ 2 zahrne parametr ostatni; plugin předává všechny listy, jejich viditelnost řídí jádro.
 */

export const TYP_SLOZKA = 0;
export const TYP_POZNAMKA = 1;
export const TYP_OSTATNI = 2;

export type Uzel = [parent: number | null, name: string, type: typeof TYP_SLOZKA | typeof TYP_POZNAMKA | typeof TYP_OSTATNI, weight: number, path: string];
export type Vazba = [zdroj: number, cil: number];

export interface TagMapy { key: string; name: string; notes: number[] }
export type ZdrojTagu = (soubor: SouborVaultu) => readonly string[] | null;

export function klicTagu(tag: string): string { return tag.trim().replace(/^#/, '').toLowerCase(); }

export interface DataMapy {
  vault: string;
  fields: ['parent', 'name', 'type', 'weight', 'path'];
  nodes: Uzel[];
  links: Vazba[];
  tags?: TagMapy[];
  stats: { nodes: number; folders: number; files: number; other?: number; links: number };
}

/** Výřez Obsidian API, který adaptér potřebuje; umožňuje mock z disku i z pole cest. */
export interface SouborVaultu {
  path: string;
}

export interface VaultProAdapter {
  getName(): string;
  getFiles(): SouborVaultu[];
}

export type RozliseneVazby = Record<string, Record<string, number>>;

/** Stejná množina jako EXCLUDED_DIRS generátoru webu. */
export const VYCHOZI_VYLOUCENE_SLOZKY: readonly string[] = ['_templates', 'Clippings', 'node_modules', '__pycache__'];

interface Slozka {
  podslozky: Map<string, Slozka>;
  soubory: string[];
}

function novaSlozka(): Slozka {
  return { podslozky: new Map(), soubory: [] };
}

function jeSkryta(jmeno: string): boolean {
  return jmeno.startsWith('.');
}

function jeVyloucenaSlozka(jmeno: string, vyloucene: ReadonlySet<string>): boolean {
  return vyloucene.has(jmeno);
}

function jePoznamka(jmeno: string): boolean {
  return jmeno.toLowerCase().endsWith('.md');
}

function bezPriponyMd(jmeno: string): string {
  return jePoznamka(jmeno) ? jmeno.slice(0, -3) : jmeno;
}

/** Porovnání po kódových bodech jako Python `sorted`; JS `<` řadí po UTF-16 jednotkách a emoji by předběhlo znaky nad U+D800. */
function porovnejKodoveBody(a: string, b: string): number {
  let pozice = 0;
  while (pozice < a.length && pozice < b.length) {
    const kodA = a.codePointAt(pozice) as number;
    const kodB = b.codePointAt(pozice) as number;
    if (kodA !== kodB) return kodA - kodB;
    pozice += kodA > 0xffff ? 2 : 1;
  }
  return a.length - b.length;
}

/** Jako `sorted(entries, key=lambda e: e.name.lower())`; při shodě malých písmen rozhodne původní jméno (generátor tam nechá pořadí disku). */
function porovnejJmena(a: string, b: string): number {
  return porovnejKodoveBody(a.toLowerCase(), b.toLowerCase()) || porovnejKodoveBody(a, b);
}

/** Vyloučení s lomítkem (B2 nastavení) je cesta složky od kořene vaultu: platí pro ni a vše pod ní. Jméno bez lomítka nic takového nemá. */
function jePodVyloucenouCestou(cesta: string, vyloucene: ReadonlySet<string>): boolean {
  for (const vylouceni of vyloucene) if (vylouceni.includes('/') && cesta.startsWith(`${vylouceni}/`)) return true;
  return false;
}

/**
 * Cesta, kterou mapa nevidí: skrytá položka kdekoli, vyloučená složka (jméno) kdekoli nad souborem, nebo soubor pod vyloučenou
 * cestou složky. Stejné síto pro uzly i pro vazby. Výchozí seznam obsahuje jen jména, takže se chová jako generátor webu.
 */
export function jeCestaMimoMapu(cesta: string, vyloucene: ReadonlySet<string>): boolean {
  const segmenty = cesta.split('/');
  const slozkyCesty = segmenty.slice(0, -1);
  return segmenty.some(jeSkryta) || slozkyCesty.some((jmeno) => jeVyloucenaSlozka(jmeno, vyloucene)) || jePodVyloucenouCestou(cesta, vyloucene);
}

function zaradSoubory(cesty: string[], vyloucene: ReadonlySet<string>): Slozka {
  const koren = novaSlozka();
  for (const cesta of cesty) {
    if (jeCestaMimoMapu(cesta, vyloucene)) continue;
    const segmenty = cesta.split('/');
    const slozkyCesty = segmenty.slice(0, -1);
    let slozka = koren;
    for (const jmeno of slozkyCesty) {
      let podslozka = slozka.podslozky.get(jmeno);
      if (!podslozka) {
        podslozka = novaSlozka();
        slozka.podslozky.set(jmeno, podslozka);
      }
      slozka = podslozka;
    }
    slozka.soubory.push(segmenty[segmenty.length - 1]);
  }
  return koren;
}

interface Polozka {
  jmeno: string;
  podslozka: Slozka | null;
}

function serazenePolozky(slozka: Slozka): Polozka[] {
  const polozky: Polozka[] = [];
  for (const [jmeno, podslozka] of slozka.podslozky) polozky.push({ jmeno, podslozka });
  for (const jmeno of slozka.soubory) polozky.push({ jmeno, podslozka: null });
  return polozky.sort((a, b) => porovnejJmena(a.jmeno, b.jmeno));
}

/** Preorder průchod jako `_walk`: vrací počet souborů v podstromu a zapíše ho jako váhu složky. */
function projdiSlozku(slozka: Slozka, indexSlozky: number, cestaSlozky: string, uzly: Uzel[], indexSouboru: Map<string, number>, ostatni: boolean): number {
  let pocetSouboru = 0;
  for (const polozka of serazenePolozky(slozka)) {
    const cesta = cestaSlozky ? `${cestaSlozky}/${polozka.jmeno}` : polozka.jmeno;
    if (polozka.podslozka) {
      const indexPodslozky = uzly.length;
      uzly.push([indexSlozky, polozka.jmeno, TYP_SLOZKA, 0, cesta]);
      const pocetVPodslozce = projdiSlozku(polozka.podslozka, indexPodslozky, cesta, uzly, indexSouboru, ostatni);
      if (pocetVPodslozce === 0) {
        uzly.length = indexPodslozky;
        continue;
      }
      pocetSouboru += pocetVPodslozce;
      continue;
    }
    pocetSouboru += 1;
    if (jePoznamka(polozka.jmeno) || ostatni) {
      indexSouboru.set(cesta, uzly.length);
      uzly.push([indexSlozky, bezPriponyMd(polozka.jmeno), jePoznamka(polozka.jmeno) ? TYP_POZNAMKA : TYP_OSTATNI, 1, cesta]);
    }
  }
  uzly[indexSlozky][3] = pocetSouboru;
  return pocetSouboru;
}

/** ResolvedLinks již obsahuje přesné cílové cesty, včetně přípony. Rozlišení wikilinků (i ./ a ../) patří Obsidianu. */
function sestavVazby(resolvedLinks: RozliseneVazby, indexSouboru: Map<string, number>, pocetUzlu: number): Vazba[] {
  const klice = new Set<number>();
  for (const [zdrojCesta, cile] of Object.entries(resolvedLinks)) {
    const zdroj = indexSouboru.get(zdrojCesta);
    if (zdroj === undefined || !jePoznamka(zdrojCesta)) continue;
    for (const cilCesta of Object.keys(cile)) {
      const cil = indexSouboru.get(cilCesta);
      if (cil === undefined || cil === zdroj) continue;
      klice.add(zdroj * pocetUzlu + cil);
    }
  }
  return [...klice].sort((a, b) => a - b).map((klic) => [Math.floor(klic / pocetUzlu), klic % pocetUzlu]);
}

export function postavMapu(vault: VaultProAdapter, resolvedLinks: RozliseneVazby, vylouceneSlozky: readonly string[] = VYCHOZI_VYLOUCENE_SLOZKY, ostatni = false, zdrojTagu?: ZdrojTagu, vylouceneTagy: readonly string[] = []): DataMapy {
  const vyloucene = new Set(vylouceneSlozky);
  const koren = zaradSoubory(vault.getFiles().map((soubor) => soubor.path), vyloucene);
  const uzly: Uzel[] = [[null, vault.getName() || 'vault', TYP_SLOZKA, 0, '']];
  const indexSouboru = new Map<string, number>();
  projdiSlozku(koren, 0, '', uzly, indexSouboru, ostatni);
  const vazby = sestavVazby(resolvedLinks, indexSouboru, uzly.length);
  return {
    vault: uzly[0][1],
    fields: ['parent', 'name', 'type', 'weight', 'path'],
    nodes: uzly,
    links: vazby,
    ...(zdrojTagu ? { tags: sestavTagy(vault.getFiles(), indexSouboru, zdrojTagu, vylouceneTagy) } : {}),
    stats: {
      nodes: uzly.length,
      folders: uzly.length - indexSouboru.size,
      files: uzly.filter((uzel) => uzel[2] === TYP_POZNAMKA).length,
      ...(ostatni ? { other: uzly.filter((uzel) => uzel[2] === TYP_OSTATNI).length } : {}),
      links: vazby.length,
    },
  };
}

function sestavTagy(soubory: SouborVaultu[], indexy: Map<string, number>, zdroj: ZdrojTagu, vyloucene: readonly string[]): TagMapy[] {
  const zakazane = new Set(vyloucene.map(klicTagu));
  const tagy = new Map<string, { notes: Set<number>; zapisy: Map<string, number> }>();
  for (const soubor of soubory) {
    const index = indexy.get(soubor.path);
    if (index === undefined || !jePoznamka(soubor.path)) continue;
    const zapisySouboru = new Set(zdroj(soubor) ?? []);
    for (const zapis of zapisySouboru) {
      const key = klicTagu(zapis);
      if (!key || zakazane.has(key)) continue;
      const tag = tagy.get(key) ?? { notes: new Set<number>(), zapisy: new Map<string, number>() };
      tag.notes.add(index);
      const name = '#' + zapis.trim().replace(/^#/, '');
      tag.zapisy.set(name, (tag.zapisy.get(name) ?? 0) + 1);
      tagy.set(key, tag);
    }
  }
  return [...tagy].sort(([a], [b]) => porovnejJmena(a, b)).map(([key, tag]) => ({
    key, name: [...tag.zapisy].sort((a, b) => b[1] - a[1] || porovnejJmena(a[0], b[0]))[0][0], notes: [...tag.notes].sort((a, b) => a - b),
  }));
}
