"""One JSON request on stdin, one JSON response on stdout; no daemon.

Keep upstream-only imports here. The Pi runner never relies on Claude's installer,
agent prompts, shell tools, or Skill/Task protocol. Mutations are serialized by
our TypeScript adapter, under a vault-wide runner lock.
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.metadata
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse


def cli(args: list[str]):
    """Call the pinned CLI in-process without scraping rich console output."""
    from hyperresearch.cli import app

    from hyperresearch.core.vault import Vault
    envelopes = []
    opened = []
    discover = Vault.discover

    def tracked_discover(*args, **kwargs):
        vault = discover(*args, **kwargs)
        opened.append(vault)
        return vault

    try:
        with patch("hyperresearch.cli._output._output_json", side_effect=lambda value: envelopes.append(
            value.model_dump(exclude_none=True) if hasattr(value, "model_dump") else value
        )), patch.object(Vault, "discover", side_effect=tracked_discover), contextlib.redirect_stdout(io.StringIO()):
            try:
                app(args, standalone_mode=False)
            except (SystemExit, Exception):
                if not envelopes:
                    raise
    finally:
        for vault in opened:
            vault.close()
    if not envelopes:
        raise RuntimeError("Backend command returned no JSON")
    result = envelopes[-1]
    if not result.get("ok"):
        raise RuntimeError(result.get("error", "Backend command failed"))
    return result.get("data")


def require_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only HTTP(S) URLs without embedded credentials are allowed")


def dispatch(action: str, args: dict):
    from hyperresearch.core.vault import Vault

    if action == "doctor":
        return {"version": importlib.metadata.version("hyperresearch")}
    root = Path.cwd()
    if action == "init":
        if not (root / ".hyperresearch").exists():
            # Vault.init otherwise injects Claude-only instructions into CLAUDE.md.
            with patch("hyperresearch.core.agent_docs.inject_agent_docs", return_value=[]):
                Vault.init(root).close()
        with Vault(root) as vault:
            if not vault.is_initialized:
                raise ValueError("Incomplete vault initialization; inspect .hyperresearch first")
            if vault.config.research_dir != "research":
                raise ValueError("This port currently requires research_dir = 'research'")
            from hyperresearch.core.profiles import resolve_profile
            profile = resolve_profile("light", vault.config_path)
            return {"sourceMin": profile.source_min, "wordTarget": profile.word_targets["short"]}

    with Vault(root) as vault:
        if not vault.is_initialized or vault.config.research_dir != "research":
            raise ValueError("No compatible vault in the working directory")
        from hyperresearch.core import runs
        if action == "create_run":
            return runs.init_run(vault, args["tag"], profile="light", query=args["query"])
        if action == "set_step":
            return runs.set_step(vault, args["tag"], args["step"], args["status"])
        if action == "set_status":
            return runs.set_status(vault, args["tag"], args["status"], args.get("reason"))
        if action == "finish":
            vault.auto_sync()
            return runs.finish_run(vault, args["tag"])["verify"]
        if action == "retractions":
            return cli(["sources", "retractions", "--tag", args["tag"], "--json"])
        if action == "vault_search":
            return cli(["search", "--no-body", "--limit", "10", "--json", "--", args["query"]])
        if action == "scholar_search":
            # Bound both provider work and output; failures remain visible.
            result = cli(["scholar", "search", "-s", "openalex", "-s", "crossref", "-n", "5", "-j", "--", args["query"]])
            from hyperresearch.core.untrusted import wrap_body
            for item in result.get("results", []):
                if item.get("abstract"):
                    item["abstract"] = wrap_body(item["abstract"][:600], item.get("url") or "scholarly-search")
            return result
        if action == "web_search":
            raise ValueError("Web search moved to the direct Brave/DuckDuckGo Node adapter. Pause and reload Pi; upstream search providers are disabled.")
        if action == "fetch_source":
            from hyperresearch.core.fetcher import existing_live_note_for_url
            url = args["url"]
            require_url(url)
            vault.auto_sync()
            existing = existing_live_note_for_url(vault.db, url)
            if existing:
                return {"note_id": existing["note_id"], "reused": True}
            command = ["fetch", "--provider", "builtin", "--tag", args["tag"], "--json"]
            if args.get("suggestedBy"):
                # A real note must exist; never fabricate a provenance parent.
                if not vault.db.execute("SELECT id FROM notes WHERE id = ?", (args["suggestedBy"],)).fetchone():
                    raise ValueError("Unknown suggestedBy note")
                command += ["--suggested-by", args["suggestedBy"]]
            return cli([*command, "--", url])
        if action == "read_source":
            from hyperresearch.core.untrusted import wrap_body
            note_id = args["id"]
            meta = cli(["note", "show", "--meta", "--json", "--", note_id])
            require_url(meta.get("source") or "")
            if meta.get("type") in ("interim", "source-analysis", "moc", "index"):
                raise ValueError("Generated synthesis is not a primary source; read its source notes instead")
            row = vault.db.execute("SELECT body FROM note_content WHERE note_id = ?", (note_id,)).fetchone()
            body = row["body"]
            offset = args.get("offset", 0)
            if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0 or offset > len(body):
                raise ValueError("Invalid source offset")
            end = min(len(body), offset + 8000)
            fetched = vault.db.execute("SELECT fetched_at FROM sources WHERE note_id = ? LIMIT 1", (note_id,)).fetchone()
            if args["tag"] not in meta.get("tags", []):
                cli(["note", "update", "--add-tag", args["tag"], "--json", "--", note_id])
            return {
                "id": note_id, "title": meta["title"][:1000], "url": meta["source"],
                "words": meta["word_count"], "oa": meta.get("oa"),
                "retrievedAt": fetched["fetched_at"] if fetched else meta["created"],
                "offset": offset, "end": end, "total": len(body),
                "hash": hashlib.sha256(body.encode()).hexdigest(),
                "body": wrap_body(body[offset:end], meta["source"]),
                "nextOffset": end if end < len(body) else None,
            }
        raise ValueError(f"Unknown backend action: {action}")


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(1_000_000))
        result = dispatch(request["action"], request.get("args", {}))
        print(json.dumps({"ok": True, "data": result}, default=str))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"[:3000]}))
        sys.exit(1)
