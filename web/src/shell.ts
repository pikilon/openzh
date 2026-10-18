// Small DOM helpers shared by the launcher shell (docs/briefs/159-launcher-shell.md):
// element lookup and native dialog control. The page uses showModal() for every
// dialog so the browser owns the top layer, Escape and the backdrop.

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element as T;
}

export function openDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}
