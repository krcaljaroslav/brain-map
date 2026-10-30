import { diagnostikaVzniku } from './src/jadro/historie.ts';
import { getAllTags, apiVersion, Notice, Platform, Plugin, TFile, normalizePath } from 'obsidian';
import { postavMapu, type DataMapy } from './src/adapter.ts';
import { sestavDiagnostiku, ZaznamGeometrie, type ExportGeometrie } from './src/diagnostika.ts';
import { MozekPohled, TYP_POHLEDU } from './src/pohled.ts';
import { hodnotyMapy, KLIC_MAPY, MozekNastaveniTab, nactiNastaveni, vychoziNastaveni, zahodNeexistujiciSbalene, zapisZMapy, type NastaveniMozku } from './src/settings.ts';
import { t } from './src/i18n.ts';

export const SOUBOR_DIAGNOSTIKY = 'diagnostika.json';
/**
 * Poznámka v kořeni vaultu s geometrií listu (P7 k3): běžná poznámka, kterou přenese Sync. Přepíše se jen poznámka s označením
 * OZNACENI_GEOMETRIE ve frontmatteru (P7 k4); cizí soubor nebo složka stejného jména zůstane a geometrie jde pod první volný
 * název „Brain-Map-diagnostika 1.md", „… 2.md" atd.
 */
export const POZNAMKA_GEOMETRIE = 'Brain-Map-diagnostika.md';
export const OZNACENI_GEOMETRIE = 'brain-map-diagnostika';

/** Název poznámky geometrie pro n-tý pokus: 0 = POZNAMKA_GEOMETRIE, jinak „Brain-Map-diagnostika n.md". */
export function nazevPoznamkyGeometrie(n: number): string {
  return n === 0 ? POZNAMKA_GEOMETRIE : POZNAMKA_GEOMETRIE.replace(/\.md$/, ` ${n}.md`);
}

const RADEK_OZNACENI = new RegExp(`^${OZNACENI_GEOMETRIE}:\\s*true\\s*$`);

/** Poznámku zapsal plugin: začíná frontmatterem s řádkem `brain-map-diagnostika: true`. */
export function jeOznacenaPoznamkaGeometrie(text: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return !!frontmatter && frontmatter[1].split(/\r?\n/).some((radek) => RADEK_OZNACENI.test(radek));
}

/** Pohled „Mozek" (ItemView) s jádrem mapy, příkazy, ikona v liště, export diagnostiky a nastavení v data.json (B2). */
export default class MozekMapaPlugin extends Plugin {
  nastaveni: NastaveniMozku = vychoziNastaveni();
  /** Záznam geometrie listu mapy (P7 k2): kruhový buffer v paměti, napojí ho pohled, zapíše jen příkaz Export diagnostiky. */
  readonly zaznamGeometrie = new ZaznamGeometrie();
  /** Vyloučené složky, se kterými mapy naposledy stavěly data; promitniVyloucene přestaví mapy jen při rozdílu. */
  private promitnuteVyloucene = '';
  /** Jediná fronta zápisů data.json pro mapu i záložku: další saveData začne až po dokončení (i selhání) předchozího. */
  private frontaZapisu: Promise<void> = Promise.resolve();
  /** Fronta exportů diagnostiky (P7 k4): další export začne až po doběhnutí předchozího, takže dva rychle po sobě nevytvoří tutéž poznámku. */
  private frontaExportu: Promise<unknown> = Promise.resolve();

  async onload(): Promise<void> {
    this.nastaveni = nactiNastaveni(await this.loadData());
    this.promitnuteVyloucene = JSON.stringify([this.nastaveni.vylouceneSlozky, this.nastaveni.vylouceneTagy]);
    this.registerView(TYP_POHLEDU, (leaf) => new MozekPohled(leaf, this));
    this.addRibbonIcon('brain', t('nazevPohledu'), () => { void this.otevriMapu(); });
    this.addCommand({
      id: 'otevrit-mapu',
      name: t('prikazOtevrit'),
      callback: () => { void this.otevriMapu(); },
    });
    this.addCommand({
      id: 'obnovit-mapu',
      name: t('prikazObnovit'),
      callback: () => { if (this.obnovMapy() === 0) new Notice(t('obnovitNicNeniOtevreno')); },
    });
    this.addCommand({
      id: 'export-diagnostiky',
      name: t('prikazExport'),
      callback: () => {
        void this.exportujDiagnostiku().catch((chyba: unknown) => new Notice(`${t('exportSelhal')}: ${String(chyba)}`));
      },
    });
    this.addSettingTab(new MozekNastaveniTab(this.app, this));
  }

  onunload(): void {}

  /** Data mapy z vaultu; vyloučené složky z nastavení odfiltruje adaptér před sestavením stromu. */
  postavData(): DataMapy {
    return postavMapu(this.app.vault, this.app.metadataCache.resolvedLinks, this.nastaveni.vylouceneSlozky, true, (soubor) => {
      const skutecnySoubor = this.app.vault.getAbstractFileByPath(soubor.path);
      const cache = skutecnySoubor instanceof TFile ? this.app.metadataCache.getFileCache(skutecnySoubor) : null;
      return cache ? getAllTags(cache) : null;
    }, this.nastaveni.vylouceneTagy, (soubor) => {
      const skutecnySoubor = this.app.vault.getAbstractFileByPath(soubor.path);
      return skutecnySoubor instanceof TFile ? this.app.metadataCache.getFileCache(skutecnySoubor)?.frontmatter ?? null : null;
    });
  }

  /**
   * Volby pro mapu (vznik, Obnovit, záložka): sbalené cesty, které ve vaultu teď nejsou, se mapě jen nepředají. Uložené nastavení
   * se nemění: otevření ani událost resolved nedokazují, že vault je úplný (indexace, synchronizace na mobilu ještě stahuje),
   * a chybné zahození by tiše smazalo stav uživatele, kdežto ponechaná cesta stojí pár bajtů. Definitivní čištění proto není.
   */
  hodnotyMapy(): Record<string, string> {
    const predane = { ...this.nastaveni, sbalene: [...this.nastaveni.sbalene] };
    zahodNeexistujiciSbalene(predane, (cesta) => this.existujeVeVaultu(cesta));
    return hodnotyMapy(predane);
  }

  private existujeVeVaultu(cesta: string): boolean {
    return this.app.vault.getAbstractFileByPath(cesta) !== null;
  }

  /**
   * Změna z UI mapy (volby.uloz / zapomen) → nastavení → data.json. Mapa může sbalit či rozbalit jen cesty ze svého snímku dat;
   * uložené sbalené cesty, které pohled ve snímku neznal (vault se ještě indexoval), proto její seznam doplní, aby se po doplnění
   * souborů znovu sbalily. Podle vaultu se doplňovat nesmí: zastaralý snímek zná i cestu, která z vaultu mezitím zmizela, a její
   * rozbalení by se tím zahodilo. zapomen sbalení zruší celé.
   */
  zmenaZMapy(klic: string, hodnota: string | null, znaPohled: (cesta: string) => boolean = () => false): void {
    let nova = hodnota;
    if (klic === KLIC_MAPY.sbalene && hodnota !== null) {
      const neznamePohledu = this.nastaveni.sbalene.filter((cesta) => cesta !== '' && !znaPohled(cesta));
      try {
        const zMapy: unknown = JSON.parse(hodnota);
        if (Array.isArray(zMapy) && neznamePohledu.length) nova = JSON.stringify([...(zMapy as unknown[]), ...neznamePohledu]);
      } catch {
        // neplatný JSON odmítne zapisZMapy
      }
    }
    if (zapisZMapy(this.nastaveni, klic, nova)) void this.ulozNastaveni();
  }

  /** Změna ze záložky nastavení: uloží a (promitnout) pošle volby do otevřených map; vyloučené složky přestaví data. */
  async zmenNastaveni(zmeny: Partial<NastaveniMozku>, promitnout = true): Promise<void> {
    const pred = this.hodnotyMapy();
    this.nastaveni = nactiNastaveni({ ...this.nastaveni, ...zmeny });
    await this.ulozNastaveni();
    if (!promitnout) return;
    const hodnoty = this.hodnotyMapy();
    const zmenene = Object.fromEntries(Object.entries(hodnoty).filter(([klic, hodnota]) => pred[klic] !== hodnota));
    for (const pohled of this.otevrenePohledy()) pohled.nastavVolbyMapy(zmenene);
    this.promitniVyloucene();
  }

  /** Vyloučené složky do otevřených map přes nastavData (Obnovit), jen když se od posledního promítnutí změnily. */
  promitniVyloucene(): void {
    const klic = JSON.stringify([this.nastaveni.vylouceneSlozky, this.nastaveni.vylouceneTagy]);
    if (klic === this.promitnuteVyloucene) return;
    this.promitnuteVyloucene = klic;
    this.obnovMapy();
  }

  /** Obnovit ve všech otevřených pohledech (příkaz); vrací počet pohledů. */
  obnovMapy(): number {
    const pohledy = this.otevrenePohledy();
    for (const pohled of pohledy) pohled.obnov();
    return pohledy.length;
  }

  otevrenePohledy(): MozekPohled[] {
    return this.app.workspace.getLeavesOfType(TYP_POHLEDU).map((list) => list.view).filter((pohled): pohled is MozekPohled => pohled instanceof MozekPohled);
  }

  /**
   * Zařadí snímek nastavení do fronty zápisů. Pořadí zápisů je pořadí změn i po chybě zápisu (selhání se ohlásí a fronta jede dál),
   * takže v data.json skončí poslední změna; API Obsidianu pořadí souběžných saveData negarantuje. Promise doběhne s tímto zápisem.
   */
  ulozNastaveni(): Promise<void> {
    const snimek: NastaveniMozku = JSON.parse(JSON.stringify(this.nastaveni)) as NastaveniMozku;
    const zapis = this.frontaZapisu.then(() => this.saveData(snimek)).catch((chyba: unknown) => {
      new Notice(`${t('ulozeniSelhalo')}: ${String(chyba)}`);
    });
    this.frontaZapisu = zapis;
    return zapis;
  }

  /** Jeden pohled Mozek: existující list se jen ukáže, jinak vznikne nová záložka. */
  async otevriMapu(): Promise<void> {
    const { workspace } = this.app;
    const existujici = workspace.getLeavesOfType(TYP_POHLEDU)[0];
    const list = existujici ?? workspace.getLeaf('tab');
    if (!existujici) await list.setViewState({ type: TYP_POHLEDU, active: true });
    await workspace.revealLeaf(list);
  }

  /**
   * Zápis pluginu do vaultu mimo data.json: diagnostika.json ve složce pluginu (manifest.dir). Vrací zapsanou cestu. Pole geometrie
   * nese záznam geometrie listu mapy (události klávesnice, předci kořene) bez textu poznámek a cest; tatáž geometrie jde i do poznámky
   * POZNAMKA_GEOMETRIE (P7 k3). Exporty běží po jednom (frontaExportu); chyba jednoho frontu nezastaví.
   */
  exportujDiagnostiku(): Promise<string | null> {
    const export_ = this.frontaExportu.then(() => this.exportujTed(), () => this.exportujTed());
    this.frontaExportu = export_.catch(() => undefined);
    return export_;
  }

  /** Bez připojeného listu mapy (P8 a: první export z telefonu zapsal 0 událostí a „ted": null) jen Notice, nic se nezapíše, vrací null. */
  private async exportujTed(): Promise<string | null> {
    const slozkaPluginu = this.manifest.dir;
    if (!slozkaPluginu) throw new Error(t('manifestDirChybi'));
    if (!this.zaznamGeometrie.maMerenyList()) {
      new Notice(t('exportBezMapy'));
      return null;
    }
    const cesta = normalizePath(`${slozkaPluginu}/${SOUBOR_DIAGNOSTIKY}`);
    const diagnostika = sestavDiagnostiku(this.app.vault, this.app.metadataCache.resolvedLinks, apiVersion, Platform, this.nastaveni.vylouceneSlozky);
    const geometrie = this.zaznamGeometrie.export();
    diagnostika.geometrie = geometrie;
    const historie = this.postavData();
    if (historie.vznik) diagnostika.vznik = diagnostikaVzniku(historie.vznik, historie.nodes.map(uzel => uzel[2]));
    // Plugin configuration files are outside the indexed vault files, so use the Adapter API.
    await this.app.vault.adapter.write(cesta, JSON.stringify(diagnostika));
    const poznamka = await this.zapisPoznamkuGeometrie(geometrie);
    new Notice(t('diagnostikaZapsana', { cesta, poznamka }));
    return cesta;
  }

  /**
   * Geometrie listu mapy (a nic jiného: žádné cesty, uzly ani resolvedLinks) jako JSON v bloku kódu poznámky POZNAMKA_GEOMETRIE,
   * aby ji Sync přenesl jako běžnou poznámku. Zapíše pod první volný název (nazevPoznamkyGeometrie): neexistuje, nebo je to vlastní
   * označená poznámka, kterou přepíše; cizí soubor ani složku nemění. Vrací zapsanou cestu. Cyklus skončí: každý obsazený název je
   * jiný soubor vaultu.
   */
  private async zapisPoznamkuGeometrie(geometrie: ExportGeometrie): Promise<string> {
    // zpětný apostrof v hodnotě (třídy prvků) by ukončil blok kódu; \u0060 je v JSON tentýž znak
    const obsah = `---\n${OZNACENI_GEOMETRIE}: true\n---\n\`\`\`json\n${JSON.stringify(geometrie, null, 1).replace(/`/g, '\\u0060')}\n\`\`\`\n`;
    const { vault } = this.app;
    const ciziPoznamka = new Error('ciziPoznamka');
    for (let n = 0; ; n++) {
      const nazev = nazevPoznamkyGeometrie(n), soubor = vault.getAbstractFileByPath(nazev);
      if (soubor === null) {
        await vault.create(nazev, obsah);
        return nazev;
      }
      if (soubor instanceof TFile) {
        let zapsano = false;
        try {
          await vault.process(soubor, (text) => {
            // Vrácení stejného textu by i tak vyvolalo zápis do cizí poznámky.
            if (!jeOznacenaPoznamkaGeometrie(text)) throw ciziPoznamka;
            zapsano = true;
            return obsah;
          });
        } catch (chyba) {
          if (chyba !== ciziPoznamka) throw chyba;
        }
        if (zapsano) return nazev;
      }
    }
  }
}
