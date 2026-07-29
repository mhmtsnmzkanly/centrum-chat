import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseCapacityHarnessConfig } from "../../tools/capacityHarnessConfig.ts";

Deno.test("capacity harness accepts exact localhost targets without remote approval", () => {
  for (const target of ["ws://localhost:8080/ws", "ws://127.0.0.1:8080/ws", "ws://[::1]:8080/ws"]) {
    assertEquals(
      parseCapacityHarnessConfig(["--target", target]).target.hostname,
      new URL(target).hostname,
    );
  }
});

Deno.test("capacity harness requires an explicit true value before accepting remote targets", () => {
  assertThrows(
    () => parseCapacityHarnessConfig(["--target", "wss://remote.example/ws"]),
    Error,
    "Remote targets require --allow-remote true.",
  );
  assertThrows(
    () =>
      parseCapacityHarnessConfig([
        "--target",
        "wss://remote.example/ws",
        "--allow-remote",
        "false",
      ]),
    Error,
    "Remote targets require --allow-remote true.",
  );
  assertEquals(
    parseCapacityHarnessConfig(["--target", "wss://remote.example/ws", "--allow-remote", "true"])
      .allowRemote,
    true,
  );
});

Deno.test("capacity harness rejects invalid remote approval values and localhost lookalikes", () => {
  for (const value of ["yes", "1"]) {
    assertThrows(
      () => parseCapacityHarnessConfig(["--allow-remote", value]),
      Error,
      "--allow-remote must be true or false.",
    );
  }
  assertThrows(
    () => parseCapacityHarnessConfig(["--allow-remote"]),
    Error,
    "Options must be passed as --name value pairs.",
  );
  for (
    const target of [
      "ws://localhost.example.com/ws",
      "ws://127.0.0.1.example.com/ws",
      "ws://user@remote.example/ws",
    ]
  ) {
    assertThrows(
      () => parseCapacityHarnessConfig(["--target", target]),
      Error,
      "Remote targets require --allow-remote true.",
    );
  }
});

Deno.test("capacity harness errors do not include supplied tokens", () => {
  const token = "capacity-token-must-not-leak";
  let caught: unknown;
  try {
    parseCapacityHarnessConfig(["--target", "wss://remote.example/ws", "--token", token]);
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof Error)) {
    throw new Error("Expected remote target guard to reject the request.");
  }
  assertEquals(caught.message.includes(token), false);
});
