import { runCli } from "./cli.js";

runCli()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`aw-node: ${message}\n`);
    process.exitCode = 1;
  });
