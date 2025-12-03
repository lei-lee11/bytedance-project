/**
 * Integration test script for code search tools
 * Run with: tsx scripts/test_code_search.ts
 */

import {
  grep_search_ripgrep,
  grep_search_fallback,
} from "../src/utils/tools/code_search.js";

async function testCodeSearch() {
  console.log("=".repeat(60));
  console.log("Testing Code Search Tools Integration");
  console.log("=".repeat(60));
  console.log();

  // Test 1: Search for "import" in src directory
  console.log("Test 1: Search for 'import' statements in src/");
  console.log("-".repeat(60));
  try {
    const result1 = await grep_search_ripgrep.invoke({
      pattern: "^import",
      dir_path: "./src",
      include: "*.ts",
      max_results: 10,
    });
    console.log(result1);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 2: Search for function definitions
  console.log("Test 2: Search for function definitions");
  console.log("-".repeat(60));
  try {
    const result2 = await grep_search_ripgrep.invoke({
      pattern: "function\\s+\\w+",
      dir_path: "./src",
      max_results: 5,
    });
    console.log(result2);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 3: Search with file filter
  console.log("Test 3: Search for 'tool' in tool files");
  console.log("-".repeat(60));
  try {
    const result3 = await grep_search_ripgrep.invoke({
      pattern: "tool",
      dir_path: "./src/utils/tools",
      include: "*.ts",
      max_results: 15,
    });
    console.log(result3);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 4: Test fallback search
  console.log("Test 4: Test fallback search strategy");
  console.log("-".repeat(60));
  try {
    const result4 = await grep_search_fallback.invoke({
      pattern: "export",
      dir_path: "./src/utils/tools",
      include: "*.ts",
      max_results: 8,
    });
    console.log(result4);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 5: Search with context
  console.log("Test 5: Search with context lines");
  console.log("-".repeat(60));
  try {
    const result5 = await grep_search_ripgrep.invoke({
      pattern: "class\\s+\\w+",
      dir_path: "./src",
      context: 2,
      max_results: 5,
    });
    console.log(result5);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 6: Case-sensitive search
  console.log("Test 6: Case-sensitive search for 'Tool'");
  console.log("-".repeat(60));
  try {
    const result6 = await grep_search_ripgrep.invoke({
      pattern: "Tool",
      dir_path: "./src",
      case_sensitive: true,
      max_results: 10,
    });
    console.log(result6);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 7: Search in package.json
  console.log("Test 7: Search for dependencies in package.json");
  console.log("-".repeat(60));
  try {
    const result7 = await grep_search_ripgrep.invoke({
      pattern: "@langchain",
      dir_path: ".",
      include: "package.json",
    });
    console.log(result7);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  // Test 8: Search for TODO comments
  console.log("Test 8: Search for TODO comments");
  console.log("-".repeat(60));
  try {
    const result8 = await grep_search_ripgrep.invoke({
      pattern: "TODO|FIXME",
      dir_path: "./src",
      max_results: 10,
    });
    console.log(result8);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
  console.log();

  console.log("=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
}

// Run tests
testCodeSearch().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

