import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resetShortcutsForTests, useShortcutsPreference } from "./shortcuts";

afterEach(() => {
  window.localStorage.clear();
  resetShortcutsForTests();
});

describe("useShortcutsPreference", () => {
  it("is on until the person turns it off, and remembers that", () => {
    const { result } = renderHook(() => useShortcutsPreference());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("helpdesk.shortcuts")).toBe("off");
  });

  it("keeps single letters off for someone who turned them off in an earlier version", () => {
    window.localStorage.setItem("earlier.shortcuts", "off");
    const { result } = renderHook(() => useShortcutsPreference());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("helpdesk.shortcuts")).toBe("off");
    expect(window.localStorage.getItem("earlier.shortcuts")).toBeNull();
    // Turning them on again sticks: the earlier choice is gone.
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it("leaves other stored values alone", () => {
    window.localStorage.setItem("helpdesk.theme", "dark");
    const { result } = renderHook(() => useShortcutsPreference());
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("helpdesk.theme")).toBe("dark");
  });
});
