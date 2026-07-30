import { describe, expect, it } from "vitest";
import {
  bucketCountsByDate,
  computeBranchSplit,
  countDistinctUsers,
  countPlans,
  countSubscriptionStatuses,
  listUtcDatesEndingToday,
  rankTopUsers,
  summarizeDailyActivity,
} from "@/lib/server/admin-analytics";

describe("listUtcDatesEndingToday", () => {
  it("returns the requested number of UTC dates ending today, ascending", () => {
    const dates = listUtcDatesEndingToday(7, new Date("2026-07-29T15:04:00.000Z"));

    expect(dates).toEqual([
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
    ]);
  });

  it("rolls over month boundaries", () => {
    const dates = listUtcDatesEndingToday(30, new Date("2026-07-01T00:30:00.000Z"));

    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-06-02");
    expect(dates[29]).toBe("2026-07-01");
  });
});

describe("bucketCountsByDate", () => {
  const dates = ["2026-07-27", "2026-07-28", "2026-07-29"];

  it("buckets timestamps per day and fills missing days with zero", () => {
    expect(
      bucketCountsByDate(dates, [
        "2026-07-29T10:00:00.000Z",
        "2026-07-29T22:30:00.000Z",
        "2026-07-27T01:00:00.000Z",
      ]),
    ).toEqual([
      { date: "2026-07-27", count: 1 },
      { date: "2026-07-28", count: 0 },
      { date: "2026-07-29", count: 2 },
    ]);
  });

  it("ignores timestamps outside the requested range", () => {
    expect(
      bucketCountsByDate(dates, ["2026-06-01T00:00:00.000Z"]),
    ).toEqual([
      { date: "2026-07-27", count: 0 },
      { date: "2026-07-28", count: 0 },
      { date: "2026-07-29", count: 0 },
    ]);
  });
});

describe("countPlans", () => {
  it("normalizes legacy team plans to max and defaults unknown values to free", () => {
    expect(
      countPlans(["team", "max", "pro", null, undefined, "free", "enterprise"]),
    ).toEqual({ free: 4, pro: 1, max: 2 });
  });

  it("counts an empty input as all zeros", () => {
    expect(countPlans([])).toEqual({ free: 0, pro: 0, max: 0 });
  });
});

describe("countSubscriptionStatuses", () => {
  it("counts statuses and defaults blank values to inactive", () => {
    expect(
      countSubscriptionStatuses(["active", "active", null, "  ", "canceled"]),
    ).toEqual({ active: 2, inactive: 2, canceled: 1 });
  });
});

describe("countDistinctUsers", () => {
  const rows = [
    { userId: "user_a", date: "2026-07-29" },
    { userId: "user_a", date: "2026-07-29" },
    { userId: "user_b", date: "2026-07-28" },
    { userId: "user_c", date: "2026-07-01" },
  ];

  it("counts each user once within the window", () => {
    expect(countDistinctUsers(rows, "2026-07-28")).toBe(2);
  });

  it("excludes rows older than the window", () => {
    expect(countDistinctUsers(rows, "2026-07-29")).toBe(1);
  });
});

describe("summarizeDailyActivity", () => {
  it("counts distinct users and messages per day with zero fill", () => {
    const dates = ["2026-07-27", "2026-07-28", "2026-07-29"];

    expect(
      summarizeDailyActivity(
        [
          { userId: "user_a", date: "2026-07-29", messageCount: 3 },
          { userId: "user_a", date: "2026-07-29", messageCount: 2 },
          { userId: "user_b", date: "2026-07-29", messageCount: 1 },
          { userId: "user_c", date: "2026-07-27", messageCount: 4 },
        ],
        dates,
      ),
    ).toEqual([
      { date: "2026-07-27", activeUsers: 1, messages: 4 },
      { date: "2026-07-28", activeUsers: 0, messages: 0 },
      { date: "2026-07-29", activeUsers: 2, messages: 6 },
    ]);
  });
});

describe("rankTopUsers", () => {
  it("aggregates per user, sorts by messages, and truncates to the limit", () => {
    const rows = [
      { userId: "user_a", date: "2026-07-29", messageCount: 2 },
      { userId: "user_b", date: "2026-07-29", messageCount: 5 },
      { userId: "user_a", date: "2026-07-28", messageCount: 4 },
      { userId: "user_c", date: "2026-07-29", messageCount: 1 },
    ];

    expect(rankTopUsers(rows, 2)).toEqual([
      { userId: "user_a", messages: 6 },
      { userId: "user_b", messages: 5 },
    ]);
  });

  it("breaks ties by user id for a stable order", () => {
    const rows = [
      { userId: "user_b", date: "2026-07-29", messageCount: 3 },
      { userId: "user_a", date: "2026-07-29", messageCount: 3 },
    ];

    expect(rankTopUsers(rows)).toEqual([
      { userId: "user_a", messages: 3 },
      { userId: "user_b", messages: 3 },
    ]);
  });

  it("defaults to a top-10 list", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      userId: `user_${String(index).padStart(2, "0")}`,
      date: "2026-07-29",
      messageCount: index + 1,
    }));

    const top = rankTopUsers(rows);

    expect(top).toHaveLength(10);
    expect(top[0]).toEqual({ userId: "user_11", messages: 12 });
  });
});

describe("computeBranchSplit", () => {
  it("returns counts and shares that add up to one", () => {
    const split = computeBranchSplit(3, 1);

    expect(split.continueCount).toBe(3);
    expect(split.branchCount).toBe(1);
    expect(split.continueShare).toBe(0.75);
    expect(split.branchShare).toBe(0.25);
  });

  it("returns zero shares when there are no nodes", () => {
    expect(computeBranchSplit(0, 0)).toEqual({
      continueCount: 0,
      branchCount: 0,
      continueShare: 0,
      branchShare: 0,
    });
  });
});
