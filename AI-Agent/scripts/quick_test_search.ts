/**
 * Quick verification script for code search tools
 * Run with: tsx scripts/quick_test_search.ts
 */

import { grep_search_ripgrep } from "../src/utils/tools/code_search.js";

async function quickTest() {
  console.log("🔍 Quick Code Search Test\n");

  try {
    console.log("Testing search for 'import' in src/utils/tools...\n");
    
    const result = await grep_search_ripgrep.invoke({
      pattern: "import",
      dir_path: "./src/utils/tools",
      include: "*.ts",
      max_results: 5,
    });

    console.log(result);
    console.log("\n✅ Code search tool is working correctly!");
    
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    console.error("\nNote: If ripgrep is being downloaded, this may take a moment on first run.");
    process.exit(1);
  }
}

quickTest();

