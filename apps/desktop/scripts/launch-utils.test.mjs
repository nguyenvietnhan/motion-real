import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { findFreePort } from "./launch-utils.mjs";

test("findFreePort leaves an occupied listener untouched", async (t) => {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  t.after(() => listener.close());
  const address = listener.address();
  assert.ok(address && typeof address !== "string");

  const result = await findFreePort(address.port, 20);
  assert.notEqual(result, address.port);
  assert.equal(listener.listening, true);
});
