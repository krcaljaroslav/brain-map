import { vytvorPrvek, vytvorSvg } from '../dom-prvky.ts';
// DOM mapy Mozek (B1b): totéž, co index.html webu, ale vytvořené uvnitř kontejneru bez globálních id. Jediné id je lokální
// a unikátní pro aria-controls; místo modulového čítače instancí (mozek-dom.js) ho tvoří náhodná přípona, takže modul nemá
// žádný stav. Prvky se vracejí v mapě pod stejnými klíči, jaké web čte přes getElementById.
import type { TextyMapy, TextyHistorie } from './texty-mapy.ts';

export type PrvkyMapy = Map<string, HTMLElement>;

export function postavDom(dokument: Document, kontejner: HTMLElement, t: TextyMapy, muzeObnovit = false, historie?: TextyHistorie): { koren: HTMLElement; prvky: PrvkyMapy } {
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
			...(historie ? [tlacitko('historie', '', { title: historie.historie, 'aria-label': historie.historie, 'aria-pressed': 'false', hidden: true })] : []),
		]),
		el('aside', { klic: 'nastaveni', class: 'nastaveni', id: idNastaveni, hidden: true }, [
			// Dostupnost 3D podle WebGL řídí jádro; přepínač musí zůstat viditelný i s vysvětlením nedostupnosti.
			el('div', { class: 'pole' }, [t.pohled, el('div', { class: 'radek prepinac-pohledu' }, [
				tlacitko('pohled-2d', '2D', { 'aria-pressed': 'true' }), tlacitko('pohled-3d', '3D', { 'aria-pressed': 'false' }),
			]), el('span', { klic: 'pohled-info', class: 'napoveda' })]),
			el('label', { class: 'prepinac' }, [el('input', { klic: 'zavislosti', type: 'checkbox' }), ` ${t.zavislosti} `, el('span', { klic: 'zavislosti-info', class: 'info' })]),
			el('div', { class: 'radek' }, [prepinac('tagLinks', t.tagLinks), prepinac('allTags', t.allTags)]),
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
		...(historie ? [el('output', { klic: 'historie-stitek', class: 'historie-stitek', hidden: true })] : []),
		el('p', { klic: 'stav', class: 'stav', role: 'status', text: t.nacitam }),
		el('section', { klic: 'panel', class: 'panel', hidden: true, 'aria-live': 'polite' }, [
			el('div', { class: 'panel-hlava' }, [el('h2', { klic: 'panel-nazev' }), tlacitko('panel-zavrit', '×', { class: 'tlacitko tlacitko-ikona', 'aria-label': t.zrusitVyber })]),
			el('p', { klic: 'panel-cesta', class: 'panel-cesta' }),
			el('p', { klic: 'panel-cisla', class: 'panel-cisla' }),
			el('ul', { klic: 'panel-menu', class: 'mozek-panel-menu', hidden: true, 'aria-label': t.souboru(2) }),
			el('div', { class: 'panel-akce' }, [tlacitko('panel-sbalit', t.sbalit), tlacitko('panel-obsidian', t.otevritPoznamku), tlacitko('panel-zrusit', t.zrusitVyber), tlacitko('panel-zpet', t.zpet, { hidden: true })]),
		]),
	]);
	if (historie && typeof dokument.createElementNS === 'function') {
	const svg = vytvorSvg(dokument, 'svg');
	for (const [klic, hodnota] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'aria-hidden': 'true' })) svg.setAttribute(klic, hodnota);
	const tah = vytvorSvg(dokument, 'path');
	tah.setAttribute('d', 'm4 20 13-13 3 3L7 23ZM14 10l3 3M5 2v6M2 5h6M19 1v4M17 3h4');
	svg.append(tah); prvky.get('historie')!.replaceChildren(svg);
	}
	kontejner.append(koren);
	return { koren, prvky };
}
