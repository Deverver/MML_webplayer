// tests/app.test.js
import request from "supertest";
import { describe, it, expect } from "vitest";
import server from "../server.js";

/*
  We’re testing that our Express routes and controllers:
  1. Respond with HTTP 200 status
  2. Return the correct message in JSON
*/

describe("Express App Routes", () => {
    it("GET / should return the songs page", async () => {
        const {melodyOnly, melodyPlusHarmony, fullSongs} = await request(server).get("/songs");
        const res = await fetch("/songs");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            categorized:{melodyOnly, melodyPlusHarmony, fullSongs}
        });
    });

    it("GET /songs/songIndex should return specific song data", async () => {
        const response = await request(server).get("/songs/4");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: "About Us - We build amazing apps!",
        });
    });
});