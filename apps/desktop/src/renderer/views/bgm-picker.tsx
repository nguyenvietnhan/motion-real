import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BgmTrackVM } from "../../shared/types.js";
import { Icon } from "../icons.js";
import { useDismissable } from "../use-dismissable.js";
import { useMenuNavigation } from "../use-menu-navigation.js";
import { placeDiagPanel, type DiagPanelPlacement } from "./diag-panel-placement.js";

const BGM_MENU_WIDTH_PX = 268;

/**
 * Background-music picker: compact dropdown of the per-machine BGM library +
 * add/remove. Used on Home create knobs (skip_edit needs a choice before
 * auto-full) and on the storyboard toolbar (change before explicit full).
 * "Không nhạc" clears the selection. Preview uses a local media:// URL only.
 */
export const BgmPicker: React.FC<{
  bgm: BgmTrackVM[];
  selected: string | null;
  busy?: boolean;
  onAdd: () => void;
  onRemove: (name: string) => Promise<void>;
  onSelect: (name: string | null) => void | Promise<void>;
  /** Optional class on the root (e.g. create knobs density). */
  className?: string;
}> = ({ bgm, selected, busy = false, onAdd, onRemove, onSelect, className }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<DiagPanelPlacement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const missing = selected !== null && !bgm.some((t) => t.name === selected);
  const selectedTrack = bgm.find((t) => t.name === selected);

  const updatePlacement = useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPlacement(
      placeDiagPanel(
        trigger.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { preferredWidth: BGM_MENU_WIDTH_PX, preferredMaxHeight: 360 },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
  }, [open, updatePlacement, bgm.length]);

  useEffect(() => {
    if (!open) return;
    const onReposition = (): void => updatePlacement();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePlacement]);

  const closeMenu = useCallback(() => setOpen(false), []);
  useDismissable(open, closeMenu, rootRef);
  const menu = useMenuNavigation(open, closeMenu, triggerRef, menuRef);

  useEffect(() => () => audioRef.current?.pause(), []);

  const stopPreview = (): void => {
    audioRef.current?.pause();
    setPreviewing(null);
  };
  const choose = (name: string | null): void => {
    stopPreview();
    void onSelect(name);
    menu.close();
  };
  const togglePreview = (track: BgmTrackVM): void => {
    const audio = audioRef.current;
    if (!audio || !track.previewUrl) return;
    if (previewing === track.name && !audio.paused) {
      stopPreview();
      return;
    }
    audio.pause();
    audio.src = track.previewUrl;
    audio.currentTime = 0;
    void audio
      .play()
      .then(() => setPreviewing(track.name))
      .catch(() => setPreviewing(null));
  };

  return (
    <div className={["ns-bgm-picker", className].filter(Boolean).join(" ")} ref={rootRef}>
      <audio ref={audioRef} onEnded={() => setPreviewing(null)} />
      <div className="ns-bgm-control">
        <button
          ref={triggerRef}
          className="ns-bgm-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          disabled={busy}
          title="Nhạc nền"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ns-bgm-leading">{Icon.music({ size: 15 })}</span>
          <span className="ns-bgm-current">{selectedTrack?.label ?? (missing ? selected : "Không nhạc")}</span>
          <span className="ns-bgm-chevron">{Icon.chevronDown({ size: 14 })}</span>
        </button>
        <button className="ns-bgm-add" type="button" aria-label="Thêm nhạc" title="Thêm nhạc" disabled={busy} onClick={onAdd}>
          {Icon.plus({ size: 15 })}
        </button>
      </div>

      {open && placement && (
        <div
          ref={menuRef}
          className="ns-bgm-menu"
          role="menu"
          aria-label="Nhạc nền"
          onKeyDown={menu.onKeyDown}
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
        >
          <div className="ns-bgm-row">
            <span className="ns-bgm-preview-spacer" />
            <button
              className="ns-bgm-choice"
              type="button"
              role="menuitemradio"
              aria-checked={selected === null}
              disabled={busy}
              onClick={() => choose(null)}
            >
              <span className="ns-bgm-name">Không nhạc</span>
              {selected === null && <span className="ns-bgm-check">{Icon.check({ size: 14 })}</span>}
            </button>
          </div>

          {missing && <div className="ns-bgm-missing">Không tìm thấy “{selected}”. Chọn bài khác.</div>}

          {bgm.map((track) => (
            <div className="ns-bgm-row" key={track.name}>
              <button
                className="ns-bgm-preview"
                type="button"
                aria-label={`${previewing === track.name ? "Dừng" : "Nghe thử"} ${track.label}`}
                title={previewing === track.name ? "Dừng nghe thử" : "Nghe thử"}
                disabled={busy}
                onClick={() => togglePreview(track)}
              >
                {previewing === track.name ? Icon.pause({ size: 13 }) : Icon.play({ size: 13 })}
              </button>
              <button
                className="ns-bgm-choice"
                type="button"
                role="menuitemradio"
                aria-checked={selected === track.name}
                disabled={busy}
                onClick={() => choose(track.name)}
              >
                <span className="ns-bgm-track-copy">
                  <span className="ns-bgm-name">{track.label}</span>
                  <span className="ns-bgm-size">{track.sizeLabel}</span>
                </span>
                {selected === track.name && <span className="ns-bgm-check">{Icon.check({ size: 14 })}</span>}
              </button>
              {!track.builtIn && (
                <button
                  className="ns-bgm-remove"
                  type="button"
                  aria-label={`Xoá ${track.label}`}
                  title="Xoá khỏi thư viện"
                  disabled={busy}
                  onClick={() => void onRemove(track.name)}
                >
                  {Icon.trash({ size: 13 })}
                </button>
              )}
            </div>
          ))}

          {bgm.length === 0 && <div className="ns-bgm-empty">Chưa có nhạc nền. Thêm bằng nút +.</div>}
        </div>
      )}
    </div>
  );
};
