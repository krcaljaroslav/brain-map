/** Vlastní okno listu zachovává popout a vytvoří odpojený prvek před původním append(). */
export function vytvorPrvek<K extends keyof HTMLElementTagNameMap>(dokument: Document, znacka: K): HTMLElementTagNameMap[K] {
  const okno = dokument.defaultView;
  if (typeof okno?.createEl === 'function') return okno.createEl(znacka);
  // Samostatné webové harnessy nemají rozšíření Obsidianu. Jejich standardní DOM smlouva není zastaralá.
  const standardniDom = dokument as { createElement<T extends keyof HTMLElementTagNameMap>(tag: T): HTMLElementTagNameMap[T] };
  const vytvorStandardni = standardniDom.createElement.bind(dokument);
  return vytvorStandardni(znacka);
}

export function vytvorSvg<K extends keyof SVGElementTagNameMap>(dokument: Document, znacka: K): SVGElementTagNameMap[K] {
  const okno = dokument.defaultView;
  if (typeof okno?.createSvg === 'function') return okno.createSvg(znacka);
  const standardniDom = dokument as { createElementNS<T extends keyof SVGElementTagNameMap>(ns: string, tag: T): SVGElementTagNameMap[T] };
  const vytvorStandardni = standardniDom.createElementNS.bind(dokument);
  return vytvorStandardni('http://www.w3.org/2000/svg', znacka);
}
