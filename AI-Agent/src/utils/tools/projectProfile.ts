import { LANGUAGE_CONFIGS } from "./languageConfig.ts";
import { detectProjectLanguage, findAvailableTestCommand } from "./testRunner.ts";
import type { ProjectProfile } from "../../agent/state.ts";

export async function buildProjectProfile(cwd: string): Promise<ProjectProfile> {
  const languages = await detectProjectLanguage(cwd);
  const detectedLanguages = languages;

  let primary: ProjectProfile["primaryLanguage"] = "Other";
  if (languages.includes("typescript")) primary = "TypeScript";
  else if (languages.includes("javascript")) primary = "JavaScript";
  else if (languages.includes("python")) primary = "Python";

  const langForTest = languages.find((lang) => LANGUAGE_CONFIGS[lang]);
  let testCommand: string | null = null;
  let testFrameworkHint: string | undefined;

  if (langForTest) {
    testCommand = await findAvailableTestCommand(langForTest, cwd);
    const cfg = LANGUAGE_CONFIGS[langForTest];
    if (cfg) {
      if (cfg.testCommands.some((c) => c.includes("pytest"))) {
        testFrameworkHint = "pytest";
      } else if (cfg.testCommands.some((c) => c.includes("vitest"))) {
        testFrameworkHint = "Vitest";
      } else if (cfg.testCommands.some((c) => c.includes("jest"))) {
        testFrameworkHint = "Jest";
      }
    }
  }

  return {
    detectedLanguages,
    primaryLanguage: primary,
    testCommand: testCommand ?? undefined,
    testFrameworkHint,
  };
}

export default buildProjectProfile;
