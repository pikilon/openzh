// Games on a network without internet (src/lan.ts): no server at all. The
// host's tab is the relay; each guest connects with two QR codes. The host
// shows an offer (also a link, `#l=`), the guest scans it and shows an
// answer, the host scans that. Pasting the codes works too.

import qrcode from "qrcode-generator";
import { byId, closeDialog, openDialog } from "./shell";
import { scanQr } from "./qr-scan";
import { ANSWER_PREFIX, GuestAnswer, HostInvite, LanHub, answerFromText, channelConnect, offerFromText, offerLink, type Connect } from "./lan";
import { Lease, applyLan, cleanName, readPlayerName, writePlayerName, type LanGlobals } from "./multiplayer";

type Role = "host" | "join";

interface LanSession {
  role: Role;
  connect: Connect;
  lease: Lease;
  hub?: LanHub;
  guest?: GuestAnswer;
  players: number;
}

export interface LanDialog {
  /** True while this tab hosts or is in a network game. */
  active(): boolean;
  show(): void;
  /** A host's offer from a link (`#l=`). */
  joinOffer(code: string): void;
}

export function createLanDialog(): LanDialog {
  const dialog = byId<HTMLDialogElement>("lan-dialog");
  const lede = byId<HTMLElement>("lan-lede");
  const nameRow = byId<HTMLElement>("lan-name-row");
  const nameInput = byId<HTMLInputElement>("lan-name");
  const start = byId<HTMLElement>("lan-start");
  const hostButton = byId<HTMLButtonElement>("lan-host");
  const joinButton = byId<HTMLButtonElement>("lan-join");
  const codePanel = byId<HTMLElement>("lan-code");
  const qr = byId<HTMLElement>("lan-qr");
  const codeText = byId<HTMLInputElement>("lan-code-text");
  const copy = byId<HTMLButtonElement>("lan-copy");
  const readPanel = byId<HTMLElement>("lan-read");
  const readLabel = byId<HTMLElement>("lan-read-label");
  const paste = byId<HTMLInputElement>("lan-paste");
  const scan = byId<HTMLButtonElement>("lan-scan");
  const readGo = byId<HTMLButtonElement>("lan-read-go");
  const video = byId<HTMLVideoElement>("lan-video");
  const statusLine = byId<HTMLElement>("lan-status");
  const close = byId<HTMLButtonElement>("lan-close");
  const leave = byId<HTMLButtonElement>("lan-leave");
  const again = byId<HTMLButtonElement>("lan-again");
  const add = byId<HTMLButtonElement>("lan-add");

  let session: LanSession | null = null;
  // What the code reader is waiting for: the host's offer or a guest's answer.
  let reading: "offer" | "answer" | null = null;
  let pendingInvite: HostInvite | null = null;
  let pendingGuest: GuestAnswer | null = null;
  let scanning: AbortController | null = null;

  function setStatus(text: string, error = false): void {
    statusLine.textContent = text;
    statusLine.classList.toggle("mp-error", error);
  }

  function showCode(text: string | null): void {
    codePanel.hidden = text === null;
    if (text === null) return;
    codeText.value = text;
    const code = qrcode(0, "L");
    code.addData(text);
    code.make();
    qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }

  function showReader(what: "offer" | "answer" | null): void {
    reading = what;
    readPanel.hidden = what === null;
    paste.value = "";
    readLabel.textContent = what === "offer" ? "The host's code" : "The player's code";
    if (what === null) stopScan();
  }

  function render(): void {
    nameRow.hidden = session !== null;
    start.hidden = session !== null || reading !== null || pendingGuest !== null;
    const inGame = session !== null && pendingInvite === null;
    leave.hidden = session === null;
    again.hidden = !inGame;
    add.hidden = !(inGame && session?.role === "host");
    if (session === null && reading === null && pendingGuest === null) {
      lede.textContent = "No internet needed: one player hosts, the others connect to that player's tab over this network with two QR codes.";
      showCode(null);
    } else if (inGame) {
      lede.textContent =
        session?.role === "host"
          ? `${session.players === 1 ? "1 player" : `${session.players} players`} connected. The game's options are open on the host: add more players or start.`
          : "Connected to the host. The game's options open by themselves.";
      showCode(null);
    }
  }

  function playerName(): string | null {
    const name = cleanName(nameInput.value);
    nameInput.value = name;
    if (name !== "") return name;
    setStatus("Enter the name the other players will see.", true);
    nameInput.focus();
    return null;
  }

  function stopScan(): void {
    scanning?.abort();
    scanning = null;
    video.hidden = true;
    scan.textContent = "Scan QR code";
  }

  function leaveGame(): void {
    pendingInvite?.close();
    pendingInvite = null;
    pendingGuest?.close();
    pendingGuest = null;
    session?.lease.close();
    session?.guest?.close();
    session = null;
    const g = globalThis as LanGlobals;
    if (g.generalsXLanRelay === "webrtc:") {
      g.generalsXLanConnect = undefined;
      g.generalsXLanAction = undefined;
    }
    showReader(null);
    setStatus("You left the network game.");
    render();
  }

  async function host(): Promise<void> {
    const name = playerName();
    if (name === null) return;
    writePlayerName(name);
    const hub = new LanHub();
    const lease = new Lease(hub.connect, false);
    const ip = await lease.open();
    session = { role: "host", connect: hub.connect, lease, hub, players: 0 };
    applyLan(hub.connect, ip, name, "host");
    await addPlayer();
  }

  async function addPlayer(): Promise<void> {
    if (session?.hub === undefined) return;
    pendingInvite?.close();
    const invite = new HostInvite();
    pendingInvite = invite;
    setStatus("Preparing the code…");
    render();
    const code = await invite.create();
    if (pendingInvite !== invite) return;
    lede.textContent = "1. The player scans this code (or opens it as a link). 2. Scan the code the player's screen then shows.";
    showCode(offerLink(code, window.location.origin));
    showReader("answer");
    setStatus("");
    render();
  }

  async function acceptAnswer(answer: string): Promise<void> {
    const invite = pendingInvite;
    const hub = session?.hub;
    if (invite === null || hub === undefined || session === null) return;
    setStatus("Connecting…");
    try {
      const channel = await invite.accept(answer);
      hub.attach(channel);
      session.players += 1;
      pendingInvite = null;
      showReader(null);
      setStatus("The player is connected.");
      render();
    } catch (error) {
      setStatus(`Could not connect: ${(error as Error).message}.`, true);
    }
  }

  function startJoin(): void {
    showReader("offer");
    lede.textContent = "Scan the code on the host's screen, or paste it.";
    setStatus("");
    render();
  }

  async function answerOffer(offer: string): Promise<void> {
    const name = playerName();
    if (name === null) {
      // Ask for the name first, then come back to this offer.
      showReader("offer");
      paste.value = offerLink(offer, window.location.origin);
      render();
      return;
    }
    writePlayerName(name);
    leaveQuietly();
    const guest = new GuestAnswer();
    pendingGuest = guest;
    showReader(null);
    setStatus("Preparing your code…");
    render();
    try {
      const code = await guest.answer(offer);
      lede.textContent = "Show this code to the host, who scans it. The game opens as soon as the host has it.";
      showCode(ANSWER_PREFIX + code);
      setStatus("Waiting for the host…");
      render();
      const channel = await guest.connected();
      if (pendingGuest !== guest) return;
      const connect = channelConnect(channel);
      const lease = new Lease(connect, false);
      const ip = await lease.open();
      pendingGuest = null;
      session = { role: "join", connect, lease, guest, players: 0 };
      applyLan(connect, ip, name, "join");
      const ended = () => {
        if (session?.guest !== guest) return;
        leaveGame();
        setStatus("The host's tab is gone: the network game ended.", true);
        show();
      };
      channel.addEventListener("close", ended);
      guest.pc.addEventListener("connectionstatechange", () => {
        if (guest.pc.connectionState === "failed" || guest.pc.connectionState === "closed") ended();
      });
      setStatus("");
      render();
      closeDialog(dialog);
    } catch (error) {
      if (pendingGuest === guest) {
        pendingGuest = null;
        guest.close();
      }
      setStatus(`Could not connect: ${(error as Error).message}.`, true);
      showCode(null);
      startJoin();
    }
  }

  /** A guest connecting elsewhere ends any network game this tab was in. */
  function leaveQuietly(): void {
    if (session === null && pendingGuest === null) return;
    const status = statusLine.textContent ?? "";
    leaveGame();
    setStatus(status);
  }

  function read(text: string): void {
    if (reading === "answer") {
      const answer = answerFromText(text);
      if (answer === null) setStatus("That is not a player's code.", true);
      else void acceptAnswer(answer);
    } else if (reading === "offer") {
      const offer = offerFromText(text);
      if (offer === null) setStatus("That is not a host's code.", true);
      else void answerOffer(offer);
    }
  }

  function show(): void {
    if (nameInput.value === "") nameInput.value = readPlayerName();
    render();
    openDialog(dialog);
  }

  hostButton.addEventListener("click", () => {
    hostButton.disabled = true;
    host()
      .catch((error: unknown) => setStatus(`Could not host: ${(error as Error).message}.`, true))
      .finally(() => (hostButton.disabled = false));
  });
  joinButton.addEventListener("click", startJoin);
  add.addEventListener("click", () => void addPlayer());
  again.addEventListener("click", () => {
    if (session === null) return;
    applyLan(session.connect, session.lease.ip, readPlayerName() || cleanName(nameInput.value), session.role);
    closeDialog(dialog);
  });
  leave.addEventListener("click", leaveGame);
  close.addEventListener("click", () => closeDialog(dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener("close", stopScan);
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(codeText.value).then(
      () => setStatus("Code copied."),
      () => {
        codeText.select();
        document.execCommand("copy");
      },
    );
  });
  codeText.addEventListener("focus", () => codeText.select());
  readGo.addEventListener("click", () => read(paste.value));
  paste.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      read(paste.value);
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
    scanQr(video, controller.signal).then(
      (text) => {
        if (scanning !== controller) return;
        stopScan();
        if (text !== null) read(text);
      },
      (error: unknown) => {
        if (scanning !== controller) return;
        stopScan();
        setStatus(`The camera is not available: ${(error as Error).message}.`, true);
      },
    );
  });

  return {
    active: () => session !== null || pendingGuest !== null || pendingInvite !== null,
    show,
    joinOffer(code: string) {
      if (nameInput.value === "") nameInput.value = readPlayerName();
      openDialog(dialog);
      void answerOffer(code);
    },
  };
}
