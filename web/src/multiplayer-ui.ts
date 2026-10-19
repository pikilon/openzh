// The launcher's side of online games (src/multiplayer.ts): the Multiplayer
// dialog creates a private game and shows its link and QR code; opening a link
// asks for the player's name once, then joins the host's game by itself. The
// top bar's link button copies the invite while the game runs.

import qrcode from "qrcode-generator";
import { byId, closeDialog, openDialog } from "./shell";
import {
  Lease,
  applyInvite,
  cleanName,
  hostRelay,
  inviteLink,
  newInvite,
  readInvite,
  readPlayerName,
  writePlayerName,
  type Invite,
} from "./multiplayer";

type Mode = "host" | "join";

interface Session {
  invite: Invite;
  lease: Lease;
  link: string;
  action: Mode;
}

export function createMultiplayer(): void {
  const button = byId<HTMLButtonElement>("mp-button");
  const copyTop = byId<HTMLButtonElement>("mp-copy-link");
  const dialog = byId<HTMLDialogElement>("mp-dialog");
  const title = byId<HTMLElement>("mp-title");
  const lede = byId<HTMLElement>("mp-lede");
  const nameInput = byId<HTMLInputElement>("mp-name");
  const invitePanel = byId<HTMLElement>("mp-invite");
  const qr = byId<HTMLElement>("mp-qr");
  const linkInput = byId<HTMLInputElement>("mp-link");
  const statusLine = byId<HTMLElement>("mp-status");
  const close = byId<HTMLButtonElement>("mp-close");
  const copy = byId<HTMLButtonElement>("mp-copy");
  const go = byId<HTMLButtonElement>("mp-go");

  let session: Session | null = null;
  let pendingJoin: Invite | null = readInvite(window.location.hash);
  let busy = false;

  function show(mode: Mode): void {
    const hosting = session !== null;
    const joining = mode === "join" && pendingJoin !== null && !hosting;
    title.textContent = joining ? "Join game" : "Online game";
    lede.textContent = hosting
      ? "Send this link or QR code to the other players. Only people with the link can join."
      : joining
        ? `${pendingJoin?.host || "A player"} invited you to an online game.`
        : "Create a private online game, then send its link to the other players.";
    nameInput.value = session ? nameInput.value : readPlayerName();
    nameInput.disabled = hosting;
    invitePanel.hidden = !hosting;
    copy.hidden = !hosting;
    go.hidden = hosting;
    go.textContent = joining ? "Join game" : "Create game";
    go.dataset.mode = joining ? "join" : "host";
    if (session) {
      linkInput.value = session.link;
      const code = qrcode(0, "M");
      code.addData(session.link);
      code.make();
      qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
    }
    openDialog(dialog);
    if (!hosting) nameInput.focus();
  }

  function setStatus(text: string, error = false): void {
    statusLine.textContent = text;
    statusLine.classList.toggle("mp-error", error);
  }

  async function copyLink(): Promise<void> {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.link);
    } catch {
      linkInput.select();
      document.execCommand("copy");
    }
    setStatus("Link copied.");
    copyTop.classList.add("copied");
    setTimeout(() => copyTop.classList.remove("copied"), 1500);
  }

  async function start(mode: Mode, invite: Invite | null, name: string): Promise<void> {
    if (busy) return;
    busy = true;
    go.disabled = true;
    setStatus(mode === "host" ? "Creating the game…" : "Connecting to the game…");
    const target = invite ?? newInvite(hostRelay(window.location), name);
    const lease = new Lease(target);
    try {
      const ip = await lease.open();
      session?.lease.close();
      session = { invite: target, lease, link: inviteLink(target, window.location.origin), action: mode };
      applyInvite(target, ip, name, mode);
      writePlayerName(name);
      pendingJoin = null;
      copyTop.hidden = false;
      if (mode === "join") {
        setStatus("");
        closeDialog(dialog);
      } else {
        setStatus("The game's options open as soon as the game is at its main menu.");
        show("host");
      }
    } catch (error) {
      lease.close();
      setStatus(`Could not ${mode === "host" ? "create" : "join"} the game: ${(error as Error).message}.`, true);
      if (!dialog.open) show(mode);
    } finally {
      busy = false;
      go.disabled = false;
    }
  }

  function submit(): void {
    const name = cleanName(nameInput.value);
    nameInput.value = name;
    if (name === "") {
      setStatus("Enter the name the other players will see.", true);
      nameInput.focus();
      return;
    }
    const mode = go.dataset.mode === "join" ? "join" : "host";
    void start(mode, mode === "join" ? pendingJoin : null, name);
  }

  button.addEventListener("click", () => {
    setStatus("");
    show(pendingJoin ? "join" : "host");
  });
  copyTop.addEventListener("click", () => {
    void copyLink();
  });
  copy.addEventListener("click", () => {
    void copyLink();
  });
  close.addEventListener("click", () => closeDialog(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  go.addEventListener("click", submit);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  linkInput.addEventListener("focus", () => linkInput.select());

  // A link opened later in this tab (pasted over the address) is a new invite.
  window.addEventListener("hashchange", () => {
    const invite = readInvite(window.location.hash);
    if (invite === null) return;
    pendingJoin = invite;
    beginJoin();
  });

  function beginJoin(): void {
    if (pendingJoin === null) return;
    const name = readPlayerName();
    if (name === "") {
      setStatus("");
      show("join");
    } else {
      void start("join", pendingJoin, name);
    }
  }

  beginJoin();
}
