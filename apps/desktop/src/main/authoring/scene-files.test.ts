import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolveSceneFile, sceneFileName, type ResolveManifest } from "./scene-files.js";

/**
 * Property 5: localized scene-file resolution.
 * resolveSceneFile returns a path ONLY when the scene exists in the manifest AND
 * its file exists — never pointing at another scene's component.
 */

const idArb = fc
  .tuple(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")), { minLength: 1, maxLength: 8 }))
  .map(([h, r]) => h + r.join(""));

const manifestArb = fc
  .uniqueArray(fc.tuple(fc.integer({ min: 1, max: 99 }), idArb), { minLength: 1, maxLength: 8, selector: ([n]) => n })
  .map((pairs) => ({
    scenes: pairs.map(([n, component]) => ({ id: `scene-${String(n).padStart(2, "0")}`, component })),
  }) satisfies ResolveManifest);

describe("Property 5: localized scene-file resolution", () => {
  // Property 5: localized scene-file resolution
  it("resolves an existing scene's own component → path; missing scene/file ⇒ null", () => {
    fc.assert(
      fc.asyncProperty(manifestArb, fc.integer({ min: 0, max: 7 }), async (manifest, pick) => {
        const load = async () => manifest;
        const target = manifest.scenes[pick % manifest.scenes.length]!;

        // (a) file exists ⇒ resolves to the SAME scene's component + its file.
        const all = (_p: string) => true;
        const r = await resolveSceneFile("proj", target.id, load, all);
        expect(r).not.toBeNull();
        expect(r!.componentId).toBe(target.component);
        expect(r!.path.endsWith(sceneFileName(target.component))).toBe(true);

        // (b) file does NOT exist ⇒ null.
        const none = (_p: string) => false;
        expect(await resolveSceneFile("proj", target.id, load, none)).toBeNull();

        // (c) sceneId not in manifest ⇒ null (regardless of exists).
        expect(await resolveSceneFile("proj", "scene-00-absent", load, all)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("sceneFileName never starts with '_' and is a .tsx", () => {
    fc.assert(
      fc.property(fc.oneof(idArb, fc.constantFrom("__weird", "-dash", "UPPER", "a b c")), (id) => {
        const f = sceneFileName(id);
        expect(f.endsWith(".tsx")).toBe(true);
        expect(f.startsWith("_")).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
