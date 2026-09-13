import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { progressLines, activityAge } from "../src/progress.ts";
import { ResearchWidget } from "../src/widget.ts";
import { queueFeedback } from "../src/feedback.ts";
import { stateSchema } from "../src/types.ts";
import { fixture } from "./fixtures.ts";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("activity age ignores checkpoint heartbeats; only live runs animate and terminal controls are stripped", () => {
  const state = fixture();
  state.activity = { text: "Reading \x1b]52;clipboard\x07source", at: "2026-09-13T10:01:00Z" };
  state.updatedAt = "2026-09-13T10:03:00Z";
  const clock = Date.parse(state.updatedAt);
  assert.equal(activityAge(state, clock), "Last activity 2m 0s ago");
  assert.notEqual(progressLines(state, true, clock, 0)[0], progressLines(state, true, clock, 1)[0]);
  assert.deepEqual(progressLines(state, false, clock, 0), progressLines(state, false, clock, 1));
  assert.match(progressLines(state, false, clock)[0], /not live/);
  assert.match(progressLines(state, true, clock)[4], /Chat stays separate/);
  assert.doesNotMatch(progressLines(state, true, clock).join(""), /[\x00-\x1f\x7f-\x9f]/);
});

test("widget fits narrow/wide terminals, animates locally, stops on pause and disposal without touching editor", async () => {
  const state = fixture();
  state.activity = { text: "Reading 文献 🧪 ".repeat(30), at: new Date().toISOString() };
  let renders = 0;
  const widget = new ResearchWidget(() => renders++, { fg: (_color, text) => text });
  try {
    widget.update(state, true);
    for (const width of [0, 1, 12, 40, 80, 140]) assert.ok(widget.render(width).every(line => visibleWidth(line) <= width));
    const first = widget.render(80)[0];
    await wait(150);
    assert.notEqual(widget.render(80)[0], first);
    assert.ok(renders > 1);
    state.status = "paused"; widget.update(state, false);
    const paused = renders; await wait(150); assert.equal(renders, paused);
    state.status = "running"; widget.update(state, true);
    widget.dispose(); const stopped = renders;
    await wait(150); assert.equal(renders, stopped);
    assert.deepEqual(widget.render(80), []);
  } finally { widget.dispose(); }
});

test("feedback is bounded, explicit, and legacy checkpoints default to an empty queue", () => {
  const state = fixture();
  const old = structuredClone(state) as any; delete old.feedback;
  assert.deepEqual(stateSchema.parse(old).feedback, []);
  assert.throws(() => queueFeedback(state, "   "));
  assert.throws(() => queueFeedback(state, "x".repeat(4001)));
  for (let i = 0; i < 20; i++) assert.equal(queueFeedback(state, `  Requirement ${i}  `).id, i + 1);
  assert.equal(state.feedback[0].text, "Requirement 0");
  assert.throws(() => queueFeedback(state, "overflow"), /limit/);
  state.status = "done"; assert.throws(() => queueFeedback(state, "change"), /closed/);
});
