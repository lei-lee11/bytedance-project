/**
 * Code search tools using ripgrep and fallback strategies
 * Reference: gemini-cli's ripGrep.ts and grep.ts implementation
 */

import * as z from "zod";
import { tool } from "@langchain/core/tools";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import { EOL } from "os";
import { downloadRipGrep } from "@joshua.litt/get-ripgrep";
import { glob } from "glob";

// ========== Constants ==========

const DEFAULT_TOTAL_MAX_MATCHES = 200;
const COMMON_DIRECTORY_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.cache/**",
  "**/coverage/**",
];

// ========== Helper Functions ==========

/**
 * Get global bin directory for storing ripgrep
 */
function getGlobalBinDir(): string {
  const homeDir = os.homedir();
  const tempDir = homeDir
    ? path.join(homeDir, ".ai-agent", "tmp", "bin")
    : path.join(os.tmpdir(), "ai-agent-bin");
  return tempDir;
}

/**
 * Get ripgrep candidate filenames based on platform
 */
function getRgCandidateFilenames(): readonly string[] {
  return process.platform === "win32" ? ["rg.exe", "rg"] : ["rg"];
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve existing ripgrep path if already installed
 */
async function resolveExistingRgPath(): Promise<string | null> {
  const binDir = getGlobalBinDir();
  for (const fileName of getRgCandidateFilenames()) {
    const candidatePath = path.join(binDir, fileName);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

let ripgrepAcquisitionPromise: Promise<string | null> | null = null;

/**
 * Ensure ripgrep is available, download if needed
 */
async function ensureRipgrepAvailable(): Promise<string | null> {
  const existingPath = await resolveExistingRgPath();
  if (existingPath) {
    return existingPath;
  }
  if (!ripgrepAcquisitionPromise) {
    ripgrepAcquisitionPromise = (async () => {
      try {
        const binDir = getGlobalBinDir();
        // Ensure directory exists
        await fs.mkdir(binDir, { recursive: true });
        await downloadRipGrep(binDir);
        return await resolveExistingRgPath();
      } catch (error) {
        console.error("Failed to download ripgrep:", error);
        return null;
      } finally {
        ripgrepAcquisitionPromise = null;
      }
    })();
  }
  return ripgrepAcquisitionPromise;
}

/**
 * Get ripgrep path, throw if not available
 */
async function ensureRgPath(): Promise<string> {
  const downloadedPath = await ensureRipgrepAvailable();
  if (downloadedPath) {
    return downloadedPath;
  }
  throw new Error("Cannot use ripgrep.");
}

/**
 * Check if a command is available in system PATH
 */
function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checkCommand = process.platform === "win32" ? "where" : "command";
    const checkArgs =
      process.platform === "win32" ? [command] : ["-v", command];
    try {
      const child = spawn(checkCommand, checkArgs, {
        stdio: "ignore",
        shell: true,
      });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Check if a directory is within a git repository
 */
function isGitRepository(directory: string): boolean {
  try {
    let currentDir = path.resolve(directory);
    let reachedRoot = false;

    while (!reachedRoot) {
      const gitDir = path.join(currentDir, ".git");

      // Check if .git exists
      if (fsSync.existsSync(gitDir)) {
        return true;
      }

      const parentDir = path.dirname(currentDir);

      // Reached root directory
      if (parentDir === currentDir) {
        reachedRoot = true;
      } else {
        currentDir = parentDir;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validate and resolve path
 */
async function resolveAndValidatePath(
  relativePath?: string
): Promise<string | null> {
  if (!relativePath) {
    return null;
  }

  const targetPath = path.resolve(relativePath);

  // Check existence and type
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error(`Path is not a valid directory or file: ${targetPath}`);
    }
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    throw new Error(`Failed to access path: ${targetPath}`);
  }

  return targetPath;
}

// ========== Search Match Interface ==========

interface SearchMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

// ========== Ripgrep Tool Implementation ==========

/**
 * Parse ripgrep JSON output
 */
function parseRipgrepJsonOutput(
  output: string,
  basePath: string
): SearchMatch[] {
  const results: SearchMatch[] = [];
  if (!output) return results;

  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const json = JSON.parse(line);
      if (json.type === "match") {
        const match = json.data;
        // Defensive check: ensure text properties exist
        if (match.path?.text && match.lines?.text) {
          const absoluteFilePath = path.resolve(basePath, match.path.text);
          const relativeFilePath = path.relative(basePath, absoluteFilePath);

          results.push({
            filePath: relativeFilePath || path.basename(absoluteFilePath),
            lineNumber: match.line_number,
            line: match.lines.text.trimEnd(),
          });
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  }
  return results;
}

/**
 * Perform ripgrep search
 */
async function performRipgrepSearch(options: {
  pattern: string;
  searchPath: string;
  include?: string;
  caseSensitive?: boolean;
  fixedStrings?: boolean;
  context?: number;
  after?: number;
  before?: number;
  noIgnore?: boolean;
  maxResults: number;
}): Promise<SearchMatch[]> {
  const {
    pattern,
    searchPath,
    include,
    caseSensitive,
    fixedStrings,
    context,
    after,
    before,
    noIgnore,
  } = options;

  const rgArgs = ["--json"];

  if (!caseSensitive) {
    rgArgs.push("--ignore-case");
  }

  if (fixedStrings) {
    rgArgs.push("--fixed-strings");
    rgArgs.push(pattern);
  } else {
    rgArgs.push("--regexp", pattern);
  }

  if (context) {
    rgArgs.push("--context", context.toString());
  }
  if (after) {
    rgArgs.push("--after-context", after.toString());
  }
  if (before) {
    rgArgs.push("--before-context", before.toString());
  }
  if (noIgnore) {
    rgArgs.push("--no-ignore");
  }

  if (include) {
    rgArgs.push("--glob", include);
  }

  if (!noIgnore) {
    // Exclude common directories
    COMMON_DIRECTORY_EXCLUDES.forEach((exclude) => {
      rgArgs.push("--glob", `!${exclude}`);
    });
    // Exclude log and tmp files
    rgArgs.push("--glob", "!*.log");
    rgArgs.push("--glob", "!*.tmp");
  }

  rgArgs.push("--threads", "4");
  rgArgs.push(searchPath);

  try {
    const rgPath = await ensureRgPath();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(rgPath, rgArgs, {
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

      child.on("error", (err) => {
        reject(
          new Error(
            `Failed to start ripgrep: ${err.message}. Please ensure ripgrep is properly installed.`
          )
        );
      });

      child.on("close", (code) => {
        const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
        const stderrData = Buffer.concat(stderrChunks).toString("utf8");

        if (code === 0) {
          resolve(stdoutData);
        } else if (code === 1) {
          resolve(""); // No matches found
        } else {
          reject(new Error(`ripgrep exited with code ${code}: ${stderrData}`));
        }
      });
    });

    return parseRipgrepJsonOutput(output, searchPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Ripgrep search failed: ${message}`);
    throw error;
  }
}

/**
 * Format search results
 */
function formatSearchResults(
  matches: SearchMatch[],
  pattern: string,
  dirPath: string,
  include?: string,
  wasTruncated?: boolean,
  maxResults?: number
): string {
  if (matches.length === 0) {
    return `No matches found for pattern "${pattern}" in path "${dirPath}"${
      include ? ` (filter: "${include}")` : ""
    }.`;
  }

  // Group by file
  const matchesByFile = matches.reduce(
    (acc, match) => {
      const fileKey = match.filePath;
      if (!acc[fileKey]) {
        acc[fileKey] = [];
      }
      acc[fileKey].push(match);
      acc[fileKey].sort((a, b) => a.lineNumber - b.lineNumber);
      return acc;
    },
    {} as Record<string, SearchMatch[]>
  );

  const matchCount = matches.length;
  const matchTerm = matchCount === 1 ? "match" : "matches";

  let llmContent = `Found ${matchCount} ${matchTerm} for pattern "${pattern}" in path "${dirPath}"${
    include ? ` (filter: "${include}")` : ""
  }`;

  if (wasTruncated) {
    llmContent += ` (results limited to ${maxResults} matches for performance)`;
  }

  llmContent += `:\n---\n`;

  for (const filePath in matchesByFile) {
    llmContent += `File: ${filePath}\n`;
    matchesByFile[filePath].forEach((match) => {
      const trimmedLine = match.line.trim();
      llmContent += `L${match.lineNumber}: ${trimmedLine}\n`;
    });
    llmContent += "---\n";
  }

  return llmContent.trim();
}

// ========== Fallback Search Implementation ==========

/**
 * Parse grep output (format: filePath:lineNumber:content)
 */
function parseGrepOutput(output: string, basePath: string): SearchMatch[] {
  const results: SearchMatch[] = [];
  if (!output) return results;

  const lines = output.split(EOL);

  for (const line of lines) {
    if (!line.trim()) continue;

    // Find first and second colon
    const firstColonIndex = line.indexOf(":");
    if (firstColonIndex === -1) continue;

    const secondColonIndex = line.indexOf(":", firstColonIndex + 1);
    if (secondColonIndex === -1) continue;

    const filePathRaw = line.substring(0, firstColonIndex);
    const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
    const lineContent = line.substring(secondColonIndex + 1);

    const lineNumber = parseInt(lineNumberStr, 10);

    if (!isNaN(lineNumber)) {
      const absoluteFilePath = path.resolve(basePath, filePathRaw);
      const relativeFilePath = path.relative(basePath, absoluteFilePath);

      results.push({
        filePath: relativeFilePath || path.basename(absoluteFilePath),
        lineNumber,
        line: lineContent,
      });
    }
  }
  return results;
}

/**
 * Search using git grep
 */
async function searchWithGitGrep(
  pattern: string,
  searchPath: string,
  include?: string
): Promise<SearchMatch[]> {
  const gitArgs = [
    "grep",
    "--untracked",
    "-n",
    "-E",
    "--ignore-case",
    pattern,
  ];

  if (include) {
    gitArgs.push("--", include);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("git", gitArgs, {
      cwd: searchPath,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) =>
      reject(new Error(`Failed to start git grep: ${err.message}`))
    );
    child.on("close", (code) => {
      const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
      const stderrData = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) resolve(parseGrepOutput(stdoutData, searchPath));
      else if (code === 1) resolve([]); // No matches
      else reject(new Error(`git grep exited with code ${code}: ${stderrData}`));
    });
  });
}

/**
 * Search using system grep
 */
async function searchWithSystemGrep(
  pattern: string,
  searchPath: string,
  include?: string
): Promise<SearchMatch[]> {
  const grepArgs = ["-r", "-n", "-H", "-E", "-I", "--ignore-case"];

  // Exclude directories
  COMMON_DIRECTORY_EXCLUDES.forEach((exclude) => {
    const dirName = exclude
      .replace(/\*\*\//g, "")
      .replace(/\/\*\*$/g, "")
      .replace(/\//g, "");
    if (dirName && !dirName.includes("*")) {
      grepArgs.push(`--exclude-dir=${dirName}`);
    }
  });

  if (include) {
    grepArgs.push(`--include=${include}`);
  }

  grepArgs.push(pattern);
  grepArgs.push(".");

  return new Promise((resolve, reject) => {
    const child = spawn("grep", grepArgs, {
      cwd: searchPath,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.on("error", (err) =>
      reject(new Error(`Failed to start system grep: ${err.message}`))
    );
    child.on("close", (code) => {
      const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
      if (code === 0 || code === 1) {
        resolve(parseGrepOutput(stdoutData, searchPath));
      } else {
        reject(new Error("System grep failed"));
      }
    });
  });
}

/**
 * Search using Node.js (pure JavaScript fallback)
 */
async function searchWithNodeJs(
  pattern: string,
  searchPath: string,
  maxResults: number,
  include?: string
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];

  // Build glob pattern - use relative pattern with cwd option
  const globPattern = include ? `**/${include}` : "**/*";

  // Get file list - use cwd option instead of including searchPath in pattern
  const files = await glob(globPattern, {
    cwd: searchPath,
    ignore: COMMON_DIRECTORY_EXCLUDES,
    nodir: true,
    absolute: true, // Return absolute paths
  });

  // Search each file
  for (const file of files) {
    if (matches.length >= maxResults) break;

    try {
      const content = await fs.readFile(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (matches.length >= maxResults) return;

        // Create new regex instance for each line to avoid lastIndex issue
        // Use case-insensitive flag only (no global flag)
        const lineRegex = new RegExp(pattern, "i");
        if (lineRegex.test(line)) {
          matches.push({
            filePath: path.relative(searchPath, file),
            lineNumber: index + 1,
            line: line.trim(),
          });
        }
      });
    } catch {
      // Ignore read errors
    }
  }

  return matches;
}

// ========== Tool Definitions ==========

/**
 * Ripgrep-based search tool (primary)
 */
const grep_search_ripgrep = tool(
  async ({
    pattern,
    dir_path = ".",
    include,
    case_sensitive = false,
    fixed_strings = false,
    context,
    after,
    before,
    no_ignore = false,
    max_results = DEFAULT_TOTAL_MAX_MATCHES,
  }) => {
    try {
      const searchPath = (await resolveAndValidatePath(dir_path)) || process.cwd();

      const matches = await performRipgrepSearch({
        pattern,
        searchPath,
        include,
        caseSensitive: case_sensitive,
        fixedStrings: fixed_strings,
        context,
        after,
        before,
        noIgnore: no_ignore,
        maxResults: max_results,
      });

      const limitedMatches =
        matches.length > max_results
          ? matches.slice(0, max_results)
          : matches;

      return formatSearchResults(
        limitedMatches,
        pattern,
        dir_path,
        include,
        matches.length > max_results,
        max_results
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `❌ Search failed: ${message}`;
    }
  },
  {
    name: "grep_search_ripgrep",
    description:
      "FAST, high-performance code search powered by ripgrep. " +
      "Automatically downloads ripgrep if not available. " +
      "Supports regex patterns, file filtering, case sensitivity, and context lines. " +
      "Best for searching large codebases. Use this as the primary search tool.",
    schema: z.object({
      pattern: z
        .string()
        .describe(
          "Regular expression pattern to search for. Use \\b for word boundaries."
        ),
      dir_path: z
        .string()
        .optional()
        .default(".")
        .describe("Directory to search (default: current directory)"),
      include: z
        .string()
        .optional()
        .describe("Glob pattern to filter files (e.g., '*.ts', '*.{js,jsx}')"),
      case_sensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Case-sensitive search (default: false)"),
      fixed_strings: z
        .boolean()
        .optional()
        .default(false)
        .describe("Treat pattern as literal string (default: false)"),
      context: z
        .number()
        .optional()
        .describe("Number of context lines around matches"),
      after: z.number().optional().describe("Number of lines after matches"),
      before: z.number().optional().describe("Number of lines before matches"),
      no_ignore: z
        .boolean()
        .optional()
        .default(false)
        .describe("Search all files including ignored ones (default: false)"),
      max_results: z
        .number()
        .optional()
        .default(DEFAULT_TOTAL_MAX_MATCHES)
        .describe("Maximum number of results to return"),
    }),
  }
);

/**
 * Fallback search tool with multiple strategies
 */
const grep_search_fallback = tool(
  async ({ pattern, dir_path = ".", include, max_results = 200 }) => {
    try {
      const searchPath = (await resolveAndValidatePath(dir_path)) || process.cwd();

      let matches: SearchMatch[] = [];
      let strategy = "unknown";

      // Strategy 1: git grep
      const isGit = isGitRepository(searchPath);
      const gitAvailable = isGit && (await isCommandAvailable("git"));

      if (gitAvailable) {
        try {
          strategy = "git grep";
          matches = await searchWithGitGrep(pattern, searchPath, include);
        } catch (error) {
          console.error("git grep failed, trying next strategy");
        }
      }

      // Strategy 2: system grep
      if (matches.length === 0 && (await isCommandAvailable("grep"))) {
        try {
          strategy = "system grep";
          matches = await searchWithSystemGrep(pattern, searchPath, include);
        } catch (error) {
          console.error("system grep failed, trying next strategy");
        }
      }

      // Strategy 3: Node.js fallback
      if (matches.length === 0 || strategy === "unknown") {
        strategy = "nodejs";
        matches = await searchWithNodeJs(
          pattern,
          searchPath,
          max_results,
          include
        );
      }

      const limitedMatches =
        matches.length > max_results ? matches.slice(0, max_results) : matches;

      let result = formatSearchResults(
        limitedMatches,
        pattern,
        dir_path,
        include,
        matches.length > max_results,
        max_results
      );

      result += `\n\n(Strategy used: ${strategy})`;

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `❌ Search failed: ${message}`;
    }
  },
  {
    name: "grep_search_fallback",
    description:
      "Code search with automatic fallback strategies (git grep → system grep → Node.js). " +
      "Use when ripgrep is not available or as a backup search method. " +
      "Supports basic regex patterns and file filtering.",
    schema: z.object({
      pattern: z.string().describe("Regular expression pattern to search for"),
      dir_path: z
        .string()
        .optional()
        .default(".")
        .describe("Directory to search (default: current directory)"),
      include: z
        .string()
        .optional()
        .describe("Glob pattern to filter files (e.g., '*.ts')"),
      max_results: z
        .number()
        .optional()
        .default(200)
        .describe("Maximum number of results"),
    }),
  }
);

// ========== Exports ==========

export const codeSearchTools = [grep_search_ripgrep, grep_search_fallback];
export { grep_search_ripgrep, grep_search_fallback };

