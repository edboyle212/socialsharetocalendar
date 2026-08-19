import { describe, it, expect } from "vitest";
import { extractMentions } from "../src/lib/meta.js";

describe("extractMentions", () => {
  it("pulls comment mention events with media_id + comment_id", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: "17841400000000000",
          time: 1700000000,
          changes: [
            {
              field: "mentions",
              value: { media_id: "media-1", comment_id: "comment-1" },
            },
          ],
        },
      ],
    };
    const out = extractMentions(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.ig_user_id).toBe("17841400000000000");
    expect(out[0]!.media_id).toBe("media-1");
    expect(out[0]!.comment_id).toBe("comment-1");
  });

  it("keeps caption mentions (comment_id absent) — worker skips them", () => {
    const body = {
      entry: [
        {
          id: "ig-user",
          changes: [
            { field: "mentions", value: { media_id: "media-2" } },
          ],
        },
      ],
    };
    const out = extractMentions(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.comment_id).toBeUndefined();
  });

  it("ignores non-mentions change fields", () => {
    const body = {
      entry: [
        {
          id: "ig-user",
          changes: [
            { field: "comments", value: { media_id: "media-3", comment_id: "c-3" } },
          ],
        },
      ],
    };
    expect(extractMentions(body)).toEqual([]);
  });

  it("returns empty on non-instagram bodies", () => {
    expect(extractMentions({})).toEqual([]);
    expect(extractMentions({ entry: [] })).toEqual([]);
    expect(extractMentions({ entry: [{ id: "x" }] })).toEqual([]);
  });
});
