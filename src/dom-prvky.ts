/** Vlastní okno listu zachovává popout a vytvoří odpojený prvek před původním append(). */
export function vytvorPrvek<K extends keyof HTMLElementTagNameMap>(dokument: Document, znacka: K): HTMLElementTagNameMap[K] {
  const okno = dokument.defaultView;
  if (typeof okno?.createEl === 'function') return okno.createEl(znacka);
  // Samostatné webové harnessy nemají rozšíření Obsidianu. Jejich standardní DOM smlouva není zastaralá.
  const standardniDom = dokument as { createElement<T extends keyof HTMLElementTagNameMap>(tag: T): HTMLElementTagNameMap[T] };
  const vytvorStandardni = standardniDom.createElement.bind(dokument);
  return vytvorStandardni(znacka);
}
