# Scoped additional sources

Additional instructions do not load installed skills or inherit Pi's tools.
A trusted host extension must register a bounded reader; the user then selects its
ID and approves its definition, version, fixed scope, and disclosures. Missing,
changed, or unavailable bindings block model work rather than falling back to
ambient tools. No production knowledge-base connector is enabled by default.

## Existing text collections

`registerTextCollection` provides literal, case-insensitive retrieval over an
explicit list of existing text files. It does not scan directories, build an
index, write managed notes, or call models. Import the API from the **same package
installation** as the research extension, so both use the same host registry.
For a local checkout, a separate trusted Pi extension can contain:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTextCollection } from "/absolute/path/to/pi-hyperesearch/src/markdown-collection.ts";

export default function (pi: ExtensionAPI) {
  const dispose = registerTextCollection({
    id: "architecture",
    title: "Reviewed architecture documents",
    root: "/absolute/path/to/selected/project",
    files: ["docs/design.md", "docs/decisions.md"],
  });
  pi.on("session_shutdown", () => { dispose(); });
}
```

Registration is not research approval. Select `architecture` through
`/hyperresearch context` on a paused run, or propose
`"capabilities": ["architecture"]` in project preferences. Ordinary starts skip
the optional context questionnaire; configured selections still require approval.
Model use, public-search disclosure, and derived-report export remain separate
approvals. Paused-run additions queue a replan; they do not start workers.

The adapter accepts up to eight explicitly named files, 500KB total per query,
100KB per evidence document, and a file-list scope string of at most 1,000
characters. It returns at most five matching documents in selection order; narrow
the literal query for other matches. It shares local-context secret/path/type
exclusions. Changed files create new content-hashed versions; previous snapshots
remain intact. Use a managed knowledge system's supported CLI/API for integrations
that need its access controls or metadata semantics, rather than bypassing them.

## Other read-only systems and skill procedures

`src/capabilities.ts` exports `registerScopedReader({ descriptor, query, available })`.
The descriptor records:

- `id`, `title`, and an explicit `version`;
- the selected procedure/skill `definition` (up to 12,000 characters);
- fixed `scope` values, such as collection ID and endpoint identity;
- `credentialRefs` such as `env:KB_TOKEN` or `host:knowledge-auth`, never values;
- `readOnly: true` and `visibility: "private"` (the default) or `"public"`.

The host hashes the descriptor and query/availability implementation. The adapter
must also represent **all closure/configuration changes in version or scope**:
a function hash cannot detect a changed client hidden in a closure. Host adapters
are trusted code, not a sandbox; labeling arbitrary code `readOnly` does not make
it safe. Register only implementations that actually enforce the declared scope.

`query(queryText, signal)` must perform bounded read-only retrieval inside that
scope. It receives no worker-selected command, filesystem root, endpoint, or tool
list. Never build shell strings, accept arbitrary paths, run a skill's shell
instructions, or forward unrestricted ambient Pi tools. Honor cancellation and
bound transport responses before parsing them. The runner applies a 15-second
adapter deadline, serializes calls per registration, and caps runs at 40 requests
and 100 retrieved snapshots. Integration fees are separate from model estimates.

Return at most five records shaped as follows:

```ts
{
  uri: "kb:approved-collection/design-17",
  title: "Deployment decision",
  version: "revision-42",       // omit only if genuinely unavailable
  body: "The underlying source text, not a generated summary...",
  complete: true               // false for snippets or incomplete documents
}
```

Each body is limited to 100KB. A false completeness flag cannot clear full-read
eligibility. Empty text, procedure definitions, malformed records, oversized
outputs and likely credentials are refused. A successful query is not a source
read: workers must paginate the preserved document through `read_source` before
citing it. Records retain origin, version, visibility, binding hash, retrieval time
and content hash. Procedure definitions never enter the source count.

`available()` is a synchronous, local check of current access; it must not make
network requests or return credentials. Without this callback, all declared
`env:` references must be present; `host:` references require a callback. Errors
are redacted. Missing, changed or revoked bindings fail validation before model
work and again at tool boundaries. Unregistering the reader also revokes its
availability for future workers. Human viewing and previously approved report
exports do not require contacting the integration.

## Limits

Text adapters do not certify OCR, visual comprehension, equations, table layout,
or full-document truth. They cannot clear configured visual-reading requirements.
Local/private records are not independent external corroboration. Public metadata
refresh covers only DOI-bearing public sources through approved OpenAlex; scoped
snapshots retain an explicit unknown retraction status rather than sending private
documents or identifiers to an unapproved metadata service.

A request for an unregistered skill or knowledge base needs an explicit compatible
adapter; freeform text cannot turn an unavailable procedure into permission to run
its dependencies. Browser profile access, login, CAPTCHA/2FA automation, arbitrary
shell/file tools and automatic publication are not supplied by this interface.
