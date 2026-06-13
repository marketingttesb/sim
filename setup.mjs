import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;

// ─── Config ───────────────────────────────────────────────────
const APPS_ROOT = "D:\\Apps";
const OPENCODE_DIR = join(APPS_ROOT, "OpenCode");
const MEMORY_DIR = join(OPENCODE_DIR, "memory");
const MCP_DIR = join(OPENCODE_DIR, "mcp-memory");
const SKILLS_DIR = join(OPENCODE_DIR, "skills");
const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILE = join(CONFIG_DIR, "opencode.jsonc");
const SKILLS_JUNCTION = join(CONFIG_DIR, "skills");

// ─── Utils ────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function copyRecursive(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
  return true;
}

function isAdmin() {
  try {
    execSync("net session", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ─── Steps ────────────────────────────────────────────────────

function step1_setNpmPrefix() {
  console.log("\n[1/6] Setting npm prefix → D:\\Apps");
  try {
    const current = execSync("npm config get prefix", { encoding: "utf8" }).trim();
    if (current.toLowerCase() !== APPS_ROOT.toLowerCase()) {
      run(`npm config set prefix "${APPS_ROOT}"`);
      console.log("  ✓ npm prefix set to D:\\Apps");
    } else {
      console.log("  ✓ npm prefix already D:\\Apps");
    }
  } catch (e) {
    console.error("  ✗ Failed:", e.message);
  }
}

function step2_installMcpMemory() {
  console.log(`\n[2/6] Installing MCP memory server → ${MCP_DIR}`);

  mkdirSync(MCP_DIR, { recursive: true });
  mkdirSync(MEMORY_DIR, { recursive: true });

  const srcMcp = join(REPO_ROOT, "mcp-memory");
  const copied = copyRecursive(srcMcp, MCP_DIR);

  if (copied) {
    console.log("  ✓ Copied MCP memory server files");
  } else {
    console.log("  - MCP source not found in repo, skipping copy");
  }

  run("npm install", { cwd: MCP_DIR });
  console.log("  ✓ MCP memory server dependencies installed");
}

function step3_installSkills() {
  console.log("\n[3/6] Installing skills");

  mkdirSync(SKILLS_DIR, { recursive: true });

  // Copy repo-local skills (25 skills from .agents/skills)
  const repoSkills = join(REPO_ROOT, ".agents", "skills");
  if (existsSync(repoSkills)) {
    console.log("  Copying repo-local skills...");
    copyRecursive(repoSkills, SKILLS_DIR);
    console.log("  ✓ Repo skills copied");
  }

  // Install Tauri 2 skills from community
  console.log("  Installing Tauri 2 skills (39)...");
  try {
    run(`npx skills add dchuk/claude-code-tauri-skills --agent opencode -y --global`, {
      cwd: REPO_ROOT,
      env: { ...process.env, npm_config_prefix: APPS_ROOT },
    });
    console.log("  ✓ Tauri 2 skills installed");
  } catch (e) {
    console.error("  ✗ Tauri skills install failed:", e.message);
    console.log("  → Run manually: npx skills add dchuk/claude-code-tauri-skills --agent opencode -y --global");
  }
}

function step4_createConfig() {
  console.log(`\n[4/6] Creating OpenCode config → ${CONFIG_FILE}`);

  mkdirSync(CONFIG_DIR, { recursive: true });

  const templatePath = join(REPO_ROOT, "config", "opencode.jsonc");
  const template = existsSync(templatePath)
    ? readFileSync(templatePath, "utf8")
    : JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          memory: {
            type: "local",
            command: ["node", join(MCP_DIR, "server.mjs")],
            enabled: true,
          },
        },
        permission: {
          external_directory: {
            [`${OPENCODE_DIR.replace(/\\/g, "\\\\")}\\\\memory\\\\**`]: "allow",
            [`${OPENCODE_DIR.replace(/\\/g, "\\\\")}\\\\mcp-memory\\\\**`]: "allow",
            "*": "ask",
          },
        },
      }, null, 2);

  // Replace placeholders with actual paths
  let config = template;
  config = config.replace(/\$\{MCP_DIR\}/g, MCP_DIR.replace(/\\/g, "\\\\"));
  config = config.replace(/\$\{MEMORY_DIR\}/g, MEMORY_DIR.replace(/\\/g, "\\\\"));
  config = config.replace(/\$\{OPENCODE_DIR\}/g, OPENCODE_DIR.replace(/\\/g, "\\\\"));

  writeFileSync(CONFIG_FILE, config, "utf8");
  console.log("  ✓ Config created");
}

function step5_createJunction() {
  console.log(`\n[5/6] Creating skills junction`);
  console.log(`  Source: ${SKILLS_DIR}`);
  console.log(`  Target: ${CONFIG_DIR}`);

  if (!existsSync(SKILLS_DIR)) {
    console.error("  ✗ Skills directory doesn't exist yet. Run step 3 first.");
    return;
  }

  // Check if junction already exists
  try {
    const output = execSync(`fsutil reparsepoint query "${SKILLS_JUNCTION}" 2>nul`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (output.includes(SKILLS_DIR.replace(/\\/g, "\\\\"))) {
      console.log("  ✓ Junction already exists and points correctly");
      return;
    }
    // Wrong target, remove it
    execSync(`rmdir "${SKILLS_JUNCTION}"`, { stdio: "ignore" });
  } catch {
    // Doesn't exist or not a junction, that's fine
  }

  // Remove if it's a real directory
  if (existsSync(SKILLS_JUNCTION)) {
    const backup = `${SKILLS_JUNCTION}.bak`;
    console.log(`  Backing up existing dir → ${backup}`);
    renameSync(SKILLS_JUNCTION, backup);
  }

  // Admin required for junction
  if (!isAdmin()) {
    console.error("  ✗ Junction requires admin rights.");
    console.log(`  → Run as Administrator, or manually:`);
    console.log(`    fsutil reparsepoint query "${SKILLS_JUNCTION}"`);
    console.log(`    or just use mklink /J "${SKILLS_JUNCTION}" "${SKILLS_DIR}"`);
    return;
  }

  run(`cmd /c mklink /J "${SKILLS_JUNCTION}" "${SKILLS_DIR}"`);
  console.log("  ✓ Junction created");
}

function step6_verify() {
  console.log("\n[6/6] Verification");

  const checks = [
    ["MCP server", () => existsSync(join(MCP_DIR, "server.mjs"))],
    ["MCP node_modules", () => existsSync(join(MCP_DIR, "node_modules"))],
    ["Memory dir", () => existsSync(MEMORY_DIR)],
    ["Config file", () => existsSync(CONFIG_FILE)],
    ["Skills dir", () => existsSync(SKILLS_DIR)],
  ];

  let allOk = true;
  for (const [label, check] of checks) {
    const ok = check();
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) allOk = false;
  }

  if (allOk) {
    console.log("\n  ✓ All checks passed. Setup complete!");
  } else {
    console.log("\n  ⚠ Some checks failed. Review errors above.");
  }
}

// ─── Main ──────────────────────────────────────────────────────
console.log("╔═══════════════════════════════════════╗");
console.log("║   SIM — OpenCode Environment Setup    ║");
console.log("╚═══════════════════════════════════════╝");

step1_setNpmPrefix();
step2_installMcpMemory();
step3_installSkills();
step4_createConfig();
step5_createJunction();
step6_verify();

console.log("\nDone. Next step:");
console.log(`  opencode in this project:`);
console.log(`    cd ${REPO_ROOT}`);
console.log(`    opencode`);
