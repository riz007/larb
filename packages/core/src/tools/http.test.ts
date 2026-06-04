import { describe, it, expect, vi } from "vitest";
import { httpFetchTool } from "./http.js";
import type { ToolContext } from "./types.js";

function ctxWith(require: ToolContext["permission"]["require"]): ToolContext {
  return { permission: { require } } as unknown as ToolContext;
}

describe("http_fetch tool", () => {
  it("requires net permission for the target host before fetching", async () => {
    const require = vi.fn().mockRejectedValue(new Error("Permission denied: net"));
    await expect(
      httpFetchTool.execute({ url: "https://api.example.com/data" }, ctxWith(require)),
    ).rejects.toThrow(/permission denied/i);
    expect(require).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "net", host: "api.example.com" }),
    );
  });

  it("rejects an invalid URL without asking for permission", async () => {
    const require = vi.fn();
    const res = await httpFetchTool.execute({ url: "not a url" }, ctxWith(require));
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/invalid url/i);
    expect(require).not.toHaveBeenCalled();
  });
});
