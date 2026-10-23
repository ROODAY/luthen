// Seal panel: pick a file, choose a scheme, bundle name and holder names, seal, then offer one zip
// per holder plus an all-in-one zip laid out like the CLI's --out directory.
import { version } from "../../package.json";
import { NAME_RE, bundleFiles, checkLabels, defaultLabels, summarizeScheme } from "../core/bundle";
import { flat, totalShares, validateScheme, type Scheme } from "../core/scheme";
import { seal } from "../core/vault";
import { LARGE_FILE, el, errorText, largeFileNote, nextPaint, readFile } from "./dom";
import { field, formatSize, message, numberInput, resultsView, say } from "./seal-view";

const MAX_GROUPS = 16;
const NAME_MSG = "Name may only use letters, digits, '.', '_' and '-'";

type Parsed = { scheme: Scheme; flatThreshold?: number } | { error: string };

const whole = (input: HTMLInputElement) => (/^\d+$/.test(input.value.trim()) ? Number(input.value) : NaN);

export function mountSeal(root: HTMLElement): void {
  let file: File | undefined;
  let busy = false;
  // Counts setting changes, so a seal finishing after an edit does not offer outdated downloads.
  let edits = 0;

  // File
  const picker = el("input", { type: "file", id: "seal-file" });
  const fileInfo = el("p", { class: "hint" }, "No file chosen.");
  const largeWarn = largeFileNote("sealing");
  const drop = el(
    "div",
    { class: "dropzone" },
    el("label", { for: "seal-file" }, "File to seal"),
    picker,
    el("p", { class: "hint" }, "or drop a file here."),
  );

  // Scheme
  const flatRadio = el("input", { type: "radio", name: "seal-mode", value: "flat", checked: "" });
  const groupRadio = el("input", { type: "radio", name: "seal-mode", value: "groups" });
  const shares = numberInput(3, "Shares");
  const threshold = numberInput(2, "Shares needed");
  const flatBox = el("div", { class: "row" }, field("Shares", shares), field("Shares needed", threshold));
  const groupsNeeded = numberInput(2, "Groups needed");
  const groupRows: { need: HTMLInputElement; count: HTMLInputElement }[] = [];
  const groupList = el("ol", { class: "groups" });
  const addGroup = el("button", { type: "button" }, "Add group");
  const groupBox = el("div", {}, field("Groups needed", groupsNeeded), groupList, addGroup);
  groupBox.hidden = true;
  const schemeMsg = message();

  // Names
  const nameInput = el("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const nameMsg = message();
  const holderList = el("ol", { class: "holder-names" });
  const holdersMsg = message();
  const holderBox = el(
    "fieldset",
    {},
    el("legend", {}, "Holder names (optional)"),
    el("p", { class: "hint" }, "One name per share; leave blank to use the name shown."),
    holderList,
    holdersMsg,
  );
  let holderInputs: HTMLInputElement[] = [];

  const sealBtn = el("button", { type: "button", class: "primary" }, "Seal");
  const status = message("status");
  const results = el("div", { class: "results" });

  root.append(
    drop,
    fileInfo,
    largeWarn,
    el(
      "fieldset",
      {},
      el("legend", {}, "Who can open it"),
      el(
        "div",
        { class: "mode", role: "radiogroup", "aria-label": "Scheme" },
        el("label", {}, flatRadio, " Any M of N"),
        el("label", {}, groupRadio, " Groups"),
      ),
      flatBox,
      groupBox,
      schemeMsg,
    ),
    field("Bundle name", nameInput),
    nameMsg,
    holderBox,
    sealBtn,
    status,
    results,
  );

  function renderGroups(): void {
    groupList.replaceChildren(
      ...groupRows.map((g, i) => {
        const remove = el("button", { type: "button", "aria-label": `Remove group ${i + 1}` }, "Remove");
        remove.disabled = groupRows.length === 1;
        remove.addEventListener("click", () => {
          groupRows.splice(i, 1);
          renderGroups();
          edited();
        });
        g.need.setAttribute("aria-label", `Group ${i + 1}: shares needed`);
        g.count.setAttribute("aria-label", `Group ${i + 1}: shares`);
        return el("li", { class: "row" }, el("span", {}, `Group ${i + 1}`), g.need, el("span", {}, "of"), g.count, remove);
      }),
    );
    addGroup.disabled = groupRows.length >= MAX_GROUPS;
  }

  function pushGroup(need: number, count: number): void {
    groupRows.push({ need: numberInput(need, ""), count: numberInput(count, "") });
  }

  function parseScheme(): Parsed {
    let scheme: Scheme;
    let flatThreshold: number | undefined;
    if (flatRadio.checked) {
      const t = whole(threshold);
      const n = whole(shares);
      if (Number.isNaN(t) || Number.isNaN(n)) return { error: "Enter whole numbers for shares and shares needed." };
      scheme = flat(t, n);
      flatThreshold = t;
    } else {
      const g = whole(groupsNeeded);
      const groups = groupRows.map((r) => ({ threshold: whole(r.need), count: whole(r.count) }));
      if (Number.isNaN(g) || groups.some((x) => Number.isNaN(x.threshold) || Number.isNaN(x.count))) {
        return { error: "Enter whole numbers in every group field." };
      }
      scheme = { groupThreshold: g, groups };
    }
    try {
      validateScheme(scheme);
    } catch (e) {
      return { error: errorText(e) };
    }
    return { scheme, flatThreshold };
  }

  /** Rebuilds the holder name inputs when the default labels change, keeping what was typed by position. */
  function syncHolders(defaults: string[]): void {
    if (defaults.join("\n") === holderInputs.map((i) => i.placeholder).join("\n")) return;
    const typed = holderInputs.map((i) => i.value);
    holderInputs = defaults.map((d) =>
      el("input", { type: "text", placeholder: d, autocomplete: "off", spellcheck: "false", "aria-label": `Name for ${d}` }),
    );
    holderInputs.forEach((input, i) => {
      input.value = typed[i] ?? "";
      input.addEventListener("input", edited);
    });
    holderList.replaceChildren(...holderInputs.map((input) => el("li", {}, input)));
  }

  /** Re-validates the whole form; returns what Seal needs, or undefined if something is missing or wrong. */
  function update(): { scheme: Scheme; flatThreshold?: number; name: string; labels: string[] } | undefined {
    flatBox.hidden = !flatRadio.checked;
    groupBox.hidden = flatRadio.checked;

    const parsed = parseScheme();
    say(schemeMsg, "error" in parsed ? parsed.error : undefined);
    let labels: string[] | undefined;
    holderBox.hidden = "error" in parsed;
    if (!("error" in parsed)) {
      syncHolders(defaultLabels(parsed.scheme, flatRadio.checked));
      labels = holderInputs.map((input) => input.value || input.placeholder);
      const problem = checkLabels(labels, totalShares(parsed.scheme));
      say(holdersMsg, problem && `Names ${problem}`);
      if (problem) labels = undefined;
    }

    const name = nameInput.value;
    const nameProblem = !name ? (file ? "Enter a bundle name." : undefined) : NAME_RE.test(name) ? undefined : NAME_MSG;
    say(nameMsg, nameProblem);

    picker.disabled = busy;
    drop.classList.toggle("disabled", busy);
    const ready = file && !busy && !("error" in parsed) && labels && name && !nameProblem;
    sealBtn.disabled = !ready;
    return ready ? { ...parsed, name, labels: labels! } : undefined;
  }

  /** A setting changed: earlier downloads no longer match the form, so drop them. */
  function edited(): void {
    edits++;
    results.replaceChildren();
    update();
  }

  function choose(f: File): void {
    if (busy) return;
    file = f;
    fileInfo.textContent = `${f.name} · ${formatSize(f.size)}`;
    largeWarn.hidden = f.size <= LARGE_FILE;
    nameInput.value = f.name;
    results.replaceChildren();
    update();
  }

  async function doSeal(): Promise<void> {
    const form = update();
    if (!form || !file) return;
    const { scheme, flatThreshold, name, labels } = form;
    const source = file;
    const at = edits;
    busy = true;
    update();
    results.replaceChildren();
    status.classList.remove("error");
    say(status, "Sealing…");
    await nextPaint();
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = await readFile(source);
      const sealed = await seal(plaintext, scheme);
      if (edits !== at) {
        say(status, "The settings changed while sealing. Seal again.");
        return;
      }
      const created = new Date();
      const summary = summarizeScheme(scheme, flatThreshold);
      const files = bundleFiles({ sealed, labels, name, schemeSummary: summary, created, version });
      results.replaceChildren(...resultsView({ sealed, files, labels, name, summary, created }));
      say(status, undefined);
    } catch (e) {
      status.classList.add("error");
      say(status, errorText(e));
    } finally {
      plaintext?.fill(0);
      busy = false;
      update();
    }
  }

  picker.addEventListener("change", () => {
    const f = picker.files?.[0];
    if (f) choose(f);
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!busy) drop.classList.add("dragging");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
    if (busy) return;
    const dropped = e.dataTransfer?.files;
    if (dropped?.length !== 1) {
      fileInfo.textContent = "Drop exactly one file.";
      return;
    }
    picker.value = "";
    choose(dropped[0]!);
  });
  for (const input of [flatRadio, groupRadio]) input.addEventListener("change", edited);
  // Group rows come and go, so one delegated listener covers every number input.
  root.addEventListener("input", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === "number") edited();
  });
  nameInput.addEventListener("input", edited);
  addGroup.addEventListener("click", () => {
    pushGroup(2, 3);
    renderGroups();
    edited();
  });
  sealBtn.addEventListener("click", doSeal);

  pushGroup(1, 1);
  pushGroup(2, 3);
  renderGroups();
  update();
}
