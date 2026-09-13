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
import os
import re
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


def extraction_diagnostics(root, meta, body, offset, end):
    """Inspect preserved bytes; never call a network, browser, OCR, or login tool.

    Complete pagination covers extracted TEXT, not the visual document. Preserve
    actual PDF page numbers, including empty pages upstream's reader dropped.
    """
    oa = meta.get("oa") or {}
    actual_url = oa.get("url") or oa.get("oa_url") or meta["source"]
    version = {"submittedVersion": "submitted", "acceptedVersion": "accepted", "publishedVersion": "published"}.get(oa.get("version"), "unknown")
    result = {"reader": "python-static-text", "media": "html", "status": "text-extracted", "actualUrl": actual_url,
              "version": version, "missingPages": [], "warnings": ["layout-unverified", "tables-unverified", "figures-unverified", "equations-unverified"]}
    raw = meta.get("raw_file")
    path = None
    if raw:
        relative = Path(raw)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Unsafe source asset path")
        path = root / "research"
        for part in relative.parts:
            path = path / part
            if path.is_symlink():
                raise ValueError("Symlink source asset refused")
    is_pdf = urlparse(actual_url).path.lower().endswith(".pdf") or bool(path and path.suffix.lower() == ".pdf")
    if path and path.exists():
        if not path.is_file() or path.stat().st_size > 20_000_000:
            return {**result, "status": "incomplete", "warnings": ["Source asset exceeds diagnostic limit"]}, []
        data = path.read_bytes()
        result["rawHash"] = hashlib.sha256(data).hexdigest()
        is_pdf = is_pdf or data.startswith(b"%PDF-")
    else:
        data = None
    if not is_pdf:
        return result, []
    result.update(reader="pymupdf-text-layer", media="pdf")
    if data is None:
        return {**result, "status": "unknown", "warnings": [*result["warnings"], "Preserved PDF bytes unavailable; page completeness unknown"]}, []
    import pymupdf
    spans = []
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            result["pages"] = len(doc)
            if len(doc) > 300 or doc.needs_pass:
                return {**result, "status": "incomplete", "warnings": ["Encrypted PDF or diagnostic page limit exceeded"]}, []
            cursor = 0
            missing = []
            for index, page in enumerate(doc):
                text = page.get_text("text").strip()
                if len(text) < 40:
                    missing.append(index + 1)
                    continue
                start = body.find(text, cursor)
                if start < 0:
                    result["status"] = "incomplete"
                    continue
                cursor = start + len(text)
                if start < end and cursor > offset:
                    spans.append({"page": index + 1, "start": start, "end": cursor})
            result["textPages"] = len(doc) - len(missing)
            result["missingPages"] = missing[:20]
            if missing:
                result["status"] = "incomplete"
                result["warnings"].append("Empty/sparse pages require approved OCR or visual review; none was performed")
            if result["status"] == "incomplete":
                result["warnings"].append("Some PDF pages cannot be mapped to usable preserved source text")
    except Exception:
        result["status"] = "unavailable"
        result["warnings"].append("PDF diagnostic reader failed; no visual/OCR fallback was invoked")
    if len(spans) > 20:
        result["warnings"].append("Page provenance for this response is truncated to 20 spans")
    return result, spans[:20]


def resolver_coverage(resolvers):
    if not isinstance(resolvers, list) or any(value not in ("unpaywall", "europepmc", "core") for value in resolvers):
        raise ValueError("Invalid approved resolver list")
    result = []
    for name in dict.fromkeys(resolvers):
        required = {"unpaywall": "HYPERRESEARCH_CONTACT_EMAIL", "core": "CORE_API_KEY"}.get(name)
        value = os.environ.get(required, "") if required else ""
        available = not required or bool(value and not re.search(r"[\x00-\x20\x7f]", value))
        if name == "unpaywall":
            available = available and bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value))
        result.append({"resolver": name, "available": available, "reason": None if available else f"Requires {required}"})
    return result


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
            # Upstream silently falls back to Semantic Scholar. It is not an
            # approved provider here; block it before cache access or transport.
            from hyperresearch.core import scholar
            if "openalex" not in args.get("providers", []):
                raise ValueError("Retraction refresh requires approved OpenAlex; no provider was enabled")
            fetch_json = scholar._fetch_json
            def approved_metadata(conn, url, *pos, **kw):
                if urlparse(url).hostname != "api.openalex.org":
                    return None
                return fetch_json(conn, url, *pos, **kw)
            with patch.object(scholar, "_fetch_json", side_effect=approved_metadata):
                return cli(["sources", "retractions", "--tag", args["tag"], "--json"])
        if action == "vault_search":
            return cli(["search", "--no-body", "--limit", "10", "--json", "--", args["query"]])
        if action == "scholar_search":
            raise ValueError("Scholarly discovery moved to the composable TypeScript adapters. Reload Pi; no Python discovery fallback is enabled.")
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
            from hyperresearch.core import oa
            coverage = resolver_coverage(args.get("resolvers", []))
            resolvers = [item["resolver"] for item in coverage if item["available"]]
            candidates = oa.iter_oa_candidates
            def approved_candidates(conn, doi, ttl_days, **kwargs):
                kwargs["email"] = os.environ.get("HYPERRESEARCH_CONTACT_EMAIL") if "unpaywall" in resolvers else None
                return candidates(conn, doi, ttl_days, **kwargs)
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(oa, "iter_oa_candidates", side_effect=approved_candidates))
                for name, attribute, empty in [
                    ("unpaywall", "_unpaywall_candidates", []),
                    ("europepmc", "_resolve_europepmc", None),
                    ("core", "_core_candidates", []),
                ]:
                    if name not in resolvers:
                        stack.enter_context(patch.object(oa, attribute, return_value=empty))
                result = cli([*command, "--", url])
                return {**result, "resolverCoverage": coverage}
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
            extraction, pages = extraction_diagnostics(root, meta, body, offset, end)
            return {
                "id": note_id, "title": meta["title"][:1000], "url": meta["source"],
                "extraction": extraction, "pageSpans": pages,
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
