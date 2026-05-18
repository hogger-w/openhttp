const { spawnSync } = require("node:child_process");
const path = require("node:path");

const appName = "OpenHTTP";
const rceditPath = path.join(__dirname, "..", "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
const iconPath = path.join(__dirname, "..", "assets", "oh.ico");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename || appName;
  const executablePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const executableName = `${productFilename}.exe`;

  const args = [
    executablePath,
    "--set-version-string",
    "FileDescription",
    appName,
    "--set-version-string",
    "ProductName",
    appName,
    "--set-version-string",
    "CompanyName",
    appName,
    "--set-version-string",
    "InternalName",
    productFilename,
    "--set-version-string",
    "OriginalFilename",
    executableName,
    "--set-file-version",
    version,
    "--set-product-version",
    version,
    "--set-icon",
    iconPath
  ];

  const result = spawnSync(rceditPath, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`rcedit exited with status ${result.status}`);
  }
};
