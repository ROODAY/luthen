// Entry point for the web app: wires the Seal / Verify / Open tabs and shows the version.
import { version } from "../../package.json";
import { mountRecover } from "./recover";
import { mountSeal } from "./seal";

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

function select(tab: HTMLButtonElement) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")!)!.hidden = !on;
  }
}

for (const [i, tab] of tabs.entries()) {
  tab.addEventListener("click", () => select(tab));
  tab.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    select(next);
    next.focus();
  });
}

document.getElementById("version")!.textContent = `v${version}`;
mountSeal(document.getElementById("seal")!);
mountRecover(document.getElementById("verify")!, "verify");
mountRecover(document.getElementById("open")!, "open");

// A file dropped outside a drop zone would otherwise replace the page with the file.
const outsideDropZone = (e: DragEvent) => !(e.target instanceof Element && e.target.closest(".dropzone"));
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer && outsideDropZone(e)) e.dataTransfer.dropEffect = "none";
});
document.addEventListener("drop", (e) => e.preventDefault());
