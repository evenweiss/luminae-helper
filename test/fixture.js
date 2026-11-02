import { afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "luminae-fixture-"));
for (const [type, name] of [["commands", "git-push"], ["skills", "identity"]]) {
  const dir = join(root, type, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Test fixture\n---\nTest content\n`);
}
globalThis.__LUMINAE_PACKAGE_ROOT__ = root;
afterAll(() => { delete globalThis.__LUMINAE_PACKAGE_ROOT__; rmSync(root, { recursive: true, force: true }); });
