const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rootEnv = path.resolve(__dirname, "..", "..", ".env");
if (fs.existsSync(rootEnv)) {
  const lines = fs.readFileSync(rootEnv, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith("REACT_APP_")) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const cmd = process.argv[2] || "start";
const bin = require.resolve(`react-scripts/scripts/${cmd}`);
const child = spawn(process.execPath, [bin, ...process.argv.slice(3)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
