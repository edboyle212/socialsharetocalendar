import { describe, it, expect } from "vitest";
import { extractShareMessages } from "../src/lib/meta.js";

describe("extractShareMessages", () => {
  it("pulls share attachments per sender", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          messaging: [
            {
              sender: { id: "user-a" },
              message: {
                attachments: [
                  { type: "share", payload: { url: "https://cdn/x.jpg", id: "media-1" } },
                ],
              },
            },
            {
              sender: { id: "user-b" },
              message: { attachments: [{ type: "unknown", payload: {} }] },
            },
          ],
        },
      ],
    };
    const out = extractShareMessages(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.sender_id).toBe("user-a");
    expect(out[0]!.attachments[0]!.payload.id).toBe("media-1");
  });

  it("returns empty on non-messaging bodies", () => {
    expect(extractShareMessages({})).toEqual([]);
    expect(extractShareMessages({ entry: [] })).toEqual([]);
  });

  it("surfaces plain text messages for command handling", () => {
    const body = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "user-c" },
              message: { mid: "m-1", text: "DELETE MY DATA" },
            },
          ],
        },
      ],
    };
    const out = extractShareMessages(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("DELETE MY DATA");
    expect(out[0]!.mid).toBe("m-1");
    expect(out[0]!.attachments).toEqual([]);
  });
});
