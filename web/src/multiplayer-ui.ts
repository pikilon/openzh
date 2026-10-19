// The launcher's side of online games (src/multiplayer.ts). The game's main
// menu Multiplayer button opens this dialog (generalsXLanNotify("open")): it
// creates a private game and shows its link and QR code, or joins one from a
// pasted link or a scanned QR code. Opening a link asks for the player's name
// once, then joins the host's game by itself. While in a game the dialog
// offers to play again in the same room or to leave it, and the top bar's link
// button copies the invite.

import qrcode from "qrcode-generator";
import { byId, closeDialog, openDialog } from "./shell";
import { scanQr } from "./qr-scan";
import {
  Lease,
  applyInvite,
  cleanName,
  hostRelay,
  inviteFromText,
  inviteLink,
  newInvite,
  readInvite,
  readPlayerName,
  writePlayerName,
  type Invite,
  type LanGlobals,
} from "./multiplayer";

type Mode = "host" | "join";

interface Session {
  invite: Invite;
  lease: Lease;
  link: string;
  action: Mode;
}

type Notify = { generalsXLanNotify?: (event: string) => void };

export function createMultiplayer(): void {
  const button = byId<HTMLButtonElement>("mp-button");
  const copyTop = byId<HTMLButtonElement>("mp-copy-link");
  const dialog = byId<HTMLDialogElement>("mp-dialog");
  const title = byId<HTMLElement>("mp-title");
  const lede = byId<HTMLElement>("mp-lede");
  const nameInput = byId<HTMLInputElement>("mp-name");
  const joinPanel = byId<HTMLElement>("mp-join");
  const paste = byId<HTMLInputElement>("mp-paste");
  const scan = byId<HTMLButtonElement>("mp-scan");
  const joinGo = byId<HTMLButtonElement>("mp-join-go");
  const video = byId<HTMLVideoElement>("mp-video");
  const invitePanel = byId<HTMLElement>("mp-invite");
  const qr = byId<HTMLElement>("mp-qr");
  const linkInput = byId<HTMLInputElement>("mp-link");
  const statusLine = byId<HTMLElement>("mp-status");
  const close = byId<HTMLButtonElement>("mp-close");
  const leave = byId<HTMLButtonElement>("mp-leave");
  const copy = byId<HTMLButtonElement>("mp-copy");
  const go = byId<HTMLButtonElement>("mp-go");

  let session: Session | null = null;
  let pendingJoin: Invite | null = readInvite(window.location.hash);
  let busy = false;
  let scanning: AbortController | null = null;

  function render(): void {
    const joining = session === null && pendingJoin !== null;
    title.textContent = joining ? "Join game" : "Online game";
    lede.textContent = session
      ? session.action === "host"
        ? "Send this link or QR code to the other players. Only people with the link can join."
        : `You are in ${session.invite.host || "the host"}'s room. The link brings more players in.`
      : joining
        ? `${pendingJoin?.host || "A player"} invited you to an online game.`
        : "Create a private online game and send its link to the other players, or join one with the link or QR code you got.";
    nameInput.disabled = session !== null;
    joinPanel.hidden = session !== null || joining;
    invitePanel.hidden = session === null;
    copy.hidden = session === null;
    leave.hidden = session === null;
    go.textContent = session ? "Play again" : joining ? "Join game" : "Create game";
    if (session) {
      linkInput.value = session.link;
      const code = qrcode(0, "M");
      code.addData(session.link);
      code.make();
      qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
    }
  }

  function show(): void {
    if (session === null && nameInput.value === "") nameInput.value = readPlayerName();
    render();
    openDialog(dialog);
    if (session === null) nameInput.focus();
  }

  function setStatus(text: string, error = false): void {
    statusLine.textContent = text;
    statusLine.classList.toggle("mp-error", error);
  }

  function stopScan(): void {
    scanning?.abort();
    scanning = null;
    video.hidden = true;
    scan.textContent = "Scan QR code";
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

  function playerName(): string | null {
    const name = cleanName(nameInput.value);
    nameInput.value = name;
    if (name !== "") return name;
    setStatus("Enter the name the other players will see.", true);
    if (!dialog.open) show();
    nameInput.focus();
    return null;
  }

  async function start(mode: Mode, invite: Invite | null, name: string): Promise<void> {
    if (busy) return;
    busy = true;
    go.disabled = true;
    joinGo.disabled = true;
    stopScan();
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
      paste.value = "";
      copyTop.hidden = false;
      if (mode === "join") {
        setStatus("");
        closeDialog(dialog);
      } else {
        setStatus("The game's options open as soon as the game is at its main menu.");
        show();
      }
    } catch (error) {
      lease.close();
      setStatus(`Could not ${mode === "host" ? "create" : "join"} the game: ${(error as Error).message}.`, true);
      if (!dialog.open) show();
    } finally {
      busy = false;
      go.disabled = false;
      joinGo.disabled = false;
    }
  }

  function joinFrom(text: string): void {
    const invite = inviteFromText(text);
    if (invite === null) {
      setStatus("That is not an OpenZH invite link.", true);
      return;
    }
    const name = playerName();
    if (name !== null) void start("join", invite, name);
  }

  function primary(): void {
    if (session) {
      // The same room again: the lease still holds this tab's address.
      applyInvite(session.invite, session.lease.ip, cleanName(nameInput.value) || readPlayerName(), session.action);
      setStatus(session.action === "host" ? "The game's options open from the main menu." : "Joining from the main menu.");
      closeDialog(dialog);
      return;
    }
    const name = playerName();
    if (name === null) return;
    if (pendingJoin) void start("join", pendingJoin, name);
    else void start("host", null, name);
  }

  function leaveRoom(): void {
    session?.lease.close();
    session = null;
    (globalThis as LanGlobals).generalsXLanAction = undefined;
    copyTop.hidden = true;
    if (window.location.hash !== "") history.replaceState(null, "", window.location.pathname + window.location.search);
    setStatus("You left the room.");
    render();
  }

  button.addEventListener("click", () => {
    setStatus("");
    show();
  });
  copyTop.addEventListener("click", () => {
    void copyLink();
  });
  copy.addEventListener("click", () => {
    void copyLink();
  });
  close.addEventListener("click", () => closeDialog(dialog));
  leave.addEventListener("click", leaveRoom);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener("close", stopScan);
  go.addEventListener("click", primary);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      primary();
    }
  });
  joinGo.addEventListener("click", () => joinFrom(paste.value));
  paste.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      joinFrom(paste.value);
    }
  });
  scan.addEventListener("click", () => {
    if (scanning) {
      stopScan();
      return;
    }
    const controller = new AbortController();
    scanning = controller;
    video.hidden = false;
    scan.textContent = "Stop camera";
    setStatus("Point the camera at the invite's QR code.");
    scanQr(video, controller.signal).then(
      (text) => {
        if (scanning !== controller) return;
        stopScan();
        if (text !== null) joinFrom(text);
      },
      (error: unknown) => {
        if (scanning !== controller) return;
        stopScan();
        setStatus(`The camera is not available: ${(error as Error).message}.`, true);
      },
    );
  });
  linkInput.addEventListener("focus", () => linkInput.select());

  // The engine's main menu Multiplayer button, and a guest who found no game.
  (globalThis as Notify).generalsXLanNotify = (event: string) => {
    if (event === "open") {
      setStatus("");
      show();
    } else if (event === "no-game") {
      setStatus("No game is open in this room: the host may have closed it or started it already.", true);
      show();
    }
  };

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
      show();
    } else {
      nameInput.value = name;
      void start("join", pendingJoin, name);
    }
  }

  beginJoin();
}
