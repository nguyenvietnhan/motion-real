import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";

const FACES: Array<[family: string, weight: string, file: string]> = [
  ["Literata", "900", "Literata-900"],
  ["Be Vietnam Pro", "400", "BeVietnamPro-400"],
  ["Be Vietnam Pro", "600", "BeVietnamPro-600"],
  ["Be Vietnam Pro", "900", "BeVietnamPro-900"],
  ["IBM Plex Mono", "400", "IBMPlexMono-400"],
  ["IBM Plex Mono", "600", "IBMPlexMono-600"],
  ["Archivo", "900", "Archivo-900"],
];

let loaded = false;

export const ensureFonts = (): void => {
  if (loaded) return;
  loaded = true;
  for (const [family, weight, file] of FACES) {
    for (const subset of ["vietnamese", "latin"]) {
      loadFont({
        family,
        style: "normal",
        weight,
        url: staticFile(`fonts/${file}-${subset}.woff2`),
      });
    }
  }
};
