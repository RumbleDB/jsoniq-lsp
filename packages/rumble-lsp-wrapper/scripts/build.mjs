import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));

const args = process.argv.slice(2);
const isProdBuild = args.includes("--prod");

execFileSync("sh", [path.join(packageDir, "scripts/fetch-rumble.sh")], {
    cwd: packageDir,
    stdio: "inherit",
});

const mvnArgs = ["-f", path.join(packageDir, "pom.xml"), "-q"];
if (isProdBuild) {
    mvnArgs.push("-Pprod");
}
mvnArgs.push("package", `-Drevision=${packageJson.version}`);

execFileSync("mvn", mvnArgs, {
    cwd: packageDir,
    stdio: "inherit",
});
