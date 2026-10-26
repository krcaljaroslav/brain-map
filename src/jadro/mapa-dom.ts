import { vytvorPrvek } from '../dom-prvky.ts';
// DOM mapy Mozek (B1b): totéž, co index.html webu, ale vytvořené uvnitř kontejneru bez globálních id. Jediné id je lokální
// a unikátní pro aria-controls; místo modulového čítače instancí (mozek-dom.js) ho tvoří náhodná přípona, takže modul nemá
// žádný stav. Prvky se vracejí v mapě pod stejnými klíči, jaké web čte přes getElementById.
import type { TextyMapy } from './texty-mapy.ts';

export type PrvkyMapy = Map<string, HTMLElement>;

export function postavDom(dokument: Document, kontejner: HTMLElement, t: TextyMapy, muzeObnovit = false): { koren: HTMLElement; prvky: PrvkyMapy } {
	const prvky: PrvkyMapy = new Map();
	const el = (znacka: keyof HTMLElementTagNameMap, atributy: Record<string, unknown> = {}, deti: (HTMLElement | string)[] = []): HTMLElement => {
		const prvek = vytvorPrvek(dokument, znacka);
		for (const [jmeno, hodnota] of Object.entries(atributy)) {
			if (jmeno === 'klic') prvky.set(String(hodnota), prvek);
			else if (jmeno === 'text') prvek.textContent = String(hodnota);
			else if (jmeno === 'hidden') prvek.hidden = Boolean(hodnota);
			else if (jmeno === 'checked') (prvek as HTMLInputElement).checked = Boolean(hodnota);
			else prvek.setAttribute(jmeno, String(hodnota));
		}
		prvek.append(...deti);
		return prvek;
	};
	const idNastaveni = `mozek-nastaveni-${Math.random().toString(36).slice(2, 10)}`;
	const tlacitko = (klic: string, text: string, dalsi: Record<string, unknown> = {}) => el('button', { klic, class: 'tlacitko', type: 'button', text, ...dalsi });
	const prepinac = (klic: string, text: string, dalsi: Record<string, unknown> = {}, trida = 'prepinac') => el('label', { class: trida }, [el('input', { klic, type: 'checkbox', ...dalsi }), ` ${text}`]);

	const koren = el('div', { class: 'mozek-koren' }, [
		el('canvas', { klic: 'platno', class: 'mozek-platno', 'aria-label': t.popisMapy, role: 'img', tabindex: '0' }),
		el('canvas', { klic: 'platno3d', class: 'mozek-platno3d', 'aria-hidden': 'true' }),
		el('canvas', { klic: 'popisky3d', class: 'mozek-popisky3d', 'aria-label': t.popisMapy3d, role: 'img', tabindex: '0' }),
		el('header', { class: 'lista' }, [
			el('div', { class: 'hledani' }, [
				el('input', { klic: 'hledat', type: 'search', placeholder: t.hledat, autocomplete: 'off', spellcheck: 'false', 'aria-label': t.hledatPopis }),
				el('ul', { klic: 'vysledky', class: 'vysledky', hidden: true }),
			]),
			tlacitko('celek', t.celek, { title: t.celekTitulek }),
			tlacitko('nastaveni-tlacitko', t.nastaveni, { 'aria-expanded': 'false', 'aria-controls': idNastaveni }),
		]),
		el('aside', { klic: 'nastaveni', class: 'nastaveni', id: idNastaveni, hidden: true }, [
			// Dostupnost 3D podle WebGL řídí jádro; přepínač musí zůstat viditelný i s vysvětlením nedostupnosti.
			el('div', { class: 'pole' }, [t.pohled, el('div', { class: 'radek prepinac-pohledu' }, [
				tlacitko('pohled-2d', '2D', { 'aria-pressed': 'true' }), tlacitko('pohled-3d', '3D', { 'aria-pressed': 'false' }),
			]), el('span', { klic: 'pohled-info', class: 'napoveda' })]),
			el('label', { class: 'prepinac' }, [el('input', { klic: 'zavislosti', type: 'checkbox' }), ` ${t.zavislosti} `, el('span', { klic: 'zavislosti-info', class: 'info' })]),
			prepinac('ostatni', t.ostatni),
			prepinac('hloubka', t.hloubka, { checked: true }, 'prepinac jen-2d'),
			prepinac('krouzeni', t.krouzeni, { checked: true }, 'prepinac jen-3d'),
			el('div', { class: 'radek' }, [tlacitko('rozbalit-vse', t.rozbalitVse), tlacitko('sbalit-vse', t.sbalitVse)]),
			...(muzeObnovit ? [tlacitko('obnovit', t.obnovit, { title: t.obnovitTitulek })] : []),
			el('label', { class: 'pole' }, [t.paleta, el('select', { klic: 'paleta' }, t.palety.map((nazev, index) => el('option', { value: String(index), text: nazev })))]),
			el('p', { class: 'napoveda jen-2d', text: t.napoveda2d }),
			el('p', { class: 'napoveda jen-3d', text: t.napoveda3d }),
			el('span', { klic: 'meridlo', class: 'meridlo', title: t.meridloTitulek }),
		]),
		el('p', { klic: 'stav', class: 'stav', role: 'status', text: t.nacitam }),
		el('section', { klic: 'panel', class: 'panel', hidden: true, 'aria-live': 'polite' }, [
			el('div', { class: 'panel-hlava' }, [el('h2', { klic: 'panel-nazev' }), tlacitko('panel-zavrit', '×', { class: 'tlacitko tlacitko-ikona', 'aria-label': t.zrusitVyber })]),
			el('p', { klic: 'panel-cesta', class: 'panel-cesta' }),
			el('p', { klic: 'panel-cisla', class: 'panel-cisla' }),
			el('ul', { klic: 'panel-menu', class: 'mozek-panel-menu', hidden: true, 'aria-label': t.souboru(2) }),
			el('div', { class: 'panel-akce' }, [tlacitko('panel-sbalit', t.sbalit), tlacitko('panel-obsidian', t.otevritPoznamku), tlacitko('panel-zrusit', t.zrusitVyber), tlacitko('panel-zpet', t.zpet, { hidden: true })]),
		]),
	]);
	kontejner.append(koren);
	return { koren, prvky };
}
