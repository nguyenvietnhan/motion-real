#!/usr/bin/env python3
"""Mechanical contract checks for the experimental HyperFrames video pipeline."""

from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
REQUIRED_CAPABILITIES = {"web-download", "snapshot-view"}
LICENSE_STATUSES = {"known-compatible", "attribution-required", "unknown", "restricted"}
EVIDENCE_ROLES = {"primary", "contextual", "illustrative"}
CLAIM_STATUSES = {"supported", "illustrative"}
CREATIVE_ITERATIONS = {"v1", "v2", "v3"}


@dataclass
class JobPaths:
    job: Path
    runtime: Path


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"missing required file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in {path}: {exc.msg}") from exc


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve_job(value: str) -> JobPaths:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = ROOT / candidate if candidate.parent != Path(".") else ROOT / "jobs" / candidate
    job = candidate.resolve()
    return JobPaths(job=job, runtime=ROOT / "starter-hf" / job.name)


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def require_list(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a JSON array")
    if not all(isinstance(item, dict) for item in value):
        raise ValueError(f"{label} must contain objects")
    return value


def unique_index(items: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for item in items:
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id.strip():
            raise ValueError(f"{label} item missing non-empty id")
        if item_id in indexed:
            raise ValueError(f"duplicate {label} id: {item_id}")
        indexed[item_id] = item
    return indexed


def nonempty_string(value: Any, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")


def validate_visual_language(plan: dict[str, Any], errors: list[str]) -> None:
    language = plan.get("visual_language")
    if not isinstance(language, dict):
        errors.append("video-plan.json.visual_language must be an object")
        return
    for field in ("concept", "media_strategy", "typography_role"):
        try:
            nonempty_string(language.get(field), f"video-plan.json.visual_language.{field}")
        except ValueError as exc:
            errors.append(str(exc))
    patterns = language.get("negative_patterns")
    if not isinstance(patterns, list) or not patterns or not all(isinstance(item, str) and item.strip() for item in patterns):
        errors.append("video-plan.json.visual_language.negative_patterns must contain non-empty strings")


def validate_visual_shot(beat_id: str, beat: dict[str, Any], shot_ids: set[str], errors: list[str]) -> None:
    shot = beat.get("visual_shot")
    if not isinstance(shot, dict):
        errors.append(f"beat {beat_id}.visual_shot must be an object")
        return
    shot_id = shot.get("id")
    if not isinstance(shot_id, str) or not shot_id.strip():
        errors.append(f"beat {beat_id}.visual_shot.id must be a non-empty string")
    elif shot_id in shot_ids:
        errors.append(f"duplicate visual_shot id: {shot_id}")
    else:
        shot_ids.add(shot_id)
    for field in ("focal_subject", "visual_family", "continuity_intent"):
        try:
            nonempty_string(shot.get(field), f"beat {beat_id}.visual_shot.{field}")
        except ValueError as exc:
            errors.append(str(exc))
    text_budget = shot.get("max_non_caption_text")
    if not isinstance(text_budget, int) or text_budget < 0:
        errors.append(f"beat {beat_id}.visual_shot.max_non_caption_text must be a non-negative integer")


def id_references(value: Any, known: set[str], label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{label} must be an array of ids")
    missing = [item for item in value if item not in known]
    if missing:
        raise ValueError(f"{label} references unknown ids: {', '.join(missing)}")
    return value


def load_contract(paths: JobPaths) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    claims = require_object(read_json(paths.job / "claims.json"), "claims.json")
    assets = require_object(read_json(paths.job / "assets.json"), "assets.json")
    plan = require_object(read_json(paths.job / "video-plan.json"), "video-plan.json")
    return claims, assets, plan


def validate_job(paths: JobPaths, require_runtime_assets: bool = True) -> list[str]:
    brief = require_object(read_json(paths.job / "brief.json"), "brief.json")
    claims_doc, assets_doc, plan = load_contract(paths)
    claims = unique_index(require_list(claims_doc.get("claims"), "claims.json.claims"), "claim")
    assets = unique_index(require_list(assets_doc.get("assets"), "assets.json.assets"), "asset")
    chapters = unique_index(require_list(plan.get("chapters"), "video-plan.json.chapters"), "chapter")
    beats = unique_index(require_list(plan.get("beats"), "video-plan.json.beats"), "beat")
    errors: list[str] = []

    for field in ("topic", "audience", "viewer_promise", "visual_direction"):
        try:
            nonempty_string(brief.get(field), f"brief.json.{field}")
        except ValueError as exc:
            errors.append(str(exc))
    video = plan.get("video")
    if not isinstance(video, dict):
        errors.append("video-plan.json.video must be an object")
    else:
        if video.get("aspect_ratio") != "9:16":
            errors.append("video-plan.json.video.aspect_ratio must be 9:16")
        if not isinstance(video.get("target_duration_seconds"), (int, float)) or video["target_duration_seconds"] <= 0:
            errors.append("video-plan.json.video.target_duration_seconds must be positive")
    validate_visual_language(plan, errors)

    for claim_id, claim in claims.items():
        status = claim.get("status")
        if status not in CLAIM_STATUSES:
            errors.append(f"claim {claim_id}: status must be one of {sorted(CLAIM_STATUSES)}")
            continue
        nonempty_string(claim.get("text"), f"claim {claim_id}.text")
        if status == "supported":
            for field in ("source_url", "source_title", "excerpt", "confidence"):
                try:
                    nonempty_string(claim.get(field), f"claim {claim_id}.{field}")
                except ValueError as exc:
                    errors.append(str(exc))

    for asset_id, asset in assets.items():
        if asset.get("evidence_role") not in EVIDENCE_ROLES:
            errors.append(f"asset {asset_id}: invalid evidence_role")
        if asset.get("license_status") not in LICENSE_STATUSES:
            errors.append(f"asset {asset_id}: invalid license_status")
        for field in ("source_url", "runtime_path", "rights_text", "attribution_note"):
            try:
                nonempty_string(asset.get(field), f"asset {asset_id}.{field}")
            except ValueError as exc:
                errors.append(str(exc))
        try:
            id_references(asset.get("claim_ids", []), set(claims), f"asset {asset_id}.claim_ids")
        except ValueError as exc:
            errors.append(str(exc))
        runtime_path = asset.get("runtime_path")
        if require_runtime_assets and isinstance(runtime_path, str) and runtime_path:
            resolved = (paths.runtime / runtime_path).resolve()
            if paths.runtime.resolve() not in resolved.parents or not resolved.is_file():
                errors.append(f"asset {asset_id}: runtime_path missing or outside runtime project: {runtime_path}")

    for chapter_id, chapter in chapters.items():
        try:
            nonempty_string(chapter.get("title"), f"chapter {chapter_id}.title")
            nonempty_string(chapter.get("purpose"), f"chapter {chapter_id}.purpose")
        except ValueError as exc:
            errors.append(str(exc))

    shot_ids: set[str] = set()
    for beat_id, beat in beats.items():
        duplicated_metadata = {"source_url", "source_title", "excerpt", "license_status", "runtime_path"} & set(beat)
        if duplicated_metadata:
            errors.append(f"beat {beat_id}: duplicated ledger metadata: {', '.join(sorted(duplicated_metadata))}")
        if beat.get("chapter_id") not in chapters:
            errors.append(f"beat {beat_id}: unknown chapter_id")
        validate_visual_shot(beat_id, beat, shot_ids, errors)
        for field in ("purpose", "narration", "visual_metaphor", "start_state", "end_state", "transition_intent"):
            try:
                nonempty_string(beat.get(field), f"beat {beat_id}.{field}")
            except ValueError as exc:
                errors.append(str(exc))
        for field, known in (("claim_ids", set(claims)), ("asset_ids", set(assets))):
            try:
                id_references(beat.get(field, []), known, f"beat {beat_id}.{field}")
            except ValueError as exc:
                errors.append(str(exc))
        changes = beat.get("state_changes")
        if not isinstance(changes, list) or not changes:
            errors.append(f"beat {beat_id}.state_changes must contain at least one state change")
            continue
        seen_change_ids: set[str] = set()
        for index, change in enumerate(changes):
            if not isinstance(change, dict):
                errors.append(f"beat {beat_id}.state_changes[{index}] must be an object")
                continue
            change_id = change.get("id")
            if not isinstance(change_id, str) or not change_id or change_id in seen_change_ids:
                errors.append(f"beat {beat_id}.state_changes[{index}] has missing or duplicate id")
            else:
                seen_change_ids.add(change_id)
            at = change.get("at")
            window = change.get("motion_window")
            if not isinstance(at, (int, float)) or not 0 <= at <= 1:
                errors.append(f"beat {beat_id} state {change_id}: at must be between 0 and 1")
            if not isinstance(window, list) or len(window) != 2 or not all(isinstance(value, (int, float)) for value in window):
                errors.append(f"beat {beat_id} state {change_id}: motion_window must be two numbers")
            elif not (0 <= window[0] <= window[1] <= 1 and isinstance(at, (int, float)) and window[0] <= at <= window[1]):
                errors.append(f"beat {beat_id} state {change_id}: motion_window must contain at")
            for field in ("narrative_change", "visual_result"):
                try:
                    nonempty_string(change.get(field), f"beat {beat_id} state {change_id}.{field}")
                except ValueError as exc:
                    errors.append(str(exc))
    return errors


def snapshot_plan(paths: JobPaths, iteration: str) -> dict[str, Any]:
    if iteration not in CREATIVE_ITERATIONS:
        raise ValueError(f"iteration must be one of {sorted(CREATIVE_ITERATIONS)}")
    errors = validate_job(paths)
    if errors:
        raise ValueError("validation failed:\n- " + "\n- ".join(errors))
    _, _, plan = load_contract(paths)
    timing = require_object(read_json(paths.job / "timing.json"), "timing.json")
    timing_beats = unique_index(require_list(timing.get("beats"), "timing.json.beats"), "timing beat")
    frames: list[dict[str, Any]] = []
    for beat in plan["beats"]:
        beat_id = beat["id"]
        entry = timing_beats.get(beat_id)
        if entry is None:
            raise ValueError(f"timing.json missing beat {beat_id}")
        start, duration = entry.get("start"), entry.get("duration")
        if not isinstance(start, (int, float)) or not isinstance(duration, (int, float)) or duration <= 0:
            raise ValueError(f"timing beat {beat_id} requires numeric start and positive duration")

        def add(kind: str, relative: float, label: str, state_id: str | None = None) -> None:
            frames.append({
                "beat_id": beat_id,
                "kind": kind,
                "state_id": state_id,
                "label": label,
                "relative": round(relative, 5),
                "timestamp": round(start + duration * relative, 3),
            })

        add("storyboard", 0.0, "start")
        for change in beat["state_changes"]:
            state_id = change["id"]
            add("storyboard", change["at"], "state", state_id)
            low, high = change["motion_window"]
            for number in range(4):
                relative = low + (high - low) * number / 3
                add("motion-strip", relative, f"strip-{number + 1}", state_id)
        add("storyboard", 1.0, "end")
    capture_times = sorted({frame["timestamp"] for frame in frames})
    return {
        "schemaVersion": 2,
        "iteration": iteration,
        "source": {"video_plan": "video-plan.json", "timing": "timing.json"},
        "frames": frames,
        "capture_times": capture_times,
        "snapshot_directory": f"qa/snapshots/{iteration}",
        "hyperframes_command": "npx hyperframes snapshot --at " + ",".join(f"{time:.3f}" for time in capture_times) + f" --output qa/snapshots/{iteration}",
    }


def update_qa_bundle(paths: JobPaths, plan_path: Path, iteration: str) -> dict[str, Any]:
    assets_doc = require_object(read_json(paths.job / "assets.json"), "assets.json")
    warnings = [
        {
            "asset_id": asset["id"],
            "license_status": asset["license_status"],
            "source_url": asset["source_url"],
            "rights_text": asset["rights_text"],
            "attribution_note": asset["attribution_note"],
        }
        for asset in assets_doc["assets"]
        if asset.get("license_status") in {"unknown", "restricted"}
    ]
    qa_path = paths.job / "qa.json"
    qa = read_json(qa_path) if qa_path.exists() else {}
    if not isinstance(qa, dict):
        qa = {}
    try:
        plan_reference = str(plan_path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        plan_reference = str(plan_path)
    qa.update({
        "schemaVersion": 2,
        "status": qa.get("status", "pending_v1_review"),
        "snapshot_iterations": qa.get("snapshot_iterations", {}),
        "creative_reviews": qa.get("creative_reviews", {}),
        "creative_rewrite": qa.get("creative_rewrite", {"status": "required"}),
        "motion_diagnostic": qa.get("motion_diagnostic", {"status": "not_run"}),
        "motion_acknowledgements": qa.get("motion_acknowledgements", []),
        "asset_warnings": warnings,
    })
    qa["snapshot_iterations"][iteration] = {"plan": plan_reference, "status": "planned"}
    write_json(qa_path, qa)
    return qa


def audit_author(paths: JobPaths, iteration: str) -> list[str]:
    if iteration not in CREATIVE_ITERATIONS:
        return [f"iteration must be one of {sorted(CREATIVE_ITERATIONS)}"]
    errors = validate_job(paths)
    if errors:
        return errors
    _, _, plan = load_contract(paths)
    source = paths.runtime / "index.html"
    if not source.is_file():
        return ["missing runtime index.html"]
    html = source.read_text(encoding="utf-8")
    tags = re.findall(r"<[^>]+data-beat-id=[\"']([^\"']+)[\"'][^>]*>", html)
    known_beats = {beat["id"]: beat for beat in plan["beats"]}
    if set(tags) != set(known_beats) or len(tags) != len(known_beats):
        errors.append("index.html must contain exactly one tagged shot for every beat")
    for beat_id, beat in known_beats.items():
        match = re.search(rf"<[^>]+data-beat-id=[\"']{re.escape(beat_id)}[\"'][^>]*>", html)
        if not match:
            continue
        tag = match.group(0)
        required = {
            "data-shot-id": beat["visual_shot"]["id"],
            "data-focal-id": None,
            "data-visual-family": beat["visual_shot"]["visual_family"],
            "data-non-caption-text": None,
        }
        for attribute, expected in required.items():
            attribute_match = re.search(rf"{attribute}=[\"']([^\"']*)[\"']", tag)
            if not attribute_match or not attribute_match.group(1).strip():
                errors.append(f"beat {beat_id}: tagged shot missing {attribute}")
            elif expected is not None and attribute_match.group(1) != expected:
                errors.append(f"beat {beat_id}: {attribute} must match video-plan")
        budget_match = re.search(r"data-non-caption-text=[\"'](\d+)[\"']", tag)
        if budget_match and int(budget_match.group(1)) > beat["visual_shot"]["max_non_caption_text"]:
            errors.append(f"beat {beat_id}: declared non-caption text exceeds visual_shot budget")
        used_assets = re.search(r"data-asset-id=[\"']([^\"']*)[\"']", tag)
        used_ids = set(used_assets.group(1).split()) if used_assets else set()
        missing_assets = set(beat["asset_ids"]) - used_ids
        if missing_assets:
            errors.append(f"beat {beat_id}: tagged shot missing asset ids: {', '.join(sorted(missing_assets))}")
    families = [beat["visual_shot"]["visual_family"] for beat in plan["beats"]]
    if any(families[index:index + 3] == [families[index]] * 3 for index in range(len(families) - 2)):
        errors.append("video-plan has three consecutive visual_shot.visual_family values")
    archive = paths.runtime / "qa" / "author-v1.html"
    if iteration == "v1" and not errors:
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_text(html, encoding="utf-8")
    if iteration in {"v2", "v3"}:
        if not archive.is_file():
            errors.append("creative rewrite requires qa/author-v1.html archive")
        elif archive.read_text(encoding="utf-8") == html:
            errors.append("creative rewrite must materially replace V1 source")
    return errors


def review_entries(qa: dict[str, Any], iteration: str, beat_ids: set[str], runtime: Path) -> list[str]:
    review = qa.get("creative_reviews", {}).get(iteration)
    if not isinstance(review, dict) or review.get("status") != "complete":
        return [f"creative_reviews.{iteration}.status must be complete"]
    entries = review.get("entries")
    if not isinstance(entries, list):
        return [f"creative_reviews.{iteration}.entries must be an array"]
    covered: set[str] = set()
    errors: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append(f"creative_reviews.{iteration} entry must be an object")
            continue
        beat_id = entry.get("beat_id")
        evidence = entry.get("evidence_file")
        if beat_id not in beat_ids:
            errors.append(f"creative_reviews.{iteration} references unknown beat")
        else:
            covered.add(beat_id)
        if not isinstance(evidence, str) or not evidence.startswith(f"qa/snapshots/{iteration}/") or not (runtime / evidence).is_file():
            errors.append(f"creative_reviews.{iteration} entry needs an existing {iteration} image evidence_file")
        for field in ("observation", "action"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                errors.append(f"creative_reviews.{iteration} entry missing {field}")
    if covered != beat_ids:
        errors.append(f"creative_reviews.{iteration} must cover every beat")
    return errors


def qa_gate(paths: JobPaths, phase: str) -> list[str]:
    if phase not in {"pre-review", "handoff"}:
        return ["phase must be pre-review or handoff"]
    _, _, plan = load_contract(paths)
    qa = require_object(read_json(paths.job / "qa.json"), "qa.json")
    beat_ids = {beat["id"] for beat in plan["beats"]}
    errors = review_entries(qa, "v1", beat_ids, paths.runtime) + review_entries(qa, "v2", beat_ids, paths.runtime)
    rewrite = qa.get("creative_rewrite")
    if not isinstance(rewrite, dict) or rewrite.get("status") != "completed":
        errors.append("creative_rewrite.status must be completed")
    elif rewrite.get("iteration") != "v2":
        errors.append("creative_rewrite.iteration must be v2")
    elif not isinstance(rewrite.get("changed_shot_ids"), list) or not rewrite["changed_shot_ids"]:
        errors.append("creative_rewrite.changed_shot_ids must list changed V2 shots")
    if not (paths.runtime / "qa" / "author-v1.html").is_file():
        errors.append("missing qa/author-v1.html")
    if phase == "handoff":
        diagnostic = qa.get("motion_diagnostic", {})
        if diagnostic.get("status") == "findings":
            findings = diagnostic.get("findings", [])
            acknowledgements = qa.get("motion_acknowledgements", [])
            if not isinstance(acknowledgements, list) or {item.get("finding_index") for item in acknowledgements if isinstance(item, dict)} != set(range(len(findings))):
                errors.append("every motion diagnostic finding requires an acknowledgement")
    return errors


def map_motion_diagnostic(paths: JobPaths) -> list[str]:
    qa = require_object(read_json(paths.job / "qa.json"), "qa.json")
    diagnostic_path = paths.job / "motion-diagnostic.json"
    diagnostic = require_object(read_json(diagnostic_path), "motion-diagnostic.json")
    _, _, plan = load_contract(paths)
    timing = require_object(read_json(paths.job / "timing.json"), "timing.json")
    timing_by_id = unique_index(require_list(timing.get("beats"), "timing.json.beats"), "timing beat")
    ranges = [(entry["start"], entry["start"] + entry["duration"], beat["id"]) for beat in plan["beats"] for entry in [timing_by_id[beat["id"]]]]
    mapped = []
    for index, finding in enumerate(diagnostic.get("findings", [])):
        start = finding.get("start") if isinstance(finding, dict) else None
        beat_id = next((beat for low, high, beat in ranges if isinstance(start, (int, float)) and low <= start <= high), None)
        mapped.append({"finding_index": index, **finding, "beat_id": beat_id})
    qa["motion_diagnostic"] = {"status": diagnostic.get("status", "inconclusive"), "report_path": "motion-diagnostic.json", "findings": mapped}
    write_json(paths.job / "qa.json", qa)
    return []


def run_command(command: list[str], cwd: Path) -> dict[str, Any]:
    try:
        resolved_cmd = list(command)
        if resolved_cmd:
            which_path = shutil.which(resolved_cmd[0])
            if which_path:
                resolved_cmd[0] = which_path
        completed = subprocess.run(resolved_cmd, cwd=cwd, text=True, capture_output=True, check=False)
        return {"command": command, "returncode": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr}
    except OSError as exc:
        return {"command": command, "returncode": None, "stdout": "", "stderr": str(exc)}


def preflight(paths: JobPaths, capabilities: set[str]) -> tuple[int, dict[str, Any]]:
    node = run_command(["node", "--version"], ROOT)
    npx = run_command(["npx", "--no-install", "hyperframes", "doctor", "--json"], ROOT / "starter-hf")
    node_match = re.search(r"v?(\d+)", node.get("stdout", ""))
    node_ok = bool(node_match and int(node_match.group(1)) >= 22)
    doctor_json: Any = None
    try:
        doctor_json = json.loads(npx["stdout"][npx["stdout"].find("{") :])
    except (TypeError, json.JSONDecodeError):
        pass
    doctor_checks = {
        item.get("name"): item.get("ok")
        for item in doctor_json.get("checks", [])
        if isinstance(item, dict)
    } if isinstance(doctor_json, dict) else {}
    required_doctor_checks = {"Node.js", "FFmpeg", "FFprobe", "Chrome"}
    doctor_ok = npx["returncode"] == 0 and (
        all(doctor_checks.get(name) is True for name in required_doctor_checks)
        if doctor_checks
        else True
    )
    missing_capabilities = sorted(REQUIRED_CAPABILITIES - capabilities)
    result = {
        "schemaVersion": 1,
        "status": "pass" if node_ok and doctor_ok and not missing_capabilities else "failed",
        "platform": platform.platform(),
        "capabilities": sorted(capabilities),
        "missing_capabilities": missing_capabilities,
        "checks": {
            "node": {**node, "ok": node_ok},
            "ffmpeg_on_path": bool(shutil.which("ffmpeg")),
            "ffprobe_on_path": bool(shutil.which("ffprobe")),
            "hyperframes_doctor": {**npx, "json": doctor_json, "ok": doctor_ok},
        },
    }
    write_json(paths.job / "runtime.json", result)
    return (0 if result["status"] == "pass" else 2), result


def verify_output(paths: JobPaths, video: Path) -> tuple[int, dict[str, Any]]:
    if not video.is_file():
        result = {"status": "failed", "reason": f"missing video: {video}"}
    elif not shutil.which("ffprobe"):
        result = {"status": "inconclusive", "reason": "ffprobe not found"}
    else:
        raw = run_command(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type", "-of", "json", str(video)], ROOT)
        try:
            probe = json.loads(raw["stdout"])
        except json.JSONDecodeError:
            probe = None
        stream_types = {stream.get("codec_type") for stream in probe.get("streams", [])} if isinstance(probe, dict) else set()
        ok = raw["returncode"] == 0 and {"video", "audio"}.issubset(stream_types)
        result = {"status": "ok" if ok else "failed", "probe": probe, "command": raw}
    write_json(paths.job / "output-verification.json", result)
    return (0 if result["status"] == "ok" else 2), result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("validate", "snapshots", "preflight", "verify-output", "audit-author", "qa-gate", "map-motion"):
        command = subparsers.add_parser(name)
        command.add_argument("--job", required=True, help="job slug or jobs/<slug> path")
    subparsers.choices["preflight"].add_argument("--capability", action="append", default=[])
    subparsers.choices["verify-output"].add_argument("--video", help="defaults to jobs/<slug>/output/review.mp4")
    subparsers.choices["snapshots"].add_argument("--iteration", choices=sorted(CREATIVE_ITERATIONS), required=True)
    subparsers.choices["audit-author"].add_argument("--iteration", choices=sorted(CREATIVE_ITERATIONS), required=True)
    subparsers.choices["qa-gate"].add_argument("--phase", choices=("pre-review", "handoff"), required=True)
    args = parser.parse_args()
    paths = resolve_job(args.job)
    try:
        if args.command == "validate":
            errors = validate_job(paths)
            if errors:
                print("INVALID\n- " + "\n- ".join(errors))
                return 2
            print("VALID")
            return 0
        if args.command == "snapshots":
            plan = snapshot_plan(paths, args.iteration)
            path = paths.runtime / "qa" / f"snapshot-plan-{args.iteration}.json"
            write_json(path, plan)
            update_qa_bundle(paths, path, args.iteration)
            print(f"WROTE {path}")
            print(plan["hyperframes_command"])
            return 0
        if args.command == "audit-author":
            errors = audit_author(paths, args.iteration)
            if errors:
                print("INVALID AUTHOR\n- " + "\n- ".join(errors))
                return 2
            print("AUTHOR VALID")
            return 0
        if args.command == "qa-gate":
            errors = qa_gate(paths, args.phase)
            if errors:
                print("QA INCOMPLETE\n- " + "\n- ".join(errors))
                return 2
            print("QA READY")
            return 0
        if args.command == "map-motion":
            map_motion_diagnostic(paths)
            print("MOTION MAPPED")
            return 0
        if args.command == "preflight":
            code, result = preflight(paths, set(args.capability))
            print(result["status"].upper())
            return code
        video = Path(args.video) if args.video else paths.job / "output" / "review.mp4"
        code, result = verify_output(paths, video)
        print(result["status"].upper())
        return code
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
