import { describe, expect, test } from "vitest";
import { formatPhone, parsePhone, phoneReadBack } from "./phone";

const parsed: [string, string, boolean][] = [
  ["five five five one two three four five six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["555-123-4567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["(555) 123 4567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["5551234567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["555.123.4567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["my number is 555 123 4567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["it's five five five, one two three, four five six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["two one two five five five oh one two three", "2125550123", true],
  ["two one two five five five zero one two three", "2125550123", true],
  ["double five five one two three four five six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["two one two triple five oh one double two", "2125550122", true],
  ["two one two five five five oh double one oh", "2125550110", true],
  ["cinco cinco cinco uno dos tres cuatro cinco seis siete", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["mi número es dos uno dos cinco cinco cinco cero uno dos tres", "2125550123", true],
  ["doble cinco cinco uno dos tres cuatro cinco seis siete", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["five five five two three four five six seven eight", "5552345678", true],
  ["555 one two three 45 six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["1 555 123 4567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["+1 (555) 123-4567", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["plus one five five five one two three four five six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["one five five five one two three four five six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["oh, it's five five five one two three four five six seven", "5551234567", false], // parses; exchange 123 starts with 1 → not NANP
  ["two one two five fifty five oh one hundred", "2125550100", true],
  ["dos uno dos cinco cinco cinco cero uno cero cero", "2125550100", true],
  // invalid
  ["five five five one two three", "555123", false],
  ["555 123 45678", "55512345678", false],
  ["055 123 4567", "0551234567", false],
  ["155 123 4567", "1551234567", false],
  ["555 023 4567", "5550234567", false],
  ["555 123 4567 8", "55512345678", false],
  ["(555) 010-0000", "5550100000", false], // addendum display placeholder: exchange starts with 0
];

describe("parsePhone", () => {
  test.each(parsed)("%j → %s (valid=%s)", (text, digits, valid) => {
    expect(parsePhone(text)).toEqual({ digits, valid });
  });

  test.each(["", "my number is", "I don't want to give it", "no gracias", "oh"])("%j → null", (text) => {
    expect(parsePhone(text)).toBeNull();
  });

  test("fictional NXX-555-01XX numbers are valid (demo must complete)", () => {
    expect(parsePhone("(212) 555-0100")?.valid).toBe(true);
    expect(parsePhone("(555) 555-0199")?.valid).toBe(true);
  });
});

describe("formatPhone", () => {
  test("10 digits", () => expect(formatPhone("5551234567")).toBe("(555) 123-4567"));
  test("short unchanged", () => expect(formatPhone("555123")).toBe("555123"));
  test("11 unchanged", () => expect(formatPhone("15551234567")).toBe("15551234567"));
  test("empty unchanged", () => expect(formatPhone("")).toBe(""));
});

describe("phoneReadBack", () => {
  test("EN", () => {
    expect(phoneReadBack("5551234567", "en")).toBe("five five five, one two three, four five six seven");
  });
  test("ES", () => {
    expect(phoneReadBack("5551234567", "es")).toBe("cinco cinco cinco, uno dos tres, cuatro cinco seis siete");
  });
  test("EN zeros are 'zero', not 'oh'", () => {
    expect(phoneReadBack("2125550100", "en")).toBe("two one two, five five five, zero one zero zero");
  });
  test("ES zeros", () => {
    expect(phoneReadBack("2125550100", "es")).toBe("dos uno dos, cinco cinco cinco, cero uno cero cero");
  });
  test("non-10-digit read as one group", () => {
    expect(phoneReadBack("555123", "en")).toBe("five five five one two three");
  });
});
