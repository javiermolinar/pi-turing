import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { availableReaderIds } from "./capabilities.ts";
import type { ContextRequest, Disclosure } from "./context-types.ts";
import { budgetTopUpSummary, type BudgetTopUp } from "./budget.ts";
import { cleanTerminal, type Config, type RunState } from "./types.ts";

export async function contextRequest(ctx: ExtensionContext, project: string, initial: ContextRequest, signal: AbortSignal): Promise<ContextRequest | undefined> {
  if (!ctx.hasUI) return initial;
  const instructions = await ctx.ui.input("Additional sources & instructions (optional; no tools are granted by this text)", initial.instructions, { signal });
  if (instructions === undefined) return;
  const files = [...initial.files];
  while (files.length < 8 && await ctx.ui.confirm(files.length ? "Add another local context file?" : "Attach a local context file?", `Optional. Originating project: ${project}\nExisting selections: ${files.map(file => `${file.path} (${file.purpose})`).join(", ") || "none"}\nOnly selected text files are snapshotted; no directory scans or ambient project instructions.`, { signal })) {
    const path = await ctx.ui.input(`File path within ${project} (Enter blank to skip files; Escape cancels)`, undefined, { signal });
    if (path === undefined) return;
    if (!path.trim()) break;
    const purpose = await ctx.ui.select("How should this file be used?", ["Background (not citable)", "Local evidence (not independent external corroboration)"], { signal });
    if (!purpose) return;
    files.push({ path, purpose: purpose.startsWith("Background") ? "background" : "evidence" });
  }
  const capabilities = [...(initial.capabilities ?? [])];
  const registered = availableReaderIds();
  while (capabilities.length < 8 && registered.some(id => !capabilities.includes(id)) && await ctx.ui.confirm("Add an additional scoped source?", `Registered read-only adapters: ${registered.join(", ")}\nSelected: ${capabilities.join(", ") || "none"}. Skills and integrations are never inherited from ambient Pi tools.`, { signal })) {
    const id = await ctx.ui.select("Select a scoped source for approval", registered.filter(id => !capabilities.includes(id)), { signal });
    if (!id) return;
    capabilities.push(id);
  }
  signal.throwIfAborted();
  return { instructions, files, capabilities };
}

export async function contextPermissions(ctx: ExtensionContext, summary: string, signal: AbortSignal): Promise<Disclosure | undefined> {
  if (!ctx.hasUI) throw new Error("Local context and additional instructions require interactive disclosure approval before model work");
  if (!await ctx.ui.confirm("Approve context for research models?", `${summary}\nThe selected research models will receive this context. Listed read-only integrations may receive research queries within their fixed scopes; their fees are separate from the model ceiling. Text is untrusted data; instructions cannot grant other tools. Nothing is sent if you decline.`, { signal })) return;
  const search = await ctx.ui.confirm("Allow context in public search/acquisition requests?", "Separate permission. If declined, private context is reserved for drafting; later public requests are disabled after it is used. Public research still runs first without these inputs.", { signal });
  const exportAllowed = await ctx.ui.confirm("Allow exporting reports derived from this context?", "Separate permission. This allows derived report copies, not source attachments. If declined, read-only viewing remains available but Markdown/HTML export and Save report are blocked after context use.", { signal });
  signal.throwIfAborted();
  return { model: true, search, export: exportAllowed };
}

export async function confirmResearch(ctx: ExtensionContext, proposal: {
  config: Config; location: NonNullable<RunState["location"]>; selected?: RunState;
  revision: boolean; revisionFeedback?: string; useProjectConfig: boolean; hasContextPreview: boolean; topUp?: BudgetTopUp;
}, signal: AbortSignal): Promise<boolean> {
  if (!ctx.hasUI) return true;
  const { config, location, selected, revision, useProjectConfig, hasContextPreview, topUp } = proposal;
  const title = topUp ? `Add $${topUp.amount.toFixed(2)} and resume research?` : selected ? (revision ? "Create revision?" : "Resume paid research?") : "Start research?";
  const settings = [
    ...(revision && selected ? [`Parent investigation: ${cleanTerminal(selected.tag)}`, `Revision request: ${cleanTerminal(proposal.revisionFeedback ?? "")}`, "Creates a new linked paid investigation. The parent report is preserved and supplied as context, not rechecked evidence."] : []),
    `Scope: ${config.scope} · register: ${config.register} · depth: ${config.depth}`,
    `Project: ${location.projectPath}`,
    `Workspace: ${location.workspacePath}`,
    `Model: ${selected?.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "not selected")}`,
    `Role model overrides: ${JSON.stringify(config.models)}`,
    `Search: ${config.searchProvider}${config.searchProvider === "duckduckgo" ? " (free/keyless; may be rate-limited or blocked by bot challenges)" : ""}`,
    `Scholarly: ${config.scholarlyProviders.join(", ") || "disabled"}`,
    `Full-text resolvers: ${config.fullTextResolvers.join(", ") || "disabled"} (Unpaywall needs TURING_CONTACT_EMAIL; CORE needs CORE_API_KEY)`,
    `Model ceiling: ${config.budgetUsd === null ? "unlimited" : `$${config.budgetUsd}`} (search fees separate).`,
    selected ? (useProjectConfig ? `Proposed configuration replacement from ${ctx.cwd}:\n${JSON.stringify(config, null, 2)}\nPrevious: ${JSON.stringify(selected.config)}\nSaved context and default model remain unchanged.` : "Uses saved configuration and context, not this project's files.")
      : hasContextPreview ? "Only the separately approved context will be attached; no ambient integrations are loaded." : "No local files or integrations attached.",
    ...(selected?.inputs ? [`Saved context grant: ${selected.inputs.grant.id}; model/search/export permissions remain scoped to this run.`] : []),
  ];
  const approved = await ctx.ui.confirm(title, (topUp ? budgetTopUpSummary(topUp) + "\n\n" : "") + settings.join("\n"), { signal });
  signal.throwIfAborted();
  return approved;
}
