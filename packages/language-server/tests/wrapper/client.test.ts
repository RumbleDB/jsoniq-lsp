import { describe, expect, it } from "vitest";

import { getWrapperClient } from "server/wrapper/client";

describe("wrapper client surface", () => {
    it("exports a singleton wrapper client", () => {
        expect(getWrapperClient()).toBeDefined();
    });

    it("starts with unknown rumble version", () => {
        expect(getWrapperClient().getRumbleVersion()).toBeNull();
    });

    it("dispose can be called safely", () => {
        expect(() => getWrapperClient().dispose()).not.toThrow();
    });

    it("after connect, rumble version is set", async () => {
        const client = getWrapperClient();
        await expect(client.connect()).resolves.toBeUndefined();
        expect(client.getRumbleVersion()).toBeDefined();
    }, 30_000);
});
