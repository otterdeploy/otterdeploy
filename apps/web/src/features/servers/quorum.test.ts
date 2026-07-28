import { describe, expect, test } from "vite-plus/test";

import { failuresTolerated, managerPromotionWarning, promotionAddsResilience } from "./quorum";

describe("failuresTolerated", () => {
  test("matches Raft's majority rule", () => {
    expect(failuresTolerated(1)).toBe(0);
    // The whole point: two managers tolerate no more than one does.
    expect(failuresTolerated(2)).toBe(0);
    expect(failuresTolerated(3)).toBe(1);
    expect(failuresTolerated(4)).toBe(1);
    expect(failuresTolerated(5)).toBe(2);
    expect(failuresTolerated(7)).toBe(3);
  });

  test("a swarm with no managers tolerates nothing", () => {
    expect(failuresTolerated(0)).toBe(0);
  });
});

describe("promotionAddsResilience", () => {
  test("only odd targets buy anything", () => {
    expect(promotionAddsResilience(1)).toBe(false); // 1 -> 2 buys nothing
    expect(promotionAddsResilience(2)).toBe(true); //  2 -> 3 buys one failure
    expect(promotionAddsResilience(3)).toBe(false); // 3 -> 4 buys nothing
    expect(promotionAddsResilience(4)).toBe(true); //  4 -> 5 buys one more
  });
});

describe("managerPromotionWarning", () => {
  test("warns on the two-server case, which is the one people hit", () => {
    const warning = managerPromotionWarning(1);
    expect(warning).not.toBeNull();
    expect(warning).toContain("less available");
    expect(warning).toContain("worker");
  });

  test("stays silent when the promotion is sound", () => {
    expect(managerPromotionWarning(2)).toBeNull();
    expect(managerPromotionWarning(4)).toBeNull();
  });

  test("warns on any even target, not just two", () => {
    expect(managerPromotionWarning(3)).toContain("no extra failures");
  });
});
