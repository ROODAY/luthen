// Entry point for the web app: wires the Seal / Verify / Open tabs and shows the version.
import { version } from "../../package.json";

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
