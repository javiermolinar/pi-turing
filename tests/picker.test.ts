import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { pickerRows, RunPicker, runActions } from "../src/picker.ts";
import { fixture } from "./fixtures.ts";

const theme: any = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
const keys = { matches: (data: string, action: string) => matchesKey(data, ({ "tui.select.up": "up", "tui.select.down": "down", "tui.select.confirm": "enter", "tui.select.cancel": "escape", "tui.select.pageUp": "pageUp", "tui.select.pageDown": "pageDown" } as any)[action]) };

test("picker filters metadata, preserves New research, navigates and cancels at narrow and wide widths", () => {
  const state = fixture(); state.query = "A unique question about SQLite";
  const rows = pickerRows({ runs: [state], issues: [{ tag: "broken", error: "Invalid checkpoint" }] });
  let selected: string | null | undefined;
  const picker = new RunPicker(rows, theme, keys, value => { selected = value; }, () => {});
  for (const width of [1, 20, 40, 80, 160]) for (const line of picker.render(width)) assert.ok(visibleWidth(line) <= width, line);
  picker.handleInput("SQLite");
  assert.match(picker.render(100).join("\n"), /New research/);
  picker.handleInput("\x1b[B"); picker.handleInput("\r"); assert.equal(selected, state.tag);
  picker.handleInput("\x1b"); assert.equal(selected, null);
  picker.focused = true; assert.equal(picker.focused, true);
  picker.invalidate();
});

test("empty history and hostile metadata render honestly without terminal controls", () => {
  const picker = new RunPicker([], theme, keys, () => {}, () => {});
  assert.match(picker.render(80).join("\n"), /No saved runs/);
  const state = fixture(); state.query = "\x1b]52;c;secret\x07"; state.decomposition = undefined;
  const rows = pickerRows({ runs: [state], issues: [] });
  assert.ok(!JSON.stringify(rows).includes("\\u001b"));
  assert.equal(rows[0].description.startsWith("saved running"), true);
});

test("actions distinguish session ownership, external writers, stale running and missing workspaces", () => {
  const state = fixture();
  assert.deepEqual(runActions(state, "session", true), ["View", "Steer", "Pause", "Cancel"]);
  assert.deepEqual(runActions(state, "external", true), ["View"]);
  assert.deepEqual(runActions(state, "saved", false), ["View"]);
  assert.deepEqual(runActions(state, "saved", true), ["View", "Resume"]);
  state.status = "done"; state.report = "Report";
  assert.deepEqual(runActions(state, "saved", true), ["View", "Revise"]);
  state.status = "aborted"; assert.deepEqual(runActions(state, "saved", true), ["View"]);
});
