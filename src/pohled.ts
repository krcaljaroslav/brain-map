import { ItemView, Notice, Platform, TFile, type App, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { platnyStavPohledu, vytvorMapu, type InstanceMapy, type StavPohledu, type VolbyMapy } from './jadro/mapa.ts';
import type { DataMapy, Vazba } from './adapter.ts';
import type { ZaznamGeometrie } from './diagnostika.ts';
import { pripojProstorListu, type ProstorListu } from './prostor-listu.ts';
import { t, textyMapy } from './i18n.ts';

export const TYP_POHLEDU = 'brain-map';
const KLIC_SBALENE = 'mozek.sbalene';

/** Co pohled potřebuje od pluginu (ne třída pluginu: main.ts importuje pohled, kruh by se nehodil). */
export interface PluginProPohled {
  postavData(): DataMapy;
  /** Volby jádra pod klíči mozek.* z nastavení pluginu (sbalené cesty, které ve vaultu teď nejsou, plugin nepředá, ale neukládá). */
  hodnotyMapy(): Record<string, string>;
  /** Změna volby z UI mapy (uloz; null = zapomen) do nastavení pluginu a data.json; znaPohled = cesta je ve snímku dat, který mapa dostala. */
  zmenaZMapy(klic: string, hodnota: string | null, znaPohled?: (cesta: string) => boolean): void;
  /** Záznam geometrie listu pro Export diagnostiky ; bez něj pohled nic nezaznamenává. */
  readonly zaznamGeometrie?: ZaznamGeometrie;
}

/**
 * Otevře poznámku podle přesné cesty z mapy (ne URI). PC: vždy nový list (getLeaf('tab')), list mapy se nepřepíše.
 * Mobil (Platform.isMobile, WBS B3): bez nové záložky, přímo v listu mapy (listMapy = this.leaf pohledu), zpět na mapu vede
 * tlačítko Zpět Obsidianu (historie listu znovu otevře pohled a getState/setState vrátí pohled i výběr, P6). Ne getLeaf(false): ten vrací
 * aktivní navigovatelný list, ne nutně mapu . Bez listu mapy i mobil otevře nový list.
 */
export async function otevriPoznamku(app: App, cesta: string, listMapy: WorkspaceLeaf | null = null): Promise<boolean> {
  const soubor = app.vault.getAbstractFileByPath(cesta);
  if (!(soubor instanceof TFile)) {
    new Notice(t('souborChybi', { cesta }));
    return false;
  }
  if (Platform.isMobile && listMapy) await listMapy.openFile(soubor);
  else await app.workspace.getLeaf('tab').openFile(soubor);
  return true;
}

/** Událost resolved: nové vazby převede na indexy stromu, který jádro už zobrazuje; nové konce počkají na Obnovit. */
export function vazbyKeStejnemuStromu(stara: DataMapy, nova: DataMapy): Vazba[] | null {
  const platna = (mapa: DataMapy): boolean => !!mapa && Array.isArray(mapa.nodes) && Array.isArray(mapa.links)
    && mapa.nodes.every((uzel) => Array.isArray(uzel) && typeof uzel[4] === 'string')
    && new Set(mapa.nodes.map((uzel) => uzel[4])).size === mapa.nodes.length
    && mapa.links.every((vazba) => Array.isArray(vazba) && vazba.length === 2
      && vazba.every((index) => Number.isInteger(index) && index >= 0 && index < mapa.nodes.length));
  if (!platna(stara) || !platna(nova)) return null;
  const indexy = new Map(stara.nodes.map((uzel, index) => [uzel[4], index]));
  const prevedene: Vazba[] = [];
  for (const [a, b] of nova.links) {
    const zdroj = indexy.get(nova.nodes[a][4]), cil = indexy.get(nova.nodes[b][4]);
    if (zdroj !== undefined && cil !== undefined) prevedene.push([zdroj, cil]);
  }
  return prevedene;
}

export class MozekPohled extends ItemView {
  private mapa: InstanceMapy | null = null;
  private data: DataMapy | null = null;
  /** setState před onOpen (na pořadí volání hostitele se nespoléhá) a poslední stav jádra pro getState po onClose. */
  private stavKObnoveni: unknown = null;
  private stavPoZavreni: StavPohledu | null = null;
  /** Odpojení ResizeObserveru záznamu geometrie (posluchače odebere unload přes registerDomEvent). */
  private odpojGeometrii: (() => void) | null = null;
  /** Měření prostoru listu (P8: padding hostitele a překryv spodní lištou); posluchače odebere unload, pozorovatel onClose. */
  private prostor: ProstorListu | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: PluginProPohled) {
    super(leaf);
  }

  getViewType(): string {
    return TYP_POHLEDU;
  }

  getDisplayText(): string {
    return t('nazevPohledu');
  }

  getIcon(): string {
    return 'brain';
  }

  async onOpen(): Promise<void> {
    this.data = this.plugin.postavData();
    // před jádrem (P8): jeho pozorovatel vzniká dřív než pozorovatel jádra, takže kořen je natažený o padding hostitele, než ho jádro změří
    this.prostor = pripojProstorListu(this.contentEl, (cil, typ, fn, dalsi) => {
      this.registerDomEvent(cil as HTMLElement, typ as keyof HTMLElementEventMap, fn, dalsi);
    }, Platform.isMobile);
    this.mapa = vytvorMapu(this.contentEl, this.data, { ...this.volbyMapy(), stavPohledu: this.stavKObnoveni });
    this.stavKObnoveni = null;   // předaný jádru: čekající stav odtud drží jádro (stavPohledu)
    this.prostor.zmer();   // stav při otevření: pozorovatel contentEl hlásí až změnu
    // záznam geometrie pro Export diagnostiky : v paměti pluginu, při události nic nezapisuje
    this.odpojGeometrii = this.plugin.zaznamGeometrie?.pripoj(this.contentEl, (cil, typ, fn) => {
      this.registerDomEvent(cil as HTMLElement, typ as keyof HTMLElementEventMap, fn);
    }) ?? null;
    // drill bod 4: snímek vaultu při otevření + Obnovit; živá aktualizace stromu je F7
    this.addAction('refresh-cw', t('obnovit'), () => { this.obnov(); });
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.prestavVazby()));
    // skrytý list (jiná záložka, sbalený panel): nulovou plochu vidí jádro přes ResizeObserver, hostitel k tomu hlásí viditelnost listu
    this.registerEvent(this.app.workspace.on('layout-change', () => this.hlasViditelnost()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.hlasViditelnost()));
  }

  async onClose(): Promise<void> {
    this.stavPoZavreni = this.mapa?.stavPohledu() ?? this.stavPoZavreni;
    this.odpojGeometrii?.();
    this.odpojGeometrii = null;
    this.prostor?.odpoj();
    this.prostor = null;
    this.mapa?.destroy();
    this.mapa = null;
    this.data = null;
  }

  /**
   * Pohled a výběr do ViewState listu. Historii navigace listu (Zpět) i rozložení plochy nese ViewState.state, tedy getState;
   * setState dostává ViewStateResult, jehož `history` obsidian.d.ts popisuje jako záznam do historie navigace. Ephemeral state
   * do ViewState nepatří (jen samostatný argument setViewState a OpenViewState.eState), proto ne getEphemeralState.
   * Klíče nejsou volby mozek.*: jen pozice a cesta vybraného uzlu. Před onOpen vrací platný stav čekající ze setState (snímek
   * historie mezi setState a onOpen ho nesmí vyprázdnit, .
   */
  getState(): Record<string, unknown> {
    const stav = this.mapa?.stavPohledu() ?? platnyStavPohledu(this.stavKObnoveni) ?? this.stavPoZavreni;
    return { ...super.getState(), ...stav };
  }

  /** Návrat přes Zpět: nová instance pohledu dostane uložený stav; cesta, která v datech není, nechá úvodní pohled. */
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (this.mapa) { this.stavKObnoveni = null; this.mapa.obnovPohled(state); }
    else this.stavKObnoveni = state;
  }

  /** Po onClose je mapa null, takže pozdní událost resolved nic nekreslí. */
  prestavVazby(): void {
    if (!this.mapa || !this.data) return;
    const nova = this.plugin.postavData();
    const vazby = vazbyKeStejnemuStromu(this.data, nova);
    if (!vazby || JSON.stringify(vazby) === JSON.stringify(this.data.links)) return;
    this.data = { ...this.data, links: vazby };
    this.mapa.nastavVazby(vazby);
  }

  /**
   * Obnovit: data znovu z vaultu (vyloučené složky z nastavení) do stávající instance přes nastavData, žádná nová mapa;
   * volby a pohled drží instance. Sbalené cesty se předají znovu: uložená cesta, která při otevření ve vaultu nebyla (vault se ještě
   * indexoval), se po doplnění souborů sbalí. Neplatná data nechají mapu nad starými daty a ohlásí se. Vrací, zda proběhlo.
   */
  obnov(): boolean {
    if (!this.mapa) return false;
    const nova = this.plugin.postavData();
    try {
      this.mapa.nastavData(nova);
    } catch (chyba) {
      new Notice(`${t('obnovitSelhalo')}: ${String(chyba)}`);
      return false;
    }
    this.data = nova;
    this.mapa.nastavVolby({ [KLIC_SBALENE]: this.plugin.hodnotyMapy()[KLIC_SBALENE] });
    return true;
  }

  /** Změna v záložce nastavení: volby do stávající instance (nastavVolby hostiteli nic nehlásí, uloz se nevolá). */
  nastavVolbyMapy(hodnoty: Readonly<Record<string, string | null>>): void {
    this.mapa?.nastavVolby(hodnoty);
  }

  /** isShown: list připojený a bez display: none nad sebou. Při skrytí jádro zruší čekající snímek, časovač podržení a gesto. */
  hlasViditelnost(): void {
    this.mapa?.nastavViditelnost(this.containerEl.isShown());
  }

  /** Cesta je ve snímku dat, který mapa naposledy dostala (vznik, Obnovit), ne nutně ve vaultu teď. */
  private znaCestu(cesta: string): boolean {
    return this.data?.nodes.some((uzel) => uzel[4] === cesta) ?? false;
  }

  /** Volby jádra z nastavení pluginu (klíče mozek.*) a posluchače přes registerDomEvent, aby je uvolnil i unload pohledu, nejen destroy. */
  private volbyMapy(): VolbyMapy {
    return {
      hodnoty: this.plugin.hodnotyMapy(),
      obnov: () => { this.obnov(); },
      otevri: (cesta) => {
        void otevriPoznamku(this.app, cesta, this.leaf).catch((chyba: unknown) => new Notice(`${t('otevreniSelhalo')}: ${String(chyba)}`));
      },
      uloz: (klic, hodnota) => { this.plugin.zmenaZMapy(klic, hodnota, (cesta) => this.znaCestu(cesta)); },
      zapomen: (klic) => { this.plugin.zmenaZMapy(klic, null); },
      jeTelefon: () => Platform.isPhone,
      registruj: (cil, typ, posluchac, dalsi) => { this.registerDomEvent(cil as HTMLElement, typ as keyof HTMLElementEventMap, posluchac, dalsi); },
      texty: textyMapy(),
    };
  }
}
