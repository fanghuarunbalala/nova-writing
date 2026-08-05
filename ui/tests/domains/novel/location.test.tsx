/**
 * location 子域测试。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Location, NovelApiClient, NovelLocationsSnapshot } from "@novel/core";
import { LocationStore } from "../../../src/domains/novel/location/store/LocationStore.js";
import { LocationGrid } from "../../../src/domains/novel/location/components/LocationGrid.js";
import { LocationDetailPanel } from "../../../src/domains/novel/location/components/LocationDetailPanel.js";

const location: Location = {
  id: "loc-dock7",
  entityVersion: 2,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  name: "旧船坞",
  aliases: ["第七号码头"],
  summary: "雨夜命案的发生地",
  authorNotes: "灯塔与船坞的距离是 200 米",
};

function listSnapshot(): NovelLocationsSnapshot {
  return {
    schemaVersion: 1,
    scope: { kind: "canonical" },
    locations: [location],
  };
}

function buildApi(overrides: Partial<NovelApiClient["novel"]["locations"]> = {}): NovelApiClient {
  return {
    conversations: {} as never,
    novel: {
      overview: {} as never,
      outline: {} as never,
      manuscript: {} as never,
      characters: {} as never,
      locations: {
        list: vi.fn(async () => listSnapshot()),
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          location,
        })),
        ...overrides,
      },
    },
  } as unknown as NovelApiClient;
}

describe("LocationStore", () => {
  it("loads location summaries with filed state", async () => {
    const store = new LocationStore({ api: buildApi() });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.locations[0]).toMatchObject({
      locationId: "loc-dock7",
      name: "旧船坞",
      role: "第七号码头",
      locState: "filed",
      note: "雨夜命案的发生地",
    });
  });

  it("loads and caches details", async () => {
    const api = buildApi();
    const store = new LocationStore({ api });
    await store.loadWorkspace("w1");
    await store.loadDetail("loc-dock7");
    const detail = store.getSnapshot().detailCache.get("loc-dock7");
    expect(detail?.profile).toBe("灯塔与船坞的距离是 200 米");
    expect(api.novel.locations.get).toHaveBeenCalledTimes(1);
  });

  it("tracks selection and records load errors", async () => {
    const store = new LocationStore({ api: buildApi() });
    await store.loadWorkspace("w1");
    store.selectLocation("loc-dock7");
    expect(store.getSnapshot().selectedId).toBe("loc-dock7");
    const failing = new LocationStore({
      api: buildApi({
        list: vi.fn(async () => {
          throw new Error("down");
        }),
      }),
    });
    await failing.loadWorkspace("w1");
    expect(failing.getSnapshot().phase).toBe("error");
  });
});

describe("location components", () => {
  it("renders a grid and fires selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LocationGrid
        workspaceId="w1"
        locations={[
          { locationId: "loc-dock7", avatarText: "旧", name: "旧船坞", role: "第七号码头", locState: "filed", note: "雨夜命案", relatedUnits: [] },
        ]}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByText("旧船坞"));
    expect(onSelect).toHaveBeenCalledWith("loc-dock7");
    expect(screen.getByText("已建档")).toBeInTheDocument();
  });

  it("renders detail and loading placeholder", () => {
    render(<LocationDetailPanel workspaceId="w1" locationId="loc-dock7" />);
    expect(screen.getByText(/加载地点详情/)).toBeInTheDocument();
    render(
      <LocationDetailPanel
        workspaceId="w1"
        locationId="loc-dock7"
        detail={{ locationId: "loc-dock7", avatarText: "旧", name: "旧船坞", role: "第七号码头", locState: "filed", profile: "距离 200 米", relatedUnits: [] }}
      />,
    );
    expect(screen.getByText("距离 200 米")).toBeInTheDocument();
  });
});
