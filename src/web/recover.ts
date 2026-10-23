// Verify and Open panels: gather the encrypted file and shares from dropped files, zips and typed
// words, show progress, then check the shares (Verify) or decrypt and download the contents (Open).
import { EMPTY_INPUTS, addFiles, addShareText, outputName, type InputState, type Problem } from "../core/inputs";
import { decodeMnemonic } from "../core/slip39/mnemonic";
import { open, progress, progressLine, verify } from "../core/vault";
import { download, el, errorText, nextPaint, readFile } from "./dom";
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
  const drop = el(
    "div",
    { class: "dropzone" },
    el("label", { for: id }, "Encrypted file and shares"),
    picker,
    el("p", { class: "hint" }, "or drop them here: the .age file, share.txt files, or the zips Luthen made."),
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
    shareList,
    progressInfo,
    newProblems,
    oldBox,
    el("div", { class: "row actions" }, action, clearBtn),
    status,
  );

  function render(): void {
    cipherInfo.textContent = state.ciphertext ? `Encrypted file: ${state.ciphertext.name}` : "No encrypted file yet";
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
    for (const c of [picker, typed, addBtn, clearBtn]) c.disabled = busy;
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

  async function addDropped(files: FileList | null | undefined): Promise<void> {
    if (busy || !files?.length) return;
    busy = true;
    render();
    try {
      const read = await Promise.all([...files].map(async (f) => ({ name: f.name, bytes: await readFile(f) })));
      apply(addFiles(state, read));
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

  picker.addEventListener("change", async () => {
    await addDropped(picker.files);
    picker.value = "";
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!busy) drop.classList.add("dragging");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
    void addDropped(e.dataTransfer?.files);
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
