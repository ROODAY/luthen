// Verify and Open panels: gather the encrypted file and shares from dropped files, zips and typed
// words, show progress, then check the shares (Verify) or decrypt and download the contents (Open).
import {
  EMPTY_INPUTS,
  addFiles,
  addProblems,
  addShareText,
  outputName,
  type InputFile,
  type InputState,
  type Problem,
} from "../core/inputs";
import { decodeMnemonic } from "../core/slip39/mnemonic";
import { open, progress, progressLine, verify } from "../core/vault";
import {
  LARGE_FILE,
  download,
  droppedFiles,
  el,
  errorText,
  largeFileNote,
  nextPaint,
  pickedFiles,
  type Picked,
} from "./dom";
import { message, say } from "./seal-view";

const problemItem = (p: Problem) => el("li", {}, el("strong", {}, p.name), `: ${p.message}`);

export function mountRecover(root: HTMLElement, mode: "verify" | "open"): void {
  let state: InputState = EMPTY_INPUTS;
  // Problems from the most recent add; older ones stay listed until Clear.
  let latest = 0;
  let typedCount = 0;
  let busy = false;

  const id = `${mode}-files`;
  const picker = el("input", { type: "file", id, multiple: "" });
  const folderPicker = el("input", { type: "file", webkitdirectory: "", multiple: "" });
  folderPicker.hidden = true;
  const folderBtn = el("button", { type: "button" }, "Choose folder");
  const drop = el(
    "div",
    { class: "dropzone" },
    el("label", { for: id }, "Encrypted file and shares"),
    picker,
    el("div", { class: "row" }, folderBtn, folderPicker),
    el(
      "p",
      { class: "hint" },
      "or drop them here: the .age file, share.txt files, holder folders, or the zips Luthen made.",
    ),
  );

  const typed = el("textarea", {
    id: `${mode}-typed`,
    rows: "4",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
  });
  const addBtn = el("button", { type: "button" }, "Add share");
  const typedBox = el(
    "div",
    { class: "field" },
    el("label", { for: `${mode}-typed` }, el("span", {}, "Or type a share")),
    el("p", { class: "hint" }, "Its words in order, a numbered list, or the word numbers."),
    typed,
    el("div", { class: "row" }, addBtn),
  );

  const cipherInfo = el("p", { class: "loaded" });
  const largeWarn = largeFileNote(mode === "verify" ? "verifying" : "opening");
  const shareList = el("ul", { class: "inputs" });
  const progressInfo = el("p", { class: "progress" });
  const newProblems = el("ul", { class: "problems", "aria-live": "polite" });
  const oldProblems = el("ul", { class: "problems earlier" });
  const oldBox = el("details", {}, el("summary", {}, "Earlier problems"), oldProblems);

  const action = el("button", { type: "button", class: "primary" }, mode === "verify" ? "Verify" : "Open");
  const clearBtn = el("button", { type: "button" }, "Clear");
  const status = message("status");

  root.append(
    drop,
    typedBox,
    el("h2", {}, "Loaded"),
    cipherInfo,
    largeWarn,
    shareList,
    progressInfo,
    newProblems,
    oldBox,
    el("div", { class: "row actions" }, action, clearBtn),
    status,
  );

  function render(): void {
    cipherInfo.textContent = state.ciphertext ? `Encrypted file: ${state.ciphertext.name}` : "No encrypted file yet";
    largeWarn.hidden = !state.ciphertext || state.ciphertext.bytes.length <= LARGE_FILE;
    shareList.replaceChildren(
      ...state.shares.map((s) => {
        const share = decodeMnemonic(s.mnemonic);
        return el("li", {}, `${s.source}: group ${share.groupIndex + 1}, share ${share.memberIndex + 1}`);
      }),
    );
    const p = state.shares.length ? progress(state.shares.map((s) => s.mnemonic)) : undefined;
    say(progressInfo, p && progressLine(p));
    newProblems.replaceChildren(...state.problems.slice(latest).map(problemItem));
    newProblems.hidden = state.problems.length === latest;
    oldProblems.replaceChildren(...state.problems.slice(0, latest).map(problemItem));
    oldBox.hidden = latest === 0;

    drop.classList.toggle("disabled", busy);
    for (const c of [picker, folderPicker, folderBtn, typed, addBtn, clearBtn]) c.disabled = busy;
    const ready = !!state.ciphertext && (mode === "verify" ? !!p : !!p?.complete);
    action.disabled = busy || !ready;
  }

  /** Swaps in a new input state; returns whether that step added problems. */
  function apply(next: InputState): boolean {
    latest = state.problems.length;
    state = next;
    say(status, undefined);
    return state.problems.length > latest;
  }

  function fail(e: unknown): void {
    status.classList.add("error");
    say(status, errorText(e));
  }

  /** Reads and adds files; one that cannot be read (e.g. a folder where folder drops are unsupported) becomes a Problem. */
  async function addPicked(pending: Picked[] | Promise<Picked[]>): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    try {
      const picked = await pending;
      if (!picked.length) return;
      const reads = await Promise.allSettled(picked.map((p) => p.read()));
      const files: InputFile[] = [];
      const unread: Problem[] = [];
      reads.forEach((r, i) => {
        const name = picked[i]!.name;
        if (r.status === "fulfilled") files.push({ name, bytes: r.value });
        else unread.push({ name, message: "could not read file" });
      });
      apply(addProblems(addFiles(state, files), unread));
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      render();
    }
  }

  function addTyped(): void {
    if (busy || !typed.value.trim()) return;
    try {
      typedCount++;
      if (!apply(addShareText(state, typed.value, `Typed share ${typedCount}`))) typed.value = "";
    } catch (e) {
      fail(e);
    }
    render();
  }

  async function run(): Promise<void> {
    const { ciphertext, shares } = state;
    if (busy || !ciphertext || !shares.length) return;
    const mnemonics = shares.map((s) => s.mnemonic);
    busy = true;
    render();
    status.classList.remove("error");
    say(status, "Working…");
    await nextPaint();
    try {
      if (mode === "verify") {
        const result = await verify(ciphertext.bytes, mnemonics);
        const n = mnemonics.length;
        const line = `${n} share${n === 1 ? "" : "s"} valid · set ${result.identifier} · ${progressLine(result)}`;
        say(status, result.complete ? `${line}\nunlocks ${ciphertext.name}` : line);
      } else {
        const plaintext = await open(ciphertext.bytes, mnemonics);
        const name = outputName(ciphertext.name);
        try {
          download(plaintext, name);
        } finally {
          plaintext.fill(0);
        }
        say(status, `Saved ${name}.`);
      }
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      render();
    }
  }

  for (const input of [picker, folderPicker]) {
    input.addEventListener("change", async () => {
      const picked = pickedFiles(input.files);
      input.value = "";
      await addPicked(picked);
    });
  }
  folderBtn.addEventListener("click", () => folderPicker.click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!busy) drop.classList.add("dragging");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
    if (busy) {
      status.classList.remove("error");
      say(status, "Busy — drop again when it finishes.");
      return;
    }
    // Folder contents must be gathered now: the browser empties dataTransfer once this handler returns.
    if (e.dataTransfer) void addPicked(droppedFiles(e.dataTransfer));
  });
  addBtn.addEventListener("click", addTyped);
  clearBtn.addEventListener("click", () => {
    if (busy) return;
    state = EMPTY_INPUTS;
    latest = 0;
    typedCount = 0;
    typed.value = "";
    say(status, undefined);
    render();
  });
  action.addEventListener("click", run);

  render();
}
