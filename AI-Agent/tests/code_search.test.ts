/**
 * Tests for code search tools
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  grep_search_ripgrep,
  grep_search_fallback,
} from "../src/utils/tools/code_search.js";

describe("Code Search Tools", () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `code-search-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create test files
    await fs.writeFile(
      path.join(testDir, "test1.ts"),
      `
function hello() {
  console.log("Hello World");
}

export function testFunction() {
  return "test";
}
`
    );

    await fs.writeFile(
      path.join(testDir, "test2.js"),
      `
const greeting = "Hello";

function sayHello() {
  console.log(greeting);
}
`
    );

    await fs.writeFile(
      path.join(testDir, "test3.py"),
      `
def hello_world():
    print("Hello World")
    
class TestClass:
    pass
`
    );

    // Create subdirectory
    const subDir = path.join(testDir, "subdir");
    await fs.mkdir(subDir);
    await fs.writeFile(
      path.join(subDir, "nested.ts"),
      `
export const HELLO_CONSTANT = "hello";
`
    );
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to clean up test directory:", error);
    }
  });

  describe("grep_search_ripgrep", () => {
    it("should find matches for a simple pattern", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "hello",
        dir_path: testDir,
      });

      expect(result).toContain("Found");
      expect(result).toContain("hello");
    });

    it("should filter by file extension", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "hello",
        dir_path: testDir,
        include: "*.ts",
      });

      expect(result).toContain("test1.ts");
      expect(result).not.toContain("test2.js");
      expect(result).not.toContain("test3.py");
    });

    it("should handle case sensitivity", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "HELLO",
        dir_path: testDir,
        case_sensitive: true,
      });

      // Should find HELLO_CONSTANT but not "hello"
      expect(result).toContain("HELLO_CONSTANT");
    });

    it("should return no matches for non-existent pattern", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "nonexistentpattern12345",
        dir_path: testDir,
      });

      expect(result).toContain("No matches found");
    });

    it("should handle invalid directory path", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "hello",
        dir_path: "/nonexistent/path/12345",
      });

      expect(result).toContain("failed");
    });

    it("should search with regex pattern", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "function\\s+\\w+",
        dir_path: testDir,
      });

      expect(result).toContain("function");
    });

    it("should limit results", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: ".",
        dir_path: testDir,
        max_results: 5,
      });

      expect(result).toContain("Found");
      // Should be limited
      const matches = result.match(/L\d+:/g);
      expect(matches?.length).toBeLessThanOrEqual(5);
    });
  });

  describe("grep_search_fallback", () => {
    it("should find matches using fallback strategies", async () => {
      const result = await grep_search_fallback.invoke({
        pattern: "hello",
        dir_path: testDir,
      });

      expect(result).toContain("Found");
      expect(result).toContain("hello");
      expect(result).toContain("Strategy used:");
    });

    it("should filter by file extension", async () => {
      const result = await grep_search_fallback.invoke({
        pattern: "function",
        dir_path: testDir,
        include: "*.js",
      });

      expect(result).toContain("test2.js");
    });

    it("should return no matches for non-existent pattern", async () => {
      const result = await grep_search_fallback.invoke({
        pattern: "nonexistentpattern12345",
        dir_path: testDir,
      });

      expect(result).toContain("No matches found");
    });

    it("should handle max_results parameter", async () => {
      const result = await grep_search_fallback.invoke({
        pattern: ".",
        dir_path: testDir,
        max_results: 3,
      });

      expect(result).toContain("Found");
    });
  });

  describe("Integration tests", () => {
    it("both tools should find the same pattern", async () => {
      const pattern = "testFunction";

      const ripgrepResult = await grep_search_ripgrep.invoke({
        pattern,
        dir_path: testDir,
      });

      const fallbackResult = await grep_search_fallback.invoke({
        pattern,
        dir_path: testDir,
      });

      // Both should find the pattern
      expect(ripgrepResult).toContain("testFunction");
      expect(fallbackResult).toContain("testFunction");
    });

    it("should search in subdirectories", async () => {
      const result = await grep_search_ripgrep.invoke({
        pattern: "HELLO_CONSTANT",
        dir_path: testDir,
      });

      expect(result).toContain("nested.ts");
      expect(result).toContain("HELLO_CONSTANT");
    });
  });

  describe("Edge cases", () => {
    it("should handle special regex characters", async () => {
      // Create file with special characters
      await fs.writeFile(
        path.join(testDir, "special.ts"),
        'const regex = /test.*pattern/;'
      );

      const result = await grep_search_ripgrep.invoke({
        pattern: "regex",
        dir_path: testDir,
        fixed_strings: false,
      });

      expect(result).toContain("regex");
    });

    it("should handle empty directory", async () => {
      const emptyDir = path.join(testDir, "empty");
      await fs.mkdir(emptyDir);

      const result = await grep_search_ripgrep.invoke({
        pattern: "anything",
        dir_path: emptyDir,
      });

      expect(result).toContain("No matches found");
    });

    it("should handle current directory default", async () => {
      // Test with default dir_path
      const result = await grep_search_ripgrep.invoke({
        pattern: "import",
      });

      // Should not error out
      expect(typeof result).toBe("string");
    });
  });
});

