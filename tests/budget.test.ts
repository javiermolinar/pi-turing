import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBudgetTopUp, budgetExhausted, budgetTopUpSummary, parseResumeOptions, proposeBudgetTopUp } from "../src/budget.ts";
import { stateSchema } from "../src/types.ts";
import { fixture } from "./fixtures.ts";

test("resume parsing supports explicit top-ups without conflating tags or project-config replacement", () => {
  assert.deepEqual(parseResumeOptions([]), { useProjectConfig: false });
  assert.deepEqual(parseResumeOptions(["run", "--add-budget", "15"]), { tag: "run", useProjectConfig: false, addBudget: 15 });
  assert.deepEqual(parseResumeOptions(["--add-budget=0.25", "run"]), { tag: "run", useProjectConfig: false, addBudget: 0.25 });
  assert.deepEqual(parseResumeOptions(["--use-project-config", "run"]), { tag: "run", useProjectConfig: true });
  for (const args of [["a", "b"], ["--force"], ["--add-budget"], ["--add-budget="], ["--add-budget", "run"],
    ["--add-budget", "15", "--add-budget=15"], ["--use-project-config", "--use-project-config"], ["--add-budget", "15", "--use-project-config"]]) assert.throws(() => parseResumeOptions(args));
  for (const amount of ["0", "-15", "NaN", "Infinity", "1e2", "0.001", "1000001", "15usd", "$15", "15.00x"]) assert.throws(() => parseResumeOptions(["--add-budget", amount]));
});
test("a top-up adds to the saved ceiling, not spent cost, and proposals are read-only", () => {
  const state = fixture(); state.status = "blocked"; state.cost = 15.015412; state.config.budgetUsd = 15;
  const original = structuredClone(state); const proposal = proposeBudgetTopUp(state, 15);
  assert.equal(proposal.newCeiling, 30); assert.deepEqual(state, original);
  assert.match(budgetTopUpSummary(proposal), /Already spent: \$15.02/);
  assert.match(budgetTopUpSummary(proposal), /New total ceiling: \$30.00/);
  assert.match(budgetTopUpSummary(proposal), /Remaining estimate: \$14.98/);
  assert.match(budgetTopUpSummary(proposal), /not skipped.*overshoot/);
  applyBudgetTopUp(state, proposal, "interactive");
  const expected = structuredClone(original); expected.config.budgetUsd = 30; expected.budgetAdjustments = state.budgetAdjustments;
  assert.deepEqual(state, expected, "Only ceiling and approval ledger may change; no spend/source/step/worker resets");
  assert.equal(state.budgetAdjustments!.length, 1);
  assert.equal(state.budgetAdjustments![0].spentAtApproval, 15.015412);
  assert.equal(state.budgetAdjustments![0].approval, "interactive");
  stateSchema.parse(state);
  assert.throws(() => applyBudgetTopUp(state, proposal, "interactive"), /changed since approval/);
  assert.equal(state.budgetAdjustments!.length, 1);
});
test("repeated explicit additions preserve cumulative approval history and never replenish automatically", () => {
  const state = fixture(); state.config.budgetUsd = 15; state.cost = 15.02;
  assert.equal(budgetExhausted(state), true);
  applyBudgetTopUp(state, proposeBudgetTopUp(state, 15), "explicit-flag");
  assert.equal(budgetExhausted(state), false);
  state.cost = 30.02;
  assert.equal(budgetExhausted(state), true); assert.equal(state.config.budgetUsd, 30);
  applyBudgetTopUp(state, proposeBudgetTopUp(state, 15), "explicit-flag");
  assert.equal(state.config.budgetUsd, 45); assert.equal(state.cost, 30.02);
  assert.deepEqual(state.budgetAdjustments!.map(a => [a.previousCeiling, a.newCeiling]), [[15, 30], [30, 45]]);
});
test("invalid, unlimited, completed and insufficient top-ups fail without mutation", () => {
  const state = fixture(); const before = structuredClone(state);
  for (const amount of [0, -1, NaN, Infinity, 0.001, 1000001]) assert.throws(() => proposeBudgetTopUp(state, amount));
  assert.deepEqual(state, before);
  state.config.budgetUsd = null; assert.equal(budgetExhausted(state), false); assert.throws(() => proposeBudgetTopUp(state, 15), /unlimited/);
  state.config.budgetUsd = 15; state.cost = 31;
  assert.throws(() => proposeBudgetTopUp(state, 15), /choose a larger/);
  for (const status of ["done", "aborted"] as const) { state.status = status; assert.throws(() => proposeBudgetTopUp(state, 50), /Cannot add budget/); }
});
test("changed spend, budget or run identity invalidates an approved proposal", () => {
  for (const change of [(s: ReturnType<typeof fixture>) => { s.cost++; }, (s: ReturnType<typeof fixture>) => { s.config.budgetUsd = 20; }, (s: ReturnType<typeof fixture>) => { s.tag = "different-run"; }]) {
    const state = fixture(); const proposal = proposeBudgetTopUp(state, 15); change(state); const before = structuredClone(state);
    assert.throws(() => applyBudgetTopUp(state, proposal, "interactive"), /changed since approval/);
    assert.deepEqual(state, before);
  }
});
