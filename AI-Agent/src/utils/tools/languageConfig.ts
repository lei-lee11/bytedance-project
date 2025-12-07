export interface LanguageTestConfig {
  language: string;
  extensions: string[];
  testCommands: string[];
  singleFileTestCommands: string[]; // 运行单个测试文件的命令模板，使用 {file} 占位符
  testFilePatterns: string[];
  buildCommands?: string[];
  description: string;
}

export const LANGUAGE_CONFIGS: Record<string, LanguageTestConfig> = {
  javascript: {
    language: "JavaScript/TypeScript",
    extensions: [".js", ".ts", ".jsx", ".tsx", ".mjs"],
    testCommands: [
      "npm test",
      "npm run test",
      "yarn test",
      "pnpm test",
      "npx jest",
      "npx vitest run",
      "npx mocha"
    ],
    singleFileTestCommands: [
      "npx jest {file}",
      "npx vitest run {file}",
      "npx mocha {file}",
      "npm test -- {file}",
      "yarn test {file}"
    ],
    testFilePatterns: ["*.test.js", "*.spec.js", "*.test.ts", "*.spec.ts"],
    description: "JavaScript/TypeScript 项目测试"
  },
  python: {
    language: "Python",
    extensions: [".py"],
    testCommands: [
      "python -m pytest",
      "python -m unittest discover",
      "pytest",
      "poetry run pytest",
      "pipenv run pytest"
    ],
    singleFileTestCommands: [
      "python -m unittest {file}",
      "pytest {file}",
      "python -m pytest {file}",
      "poetry run pytest {file}",
      "pipenv run pytest {file}"
    ],
    testFilePatterns: ["test_*.py", "*_test.py"],
    description: "Python 项目测试"
  },
  java: {
    language: "Java",
    extensions: [".java"],
    testCommands: [
      "mvn test",
      "mvn clean test",
      "gradle test",
      "./gradlew test"
    ],
    singleFileTestCommands: [
      "mvn test -Dtest={file}",
      "gradle test --tests {file}",
      "./gradlew test --tests {file}"
    ],
    buildCommands: ["mvn compile", "gradle build"],
    testFilePatterns: ["*Test.java", "*Tests.java"],
    description: "Java 项目测试"
  },
  go: {
    language: "Go",
    extensions: [".go"],
    testCommands: [
      "go test",
      "go test ./...",
      "go test -v",
      "go test -cover"
    ],
    singleFileTestCommands: [
      "go test {file}",
      "go test -v {file}",
      "go test -run . {file}"
    ],
    testFilePatterns: ["*_test.go"],
    description: "Go 项目测试"
  },
  rust: {
    language: "Rust",
    extensions: [".rs"],
    testCommands: [
      "cargo test",
      "cargo test --all",
      "cargo test --workspace"
    ],
    singleFileTestCommands: [
      "cargo test --test {file}",
      "cargo test {file}"
    ],
    buildCommands: ["cargo build"],
    testFilePatterns: ["tests/*.rs"],
    description: "Rust 项目测试"
  },
  csharp: {
    language: "C#",
    extensions: [".cs"],
    testCommands: [
      "dotnet test",
      "dotnet test --no-build",
      "dotnet test --verbosity normal"
    ],
    singleFileTestCommands: [
      "dotnet test --filter FullyQualifiedName~{file}",
      "dotnet test {file}"
    ],
    buildCommands: ["dotnet build"],
    testFilePatterns: ["*Tests.cs", "*Test.cs"],
    description: "C# 项目测试"
  },
  cpp: {
    language: "C++",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".h"],
    testCommands: [
      "make test",
      "ctest",
      "cmake --build build --target test",
      "./build/tests/run_tests"
    ],
    singleFileTestCommands: [
      "ctest -R {file}",
      "./build/tests/{file}"
    ],
    buildCommands: ["make", "cmake --build build"],
    testFilePatterns: ["*_test.cpp", "test_*.cpp"],
    description: "C++ 项目测试"
  },
  ruby: {
    language: "Ruby",
    extensions: [".rb"],
    testCommands: [
      "rake test",
      "rspec",
      "bundle exec rspec",
      "ruby -Itest test/*_test.rb"
    ],
    singleFileTestCommands: [
      "rspec {file}",
      "bundle exec rspec {file}",
      "ruby -Itest {file}"
    ],
    testFilePatterns: ["*_test.rb", "*_spec.rb"],
    description: "Ruby 项目测试"
  },
  php: {
    language: "PHP",
    extensions: [".php"],
    testCommands: [
      "phpunit",
      "vendor/bin/phpunit",
      "composer test",
      "php artisan test"
    ],
    singleFileTestCommands: [
      "phpunit {file}",
      "vendor/bin/phpunit {file}",
      "php artisan test {file}"
    ],
    testFilePatterns: ["*Test.php"],
    description: "PHP 项目测试"
  }
};

// 根据文件扩展名检测语言
export function detectLanguageFromExtension(extension: string): string | null {
  for (const [key, config] of Object.entries(LANGUAGE_CONFIGS)) {
    if (config.extensions.includes(extension)) {
      return key;
    }
  }
  return null;
}

// 获取所有支持的语言列表
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_CONFIGS);
}

