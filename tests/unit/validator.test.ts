import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  asRecord,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requireEnum,
  requireString,
} from "../../src/shared/validation/validator.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";

Deno.test("asRecord accepts a plain object and rejects arrays/null/primitives", () => {
  assertEquals(asRecord({ a: 1 }), { a: 1 });
  assertThrows(() => asRecord(null), ValidationError);
  assertThrows(() => asRecord([1, 2]), ValidationError);
  assertThrows(() => asRecord("a string"), ValidationError);
  assertThrows(() => asRecord(42), ValidationError);
  assertThrows(() => asRecord(undefined), ValidationError);
});

Deno.test("asRecord includes the given context in the error message", () => {
  try {
    asRecord(null, "message.send data");
    throw new Error("expected asRecord to throw");
  } catch (error) {
    assertEquals((error as ValidationError).message, "message.send data must be an object.");
  }
});

Deno.test("requireString: type check, trims, and enforces minLength/maxLength/pattern", () => {
  assertEquals(requireString({ name: "  hello  " }, "name"), "hello"); // trims
  assertThrows(() => requireString({}, "name"), ValidationError); // missing
  assertThrows(() => requireString({ name: 42 }, "name"), ValidationError); // wrong type
  assertThrows(() => requireString({ name: null }, "name"), ValidationError); // null isn't a string

  assertThrows(() => requireString({ name: "ab" }, "name", { minLength: 3 }), ValidationError);
  assertEquals(requireString({ name: "abc" }, "name", { minLength: 3 }), "abc");

  assertThrows(() => requireString({ name: "abcd" }, "name", { maxLength: 3 }), ValidationError);
  assertEquals(requireString({ name: "abc" }, "name", { maxLength: 3 }), "abc");

  assertThrows(
    () => requireString({ name: "abc123" }, "name", { pattern: /^[a-z]+$/ }),
    ValidationError,
  );
  assertEquals(requireString({ name: "abc" }, "name", { pattern: /^[a-z]+$/ }), "abc");
});

Deno.test("requireString: minLength/maxLength apply to the trimmed value, not the raw one", () => {
  // "  ab  " trims to "ab" (length 2) -> should fail minLength: 3 even though the raw
  // string (with padding) is longer than 3.
  assertThrows(() => requireString({ name: "  ab  " }, "name", { minLength: 3 }), ValidationError);
});

Deno.test("requireString error includes the field name in details", () => {
  try {
    requireString({}, "displayName");
    throw new Error("expected requireString to throw");
  } catch (error) {
    assertEquals((error as ValidationError).details, { field: "displayName" });
  }
});

Deno.test("optionalString: undefined passes through as undefined, present values are validated", () => {
  assertEquals(optionalString({}, "bio"), undefined);
  assertEquals(optionalString({ bio: "hello" }, "bio"), "hello");
  assertThrows(() => optionalString({ bio: 42 }, "bio"), ValidationError);
  // Explicit null is treated as "absent" -- returning undefined.
  assertEquals(optionalString({ bio: null }, "bio"), undefined);
});

Deno.test("optionalInteger: undefined passes through, validates type/integer-ness/bounds", () => {
  assertEquals(optionalInteger({}, "coverIndex"), undefined);
  assertEquals(optionalInteger({ coverIndex: 3 }, "coverIndex"), 3);
  assertThrows(() => optionalInteger({ coverIndex: "3" }, "coverIndex"), ValidationError);
  assertThrows(() => optionalInteger({ coverIndex: 3.5 }, "coverIndex"), ValidationError);
  assertThrows(
    () => optionalInteger({ coverIndex: -1 }, "coverIndex", { min: 0 }),
    ValidationError,
  );
  assertEquals(optionalInteger({ coverIndex: 0 }, "coverIndex", { min: 0 }), 0);
  assertThrows(
    () => optionalInteger({ coverIndex: 11 }, "coverIndex", { max: 10 }),
    ValidationError,
  );
});

Deno.test("optionalBoolean: undefined passes through, rejects non-boolean values", () => {
  assertEquals(optionalBoolean({}, "unreadOnly"), undefined);
  assertEquals(optionalBoolean({ unreadOnly: true }, "unreadOnly"), true);
  assertEquals(optionalBoolean({ unreadOnly: false }, "unreadOnly"), false);
  assertThrows(() => optionalBoolean({ unreadOnly: "true" }, "unreadOnly"), ValidationError);
  assertThrows(() => optionalBoolean({ unreadOnly: 1 }, "unreadOnly"), ValidationError);
});

Deno.test("requireEnum: accepts only listed values", () => {
  const allowed = ["online", "idle", "dnd", "offline"] as const;
  assertEquals(requireEnum({ status: "idle" }, "status", allowed), "idle");
  assertThrows(() => requireEnum({ status: "sleeping" }, "status", allowed), ValidationError);
  assertThrows(() => requireEnum({}, "status", allowed), ValidationError);
});

Deno.test("optionalEnum: undefined passes through, present values still validated against the list", () => {
  const allowed = ["everyone", "group_members", "no_one"] as const;
  assertEquals(optionalEnum({}, "dmPrivacy", allowed), undefined);
  assertEquals(optionalEnum({ dmPrivacy: "no_one" }, "dmPrivacy", allowed), "no_one");
  assertThrows(
    () => optionalEnum({ dmPrivacy: "sometimes" }, "dmPrivacy", allowed),
    ValidationError,
  );
});
