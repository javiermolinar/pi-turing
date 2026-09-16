import { Input, SelectList, truncateToWidth, type Component, type Focusable } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cleanTerminal, isReadOnlyRun, type RunState } from "./types.ts";
import type { Inventory } from "./store.ts";

export interface PickerRow { id: string; title: string; description: string; details: string[] }
export function pickerRows(inventory: Inventory, activeTag?: string): PickerRow[] {
  return [
    ...inventory.runs.map(state => ({ id: state.tag, title: cleanTerminal(state.decomposition?.title ?? state.query),
      description: `${state.status === "running" ? state.tag === activeTag ? "running here" : "saved running" : state.status} · ${cleanTerminal(state.createdAt.slice(0, 10))}`,
      details: [state.query, `Project: ${state.location?.projectPath ?? "Legacy / unknown"}`, `Run: ${state.tag}`,
        `Workspace: ${state.location?.workspacePath ?? "Missing identity; migrate before resume"}`,
        state.status === "running" && state.tag !== activeTag ? "This session does not own a runner. Saved running is not live activity." : "Opening this run starts no research."].map(cleanTerminal),
    })),
    ...inventory.issues.map(issue => ({ id: issue.tag, title: cleanTerminal(issue.tag), description: "Unavailable checkpoint",
      details: [cleanTerminal(issue.error), "No actions will start for an unreadable checkpoint."] })),
  ];
}
export type RunAction = "View" | "Export Markdown" | "Save report…" | "Resume" | "Revise" | "Steer" | "Pause" | "Cancel";
export function runActions(state: RunState, ownership: "session" | "external" | "saved", workspaceAvailable: boolean): RunAction[] {
  const actions: RunAction[] = state.report !== undefined ? ["View", "Export Markdown", "Save report…"] : ["View"];
  if (isReadOnlyRun(state)) return actions;
  if (ownership === "session") return [...actions, "Steer", "Pause", "Cancel"];
  if (ownership === "external" || !workspaceAvailable) return actions;
  if (state.status === "done" && state.report) actions.push("Revise");
  else if (!["done", "aborted"].includes(state.status)) actions.push("Resume");
  return actions;
}
type Keys = { matches(data: string, action: any): boolean };
/** Native Input + SelectList, without touching Pi's draft editor. */
export class RunPicker implements Component, Focusable {
  private input = new Input({ prompt: "Filter runs: ", placeholder: "question, project, or run ID" });
  private list!: SelectList;
  private visible: PickerRow[] = [];
  private selected = 0;
  get focused() { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }
  constructor(private rows: PickerRow[], private theme: Pick<Theme, "fg" | "bold">, private keys: Keys,
    private done: (id: string | null) => void, private redraw: () => void, private maxRows = 8) { this.rebuild(); }
  private rebuild() {
    const query = cleanTerminal(this.input.getValue()).toLowerCase();
    this.visible = [{ id: "_new", title: "New research", description: "Start light research with cost approval", details: ["Start a separate investigation. No files or integrations are attached implicitly."] },
      ...this.rows.filter(row => [row.title, row.id, ...row.details].join(" ").toLowerCase().includes(query))];
    this.selected = 0;
    this.list = new SelectList(this.visible.map(row => ({ value: row.id, label: row.title, description: row.description })), Math.max(1, this.maxRows), {
      selectedPrefix: text => this.theme.fg("accent", text), selectedText: text => this.theme.fg("accent", text),
      description: text => this.theme.fg("muted", text), scrollInfo: text => this.theme.fg("dim", text), noMatch: text => text,
    }, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 68 });
  }
  handleInput(data: string): void {
    if (this.keys.matches(data, "tui.select.cancel")) { this.done(null); return; }
    if (this.keys.matches(data, "tui.select.confirm")) { this.done(this.visible[this.selected].id); return; }
    const up = this.keys.matches(data, "tui.select.up"); const down = this.keys.matches(data, "tui.select.down");
    const pageUp = this.keys.matches(data, "tui.select.pageUp"); const pageDown = this.keys.matches(data, "tui.select.pageDown");
    if (up || down || pageUp || pageDown) {
      this.selected = Math.max(0, Math.min(this.visible.length - 1, this.selected + (up ? -1 : down ? 1 : pageUp ? -this.maxRows : this.maxRows)));
      this.list.setSelectedIndex(this.selected);
    } else {
      const before = this.input.getValue(); this.input.handleInput(data);
      if (this.input.getValue().length > 300) this.input.setValue(this.input.getValue().slice(0, 300));
      if (before !== this.input.getValue()) this.rebuild();
    }
    this.redraw();
  }
  invalidate(): void { this.input.invalidate(); this.list.invalidate(); }
  render(width: number): string[] {
    if (width < 1) return [""];
    return [this.theme.fg("accent", this.theme.bold("Turing · saved investigations")),
      ...this.input.render(width), "", ...this.list.render(width),
      ...(this.visible.length === 1 ? [this.theme.fg("muted", this.rows.length ? "No matching runs." : "No saved runs yet.")] : []),
      "", ...this.visible[this.selected].details.map(line => this.theme.fg("muted", line)), "",
      this.theme.fg("dim", "Type to filter · ↑↓ navigate · Enter actions · Esc close"),
    ].map(line => truncateToWidth(line, width));
  }
}
