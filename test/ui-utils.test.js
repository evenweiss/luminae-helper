import { describe, it, expect } from "vitest";
import { padChoice, parseCheckboxResult } from "../src/lib/ui.js";

describe("padChoice", () => {
  it("pads short text to target width", () => {
    const result = padChoice("hello", 10);
    expect(result).toBe("hello     ");
  });

  it("does not pad text at or beyond target width", () => {
    const result = padChoice("hello world!!", 10);
    expect(result).toBe("hello world!!");
  });

  it("strips ANSI codes before measuring width", () => {
    const result = padChoice("\x1b[31mhello\x1b[0m", 10);
    expect(result).toBe("\x1b[31mhello\x1b[0m     ");
  });

  it("handles empty string", () => {
    const result = padChoice("", 5);
    expect(result).toBe("     ");
  });

  it("accounts for CJK double-width characters via wcswidth", () => {
    // 一个中文字 wcswidth=2，"你好"=4，targetWidth=10 应补 6 个空格
    const result = padChoice("你好", 10);
    expect(result).toBe("你好      ");
  });
});

describe("parseCheckboxResult", () => {
  it('returns "back" for "back" string', () => {
    expect(parseCheckboxResult("back")).toBe("back");
  });

  it('returns "back" for "__back__" string', () => {
    expect(parseCheckboxResult("__back__")).toBe("back");
  });

  it('returns "exit" for "exit" string', () => {
    expect(parseCheckboxResult("exit")).toBe("exit");
  });

  it('returns "exit" for "__exit__" string', () => {
    expect(parseCheckboxResult("__exit__")).toBe("exit");
  });

  it('returns "exit" when array contains "__exit__"', () => {
    expect(parseCheckboxResult(["identity", "__exit__"])).toBe("exit");
  });

  it('returns "back" when array contains "__back__"', () => {
    expect(parseCheckboxResult(["identity", "__back__"])).toBe("back");
  });

  it("returns the array when it contains only skill ids", () => {
    const arr = ["identity", "git-commit"];
    expect(parseCheckboxResult(arr)).toEqual(arr);
  });

  it("filters out __back__ and __exit__ from array", () => {
    // 包含 __back__ 时直接返回 "back"，不会走到 filter
    expect(parseCheckboxResult(["identity", "__back__", "git-commit"])).toBe("back");
    // 包含 __exit__ 时直接返回 "exit"
    expect(parseCheckboxResult(["identity", "__exit__"])).toBe("exit");
  });

  it('returns "back" for esc_timeout', () => {
    expect(parseCheckboxResult("esc_timeout")).toBe("back");
  });

  it("returns back for non-special values as fallback", () => {
    expect(parseCheckboxResult("other")).toBe("back");
  });
});
