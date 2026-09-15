import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { assertRevisionSpendingApproval, revisionSpendingOffer, RevisionApprovalChangedError } from "../src/revision-approval.ts";
import { dashboardActionSchema } from "../src/dashboard-controls.ts";
import { randomUUID } from "node:crypto";
import { renderMain } from "../web/render.ts";

test("follow-up authorization binds the exact parent checkpoint and displayed ceiling", () => {
  const state = fixture(); state.status = "done"; state.report = "# Parent";
  const offer = revisionSpendingOffer(state);
  assert.equal(offer.budgetUsd, state.config.budgetUsd);
  assert.doesNotThrow(() => assertRevisionSpendingApproval(structuredClone(state), offer));
  for (const mutate of [
    (run: typeof state) => { run.config.budgetUsd = 25; },
    (run: typeof state) => { run.config.budgetUsd = null; },
    (run: typeof state) => { run.report += "\nChanged conclusion"; },
    (run: typeof state) => { run.model = "other/model"; },
    (run: typeof state) => { run.config.models = { draft: "other/model" }; },
    (run: typeof state) => { run.config.searchProvider = "kagi"; },
    (run: typeof state) => { run.tag = "another-parent"; },
    (run: typeof state) => { run.sources[0].url = "https://example.org/replaced-evidence"; },
    (run: typeof state) => { run.disclosure = { searchBlocked: true, exportBlocked: true }; },
  ]) {
    const changed = structuredClone(state); mutate(changed);
    assert.throws(() => assertRevisionSpendingApproval(changed, offer), RevisionApprovalChangedError);
  }
  assert.throws(() => assertRevisionSpendingApproval(state, { ...offer, budgetUsd: 1 }), RevisionApprovalChangedError);
  state.config.budgetUsd = null;
  const unlimited = revisionSpendingOffer(state); assert.equal(unlimited.budgetUsd, null);
  assert.doesNotThrow(() => assertRevisionSpendingApproval(state, unlimited));
  state.profile = "full"; assert.throws(() => revisionSpendingOffer(state), /read-only/);
});

test("the spending button displays the offered amount without rounding or concealing an unlimited budget", () => {
  for (const budgetUsd of [15, 15.123, null]) {
    const state = fixture(); state.status = "done"; state.report = "# Parent"; state.config.budgetUsd = budgetUsd;
    const spendingApproval = revisionSpendingOffer(state);
    const html = renderMain(state, true, undefined, { mode: "revise", spendingApproval });
    assert.ok(html.includes(budgetUsd === null ? "Start follow-up · No model ceiling" : `Start follow-up · $${budgetUsd} model ceiling`));
    assert.match(html, /Search fees are separate/);
    if (budgetUsd === null) assert.match(html, /unlimited model spending/);
    else assert.match(html, /In-flight calls may exceed the ceiling/);
    assert.ok(html.includes(spendingApproval.proposalId));
    assert.doesNotMatch(html, /Approve cost|Waiting for approval in Pi/);
  }
});

test("the browser cannot omit, weaken or embellish the spending authorization payload", () => {
  const state = fixture(); state.status = "done"; state.report = "# Parent";
  const action = { id: randomUUID(), kind: "revise", tag: state.tag, text: "Follow up" };
  assert.equal(dashboardActionSchema.safeParse(action).success, false);
  const offer = revisionSpendingOffer(state);
  assert.equal(dashboardActionSchema.safeParse({ ...action, spendingApproval: offer }).success, true);
  for (const spendingApproval of [null, true, { budgetUsd: 15 }, { ...offer, budgetUsd: -1 }, { ...offer, approved: true }]) {
    assert.equal(dashboardActionSchema.safeParse({ ...action, spendingApproval }).success, false);
  }
});
