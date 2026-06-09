/**
 * Barrel for the renderer's screen components. Each screen lives in its own
 * file under `./views/`; shared primitives + icons live in `./primitives` +
 * `./icons`. App.tsx imports every screen from here, so this file's surface is
 * the stable contract — adding a screen means adding one re-export line.
 */
export { LicenseView } from "./views/license.js";
export { Sidebar } from "./views/sidebar.js";
export { HomeView } from "./views/home.js";
export { ProjectsView } from "./views/projects.js";
export { SettingsView } from "./views/settings.js";
export { ProjectWorkspaceView } from "./views/workspace.js";
export { StoryboardView } from "./views/storyboard.js";
export type { Screen } from "./primitives.js";
