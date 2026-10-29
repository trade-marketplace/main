"use client";

import { useEffect } from "react";

/** M05 is a keyboard cue. Pointer focus still works, including programmatic focus after a click. */
export function FocusVisibility() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => { root.dataset.focusInput = "pointer"; };
    const keyboard = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const editing = target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLInputElement && !["checkbox", "radio", "range", "color", "file", "button", "submit", "reset"].includes(target.type));
      const suggestionKey = target instanceof Element && target.getAttribute("role") === "combobox" && ["ArrowDown", "ArrowUp"].includes(event.key);
      // Typing or moving the caret after clicking a field must not bring the ring back.
      if (event.key === "Tab" || suggestionKey || (!editing && !["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key))) {
        delete root.dataset.focusInput;
      }
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      delete root.dataset.focusInput;
    };
  }, []);
  return null;
}
