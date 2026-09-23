import { describe, it, expect } from "vitest";
import {
  listingKeys,
  getReview,
  setReview,
  type ReviewStore,
  type Reviewable,
} from "@/lib/reviewStore";

const A: Reviewable = {
  source: "properati",
  sourceListingId: "1",
  url: "https://properati/x",
  sourceLinks: [
    { source: "properati", url: "https://properati/x" },
    { source: "fincaraiz", url: "https://fincaraiz/y" },
  ],
};

// Same physical property, but in another search it was canonicalized as fincaraiz
const B: Reviewable = {
  source: "fincaraiz",
  sourceListingId: "2",
  url: "https://fincaraiz/y",
  sourceLinks: [{ source: "fincaraiz", url: "https://fincaraiz/y" }],
};

describe("listingKeys", () => {
  it("includes every source URL plus the source:id key", () => {
    expect(listingKeys(A).sort()).toEqual(
      ["s:properati:1", "u:https://fincaraiz/y", "u:https://properati/x"].sort(),
    );
  });
});

describe("getReview / setReview", () => {
  it("is empty by default", () => {
    expect(getReview({}, A)).toEqual({ seen: false, eligible: false });
  });

  it("marks all keys of a listing and reads them back", () => {
    const store = setReview({}, A, { seen: true });
    expect(getReview(store, A).seen).toBe(true);
    expect(getReview(store, A).eligible).toBe(false);
  });

  it("propagates a mark across searches that share a source URL", () => {
    // mark via A; B shares the fincaraiz URL -> B is reviewed too
    const store = setReview({}, A, { eligible: true });
    expect(getReview(store, B).eligible).toBe(true);
  });

  it("does not mark unrelated listings", () => {
    const store = setReview({}, A, { eligible: true });
    const other: Reviewable = { source: "bienco", sourceListingId: "9", url: "https://bienco/z" };
    expect(getReview(store, other)).toEqual({ seen: false, eligible: false });
  });

  it("merges seen + eligible independently", () => {
    let store: ReviewStore = {};
    store = setReview(store, A, { seen: true });
    store = setReview(store, A, { eligible: true });
    expect(getReview(store, A)).toEqual({ seen: true, eligible: true });
    // toggling eligible off keeps seen
    store = setReview(store, A, { eligible: false });
    expect(getReview(store, A)).toEqual({ seen: true, eligible: false });
  });
});
