// Standalone deterministic TUI fixture; no Pi session, models, backend or live data.
import { KeybindingsManager, ProcessTerminal, TuiMainScreen, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { RunPicker, pickerRows } from "../src/picker.ts";
import { fixture } from "../tests/fixtures.ts";
const first = fixture(); first.tag = "sqlite-comparison"; first.query = "SQLite and PostgreSQL for local applications";
first.status = "done";
const second = fixture(); second.tag = "pdf-reading"; second.query = "Reliable evidence extraction from scientific PDFs"; second.decomposition = undefined;
second.status = "paused";
const tui = new TuiMainScreen(new ProcessTerminal());
const theme: any = { fg: (color: string, text: string) => `\x1b[${color === "accent" ? "96" : "90"}m${text}\x1b[0m`, bold: (text: string) => `\x1b[1m${text}\x1b[0m` };
const picker = new RunPicker(pickerRows({ runs: [first, second], issues: [] }), theme,
  new KeybindingsManager(TUI_KEYBINDINGS), () => { tui.stop(); process.exit(0); }, () => tui.requestRender());
tui.addChild(picker); tui.setFocus(picker); tui.start();
setTimeout(() => { tui.stop(); process.exit(0); }, 20_000);
