import { describe, expect, it } from "vitest";

import { lowerBound, upperBound } from "server/utils/binary-search.js";

describe("binary search utilities", () => {
    const compareNumber = (item: number, target: number): number => item - target;

    it("finds the first item greater than or equal to the target", () => {
        expect(lowerBound([1, 2, 2, 4], 2, compareNumber)).toBe(1);
        expect(lowerBound([1, 2, 2, 4], 3, compareNumber)).toBe(3);
        expect(lowerBound([1, 2, 2, 4], 5, compareNumber)).toBe(4);
    });

    it("finds the first item greater than the target", () => {
        expect(upperBound([1, 2, 2, 4], 2, compareNumber)).toBe(3);
        expect(upperBound([1, 2, 2, 4], 3, compareNumber)).toBe(3);
        expect(upperBound([1, 2, 2, 4], 5, compareNumber)).toBe(4);
    });
});
