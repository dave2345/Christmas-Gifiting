import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApiMiddleware, createDatabase } from "./api.js";

async function withApi(run) {
  const database = createDatabase(":memory:");
  const server = createServer(createApiMiddleware(database));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(async (url, method = "GET", body, cookie) => {
      const headers = body === undefined ? {} : { "Content-Type": "application/json" };
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
}

test("names are checked against SQLite and matches are one-to-one", async () => {
  await withApi(async (request) => {
    for (const name of ["Alex", "Blair", "Casey"]) {
      assert.equal((await request("/api/names", "POST", { name })).status, 201);
    }

    const duplicate = await request("/api/names", "POST", { name: " alex " });
    assert.equal(duplicate.status, 409);

    const unknownParticipant = await request(
      "/api/matches/check",
      "POST",
      { participant: "Not on the list" },
    );
    assert.equal(unknownParticipant.status, 404);

    const originalRandom = Math.random;
    let draw;
    try {
      Math.random = () => 0;
      draw = await request("/api/matches/check", "POST", { participant: "alex" });
    } finally {
      Math.random = originalRandom;
    }
    assert.equal(draw.status, 200);
    assert.equal(draw.body.participant, "Alex");
    assert.deepEqual(draw.body.availableRecipients, ["Casey", "Blair"]);

    const firstMatch = await request("/api/matches", "POST", {
      participant: "alex",
      recipient: draw.body.availableRecipients[0],
    });
    assert.equal(firstMatch.status, 201);
    assert.equal(firstMatch.body.match.participant, "Alex");
    assert.equal(firstMatch.body.match.recipient, draw.body.availableRecipients[0]);

    const alreadyMatched = await request("/api/matches/check", "POST", {
      participant: "Alex",
    });
    assert.equal(alreadyMatched.status, 200);
    assert.equal(alreadyMatched.body.alreadyMatched, true);
    assert.equal("match" in alreadyMatched.body, false);
    assert.equal("recipient" in alreadyMatched.body, false);
    assert.deepEqual(alreadyMatched.body.availableRecipients, []);

    const secondMatch = await request("/api/matches", "POST", {
      participant: draw.body.availableRecipients[1],
      recipient: draw.body.availableRecipients[0],
    });
    assert.equal(secondMatch.status, 409);

    const savedData = await request("/api/data");
    assert.equal("matches" in savedData.body, false);
    assert.equal(savedData.body.names.length, 3);

    const lockedMatches = await request("/api/matches");
    assert.equal(lockedMatches.status, 401);

    const setup = await request("/api/pin/setup", "POST", { pin: "1234" });
    assert.equal(setup.status, 200);
    const wrongPin = await request("/api/pin/unlock", "POST", { pin: "4321" });
    assert.equal(wrongPin.status, 401);
    const unlock = await request("/api/pin/unlock", "POST", { pin: "1234" });
    assert.equal(unlock.status, 200);
    assert.ok(unlock.cookie);
    const visibleMatches = await request("/api/matches", "GET", undefined, unlock.cookie);
    assert.equal(visibleMatches.status, 200);
    assert.equal(visibleMatches.body.matches.length, 1);
    const personalMatchWithResultsPin = await request("/api/matches/check", "POST", {
      participant: "Alex",
    });
    assert.equal(personalMatchWithResultsPin.body.alreadyMatched, true);
    assert.equal("match" in personalMatchWithResultsPin.body, false);

    const removeRecipient = await request("/api/names", "DELETE", {
      name: firstMatch.body.match.recipient,
    });
    assert.equal(removeRecipient.status, 200);
    assert.equal(removeRecipient.body.removedMatch, true);
    assert.equal(removeRecipient.body.names.length, 2);
    const removedMatchResults = await request("/api/matches", "GET", undefined, unlock.cookie);
    assert.equal(removedMatchResults.body.matches.length, 0);
  });
});

test("legacy browser data is imported once", async () => {
  await withApi(async (request) => {
    const imported = await request("/api/legacy-import", "POST", {
      data: {
        names: ["Alex", "Blair"],
        matches: { alex: { participant: "Alex", recipient: "Blair" } },
      },
    });
    assert.equal(imported.body.imported, true);
    assert.equal("matches" in imported.body, false);

    const secondImport = await request("/api/legacy-import", "POST", {
      data: { names: ["Casey"], matches: {} },
    });
    assert.equal(secondImport.body.imported, false);
    assert.deepEqual(secondImport.body.names, ["Alex", "Blair"]);
  });
});

test("the results PIN gates match lists and can only be reset with devreset", async () => {
  await withApi(async (request) => {
    await request("/api/names", "POST", { name: "Alex" });
    await request("/api/names", "POST", { name: "Blair" });
    await request("/api/matches", "POST", { participant: "Alex", recipient: "Blair" });

    const initialStatus = await request("/api/pin/status");
    assert.deepEqual(initialStatus.body, { pinIsSet: false, authorized: false });

    const setup = await request("/api/pin/setup", "POST", { pin: "2468" });
    assert.equal(setup.status, 200);
    const setStatus = await request("/api/pin/status");
    assert.deepEqual(setStatus.body, { pinIsSet: true, authorized: false });
    assert.equal((await request("/api/matches")).status, 401);

    const wrongResetPhrase = await request("/api/pin/reset", "POST", {
      phrase: "incorrect",
      pin: "1357",
    });
    assert.equal(wrongResetPhrase.status, 403);
    const oldSession = await request("/api/pin/unlock", "POST", { pin: "2468" });
    assert.equal(oldSession.status, 200);

    const reset = await request("/api/pin/reset", "POST", {
      phrase: "devreset",
      pin: "1357",
    });
    assert.equal(reset.status, 200);
    assert.equal(
      (await request("/api/matches", "GET", undefined, oldSession.cookie)).status,
      401,
    );
    const personalMatchAfterPinReset = await request("/api/matches/check", "POST", {
      participant: "Alex",
    });
    assert.equal(personalMatchAfterPinReset.status, 200);
    assert.equal(personalMatchAfterPinReset.body.alreadyMatched, true);
    assert.equal("recipient" in personalMatchAfterPinReset.body, false);

    const oldPin = await request("/api/pin/unlock", "POST", { pin: "2468" });
    assert.equal(oldPin.status, 401);
    const newPin = await request("/api/pin/unlock", "POST", { pin: "1357" });
    assert.equal(newPin.status, 200);
    const visibleMatches = await request("/api/matches", "GET", undefined, newPin.cookie);
    assert.equal(visibleMatches.status, 200);
    assert.deepEqual(visibleMatches.body.matches, [{ participant: "Alex", recipient: "Blair" }]);
  });
});
