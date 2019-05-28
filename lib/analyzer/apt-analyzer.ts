import { Docker, DockerOptions } from "../docker";
import { DEFAULT_ENCODING } from "./image-extractor";
import { AnalyzerPkg } from "./types";

export { analyze };

const APT_DPKG_STATUS = "/var/lib/dpkg/status";
const APT_EXT_STATES = "/var/lib/apt/extended_states";

const APT_PKGFILES = [APT_DPKG_STATUS, APT_EXT_STATES];

export { APT_PKGFILES };

async function analyze(
  targetImage: string,
  options?: DockerOptions,
  files?: { [key: string]: Buffer },
) {
  // TODO: remove when done, backwards compatibility
  if (!files) {
    files = await new Docker(targetImage, options).extract(APT_PKGFILES);
  }

  const dpkgFile = files[APT_DPKG_STATUS];
  const pkgs = parseDpkgFile(
    dpkgFile ? dpkgFile.toString(DEFAULT_ENCODING) : "",
  );

  const extFile = parseDpkgFile[APT_EXT_STATES];
  if (extFile) {
    setAutoInstalledPackages(extFile.toString(DEFAULT_ENCODING), pkgs);
  }

  return {
    Image: targetImage,
    AnalyzeType: "Apt",
    Analysis: pkgs,
  };
}

function parseDpkgFile(text: string) {
  const pkgs: AnalyzerPkg[] = [];
  let curPkg: any = null;
  for (const line of text.split("\n")) {
    curPkg = parseDpkgLine(line, curPkg, pkgs);
  }
  return pkgs;
}

function parseDpkgLine(text: string, curPkg: AnalyzerPkg, pkgs: AnalyzerPkg[]) {
  const [key, value] = text.split(": ");
  switch (key) {
    case "Package":
      curPkg = {
        Name: value,
        Version: undefined,
        Source: undefined,
        Provides: [],
        Deps: {},
        AutoInstalled: undefined,
      };
      pkgs.push(curPkg);
      break;
    case "Version":
      curPkg.Version = value;
      break;
    case "Source":
      curPkg.Source = value.trim().split(" ")[0];
      break;
    case "Provides":
      for (let name of value.split(",")) {
        name = name.trim().split(" ")[0];
        curPkg.Provides.push(name);
      }
      break;
    case "Pre-Depends":
    case "Depends":
      for (const depElem of value.split(",")) {
        for (let name of depElem.split("|")) {
          name = name.trim().split(" ")[0];
          curPkg.Deps[name] = true;
        }
      }
      break;
  }
  return curPkg;
}

function setAutoInstalledPackages(text: string, pkgs: AnalyzerPkg[]) {
  const autoPkgs = parseExtFile(text);
  for (const pkg of pkgs) {
    if (autoPkgs[pkg.Name]) {
      pkg.AutoInstalled = true;
    }
  }
}

interface PkgMap {
  [name: string]: boolean;
}

function parseExtFile(text: string) {
  const pkgMap: PkgMap = {};
  let curPkgName: any = null;
  for (const line of text.split("\n")) {
    curPkgName = parseExtLine(line, curPkgName, pkgMap);
  }
  return pkgMap;
}

function parseExtLine(text: string, curPkgName: string, pkgMap: PkgMap) {
  const [key, value] = text.split(": ");
  switch (key) {
    case "Package":
      curPkgName = value;
      break;
    case "Auto-Installed":
      if (parseInt(value, 10) === 1) {
        pkgMap[curPkgName] = true;
      }
      break;
  }
  return curPkgName;
}
