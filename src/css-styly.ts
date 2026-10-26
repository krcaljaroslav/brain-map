/** Obsidian nabízí setCssStyles; samostatné browserové harnessy mají jen standardní DOM. */
export function setCssStyles(prvek: HTMLElement, styly: Partial<CSSStyleDeclaration>): void {
 if (typeof prvek.setCssStyles === 'function') {
  prvek.setCssStyles(styly);
  return;
 }
 Object.assign(prvek.style, styly);
}
