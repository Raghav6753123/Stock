import dotenv from "dotenv";
import path from "path";

let loaded = false;

export function loadServerEnvOnce() {
  if (loaded) return;

  const cwd = process.cwd();
  dotenv.config({ 
    path: [
      path.join(cwd, ".env.local"),
      path.join(cwd, ".env"),
      path.join(cwd, "app", "api", ".env.local"),
      path.join(cwd, "app", "api", ".env")
    ]
  });

  loaded = true;
}
