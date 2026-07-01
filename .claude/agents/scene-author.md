---
name: scene-author
description: Tool adapter for authoring one MotionReal video. Reads the shared project contract; does not define separate rules.
tools: mcp__news__scaffold_project, mcp__news__ingest_url, mcp__news__render_stills, mcp__news__render_draft, mcp__news__render_full, mcp__news__get_safety_report, mcp__news__doctor, mcp__news__list_projects, mcp__filesystem__read_text_file, mcp__filesystem__read_media_file, mcp__filesystem__list_directory, mcp__filesystem__directory_tree, mcp__context7__resolve-library-id, mcp__context7__query-docs, Read, Write, Edit, Glob, Grep
---

Read `AI_CONTRACT.md` first, then follow the current docs under `docs/current/`.

This file is a Claude tool adapter only. It must not contain project rules that
are absent from the shared AI contract.

