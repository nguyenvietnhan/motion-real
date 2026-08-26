import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import video_pipeline


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def make_job(root: Path):
    job = root / "jobs" / "demo"
    runtime = root / "starter-hf" / "demo"
    (runtime / "assets").mkdir(parents=True)
    (runtime / "assets" / "evidence.svg").write_text("<svg/>", encoding="utf-8")
    write_json(job / "brief.json", {"topic": "Demo", "audience": "Learner", "viewer_promise": "Understand", "visual_direction": "Diagram"})
    write_json(job / "claims.json", {"claims": [{"id": "claim-1", "text": "Fact", "status": "supported", "source_url": "https://example.com", "source_title": "Example", "excerpt": "Fact", "confidence": "high"}]})
    write_json(job / "assets.json", {"assets": [{"id": "asset-1", "source_url": "https://example.com/image", "runtime_path": "assets/evidence.svg", "evidence_role": "primary", "claim_ids": ["claim-1"], "license_status": "unknown", "rights_text": "unknown", "attribution_note": "review before publishing"}]})
    write_json(job / "video-plan.json", {"schemaVersion": 2, "video": {"aspect_ratio": "9:16", "target_duration_seconds": 90}, "visual_language": {"concept": "Editorial", "media_strategy": "Original SVG", "typography_role": "One short phrase", "negative_patterns": ["repeated panel"]}, "chapters": [{"id": "chapter-1", "title": "Intro", "purpose": "Explain"}], "beats": [{"id": "beat-1", "chapter_id": "chapter-1", "purpose": "Explain", "narration": "Narration", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "visual_metaphor": "Point moves", "visual_shot": {"id": "shot-1", "focal_subject": "Point", "visual_family": "diagram", "max_non_caption_text": 4, "continuity_intent": "Continue"}, "start_state": "Before", "state_changes": [{"id": "move", "at": 0.5, "motion_window": [0.25, 0.75], "narrative_change": "Moves", "visual_result": "After move"}], "end_state": "After", "transition_intent": "Continue"}]})
    write_json(job / "timing.json", {"beats": [{"id": "beat-1", "start": 10, "duration": 8}]})
    return video_pipeline.JobPaths(job, runtime)


class VideoPipelineTests(unittest.TestCase):
    def test_valid_job_and_snapshot_times(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            self.assertEqual(video_pipeline.validate_job(paths), [])
            plan = video_pipeline.snapshot_plan(paths, "v1")
            self.assertEqual(plan["capture_times"], [10.0, 12.0, 13.333, 14.0, 14.667, 16.0, 18.0])
            strips = [item for item in plan["frames"] if item["kind"] == "motion-strip"]
            self.assertEqual([item["timestamp"] for item in strips], [12.0, 13.333, 14.667, 16.0])

    def test_rejects_claim_without_excerpt(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            claims = json.loads((paths.job / "claims.json").read_text())
            claims["claims"][0].pop("excerpt")
            write_json(paths.job / "claims.json", claims)
            self.assertTrue(any("excerpt" in error for error in video_pipeline.validate_job(paths)))

    def test_rejects_missing_runtime_asset_and_invalid_window(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            assets = json.loads((paths.job / "assets.json").read_text())
            assets["assets"][0]["runtime_path"] = "assets/missing.svg"
            write_json(paths.job / "assets.json", assets)
            plan = json.loads((paths.job / "video-plan.json").read_text())
            plan["beats"][0]["state_changes"][0]["motion_window"] = [0.8, 0.2]
            write_json(paths.job / "video-plan.json", plan)
            errors = video_pipeline.validate_job(paths)
            self.assertTrue(any("runtime_path" in error for error in errors))
            self.assertTrue(any("motion_window" in error for error in errors))

    def test_preflight_uses_required_doctor_checks_not_optional_warnings(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            doctor = {
                "ok": False,
                "checks": [
                    {"name": "Version", "ok": False},
                    {"name": "Node.js", "ok": True},
                    {"name": "FFmpeg", "ok": True},
                    {"name": "FFprobe", "ok": True},
                    {"name": "Chrome", "ok": True},
                    {"name": "Docker", "ok": False},
                ],
            }

            def fake_run(command, cwd):
                if command[0] == "node":
                    return {"command": command, "returncode": 0, "stdout": "v22.0.0", "stderr": ""}
                return {"command": command, "returncode": 0, "stdout": "docker missing\n" + json.dumps(doctor), "stderr": ""}

            with patch.object(video_pipeline, "run_command", fake_run):
                code, report = video_pipeline.preflight(paths, {"web-download", "snapshot-view"})
            self.assertEqual(code, 0)
            self.assertEqual(report["status"], "pass")

    def test_review_bundle_surfaces_unknown_asset_rights(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            plan_path = paths.runtime / "qa" / "snapshot-plan.json"
            video_pipeline.write_json(plan_path, video_pipeline.snapshot_plan(paths, "v1"))
            qa = video_pipeline.update_qa_bundle(paths, plan_path, "v1")
            self.assertEqual(qa["asset_warnings"][0]["license_status"], "unknown")
            self.assertEqual(qa["asset_warnings"][0]["attribution_note"], "review before publishing")

    def test_rejects_missing_visual_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            plan = json.loads((paths.job / "video-plan.json").read_text())
            plan.pop("visual_language")
            plan["beats"][0].pop("visual_shot")
            write_json(paths.job / "video-plan.json", plan)
            errors = video_pipeline.validate_job(paths)
            self.assertTrue(any("visual_language" in error for error in errors))
            self.assertTrue(any("visual_shot" in error for error in errors))

    def test_author_and_qa_gates_require_rewrite_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            source = '<section data-beat-id="beat-1" data-shot-id="shot-1" data-focal-id="point" data-visual-family="diagram" data-non-caption-text="3" data-asset-id="asset-1"></section>'
            (paths.runtime / "index.html").write_text(source, encoding="utf-8")
            self.assertEqual(video_pipeline.audit_author(paths, "v1"), [])
            for iteration in ("v1", "v2"):
                folder = paths.runtime / "qa" / "snapshots" / iteration
                folder.mkdir(parents=True)
                (folder / "contact.jpg").write_bytes(b"image")
            (paths.runtime / "index.html").write_text(source.replace('data-focal-id="point"', 'data-focal-id="moved-point"'), encoding="utf-8")
            self.assertEqual(video_pipeline.audit_author(paths, "v2"), [])
            qa = {
                "creative_reviews": {
                    key: {"status": "complete", "entries": [{"beat_id": "beat-1", "evidence_file": f"qa/snapshots/{key}/contact.jpg", "observation": "Observed on image", "action": "rewrite"}]}
                    for key in ("v1", "v2")
                },
                "creative_rewrite": {"status": "completed", "iteration": "v2", "changed_shot_ids": ["shot-1"]},
                "motion_diagnostic": {"status": "ok"},
            }
            write_json(paths.job / "qa.json", qa)
            self.assertEqual(video_pipeline.qa_gate(paths, "pre-review"), [])

    def test_rejects_duplicate_shot_and_missing_rendered_asset(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            plan = json.loads((paths.job / "video-plan.json").read_text())
            duplicate = dict(plan["beats"][0])
            duplicate["id"] = "beat-2"
            duplicate["visual_shot"] = dict(duplicate["visual_shot"])
            plan["beats"].append(duplicate)
            write_json(paths.job / "video-plan.json", plan)
            self.assertTrue(any("duplicate visual_shot" in error for error in video_pipeline.validate_job(paths)))
            plan["beats"].pop()
            write_json(paths.job / "video-plan.json", plan)
            (paths.runtime / "index.html").write_text('<section data-beat-id="beat-1" data-shot-id="shot-1" data-focal-id="point" data-visual-family="diagram" data-non-caption-text="3" data-asset-id="other"></section>', encoding="utf-8")
            self.assertTrue(any("missing asset ids" in error for error in video_pipeline.audit_author(paths, "v1")))

    def test_handoff_requires_motion_finding_acknowledgements(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            source = '<section data-beat-id="beat-1" data-shot-id="shot-1" data-focal-id="point" data-visual-family="diagram" data-non-caption-text="3" data-asset-id="asset-1"></section>'
            (paths.runtime / "index.html").write_text(source, encoding="utf-8")
            self.assertEqual(video_pipeline.audit_author(paths, "v1"), [])
            for iteration in ("v1", "v2"):
                folder = paths.runtime / "qa" / "snapshots" / iteration
                folder.mkdir(parents=True)
                (folder / "contact.jpg").write_bytes(b"image")
            (paths.runtime / "index.html").write_text(source.replace("point", "point-v2"), encoding="utf-8")
            self.assertEqual(video_pipeline.audit_author(paths, "v2"), [])
            reviews = {key: {"status": "complete", "entries": [{"beat_id": "beat-1", "evidence_file": f"qa/snapshots/{key}/contact.jpg", "observation": "Visible visual evidence", "action": "rewrite"}]} for key in ("v1", "v2")}
            write_json(paths.job / "qa.json", {"creative_reviews": reviews, "creative_rewrite": {"status": "completed", "iteration": "v2", "changed_shot_ids": ["shot-1"]}, "motion_diagnostic": {"status": "findings", "findings": [{"finding_index": 0, "beat_id": "beat-1"}]}})
            self.assertTrue(any("acknowledgement" in error for error in video_pipeline.qa_gate(paths, "handoff")))

    def test_maps_motion_findings_to_timing_beat(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = make_job(Path(temp))
            write_json(paths.job / "qa.json", {})
            write_json(paths.job / "motion-diagnostic.json", {"status": "findings", "findings": [{"start": 12, "duration": 5}]})
            video_pipeline.map_motion_diagnostic(paths)
            qa = json.loads((paths.job / "qa.json").read_text())
            self.assertEqual(qa["motion_diagnostic"]["findings"][0]["beat_id"], "beat-1")


if __name__ == "__main__":
    unittest.main()
