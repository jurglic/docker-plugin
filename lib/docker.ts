import { fileSync } from "tmp";
import { Extracted, extractFiles } from "./analyzer/image-extractor";
import { execute } from "./sub-process";

export { Docker, DockerOptions };

interface DockerOptions {
  host?: string;
  tlsVerify?: string;
  tlsCert?: string;
  tlsCaCert?: string;
  tlsKey?: string;
}

type SaveImageCallback = (err: any, name: string) => void;

class Docker {
  public static run(args: string[], options?: DockerOptions) {
    return execute("docker", [...Docker.createOptionsList(options), ...args]);
  }

  private static createOptionsList(options: any) {
    const opts: string[] = [];
    if (!options) {
      return opts;
    }
    if (options.host) {
      opts.push(`--host=${options.host}`);
    }
    if (options.tlscert) {
      opts.push(`--tlscert=${options.tlscert}`);
    }
    if (options.tlscacert) {
      opts.push(`--tlscacert=${options.tlscacert}`);
    }
    if (options.tlskey) {
      opts.push(`--tlskey=${options.tlskey}`);
    }
    if (options.tlsverify) {
      opts.push(`--tlsverify=${options.tlsverify}`);
    }
    return opts;
  }

  private optionsList: string[];

  constructor(private targetImage: string, options?: DockerOptions) {
    this.optionsList = Docker.createOptionsList(options);
  }

  public run(cmd: string, args: string[] = []) {
    return execute("docker", [
      ...this.optionsList,
      "run",
      "--rm",
      "--entrypoint",
      '""',
      "--network",
      "none",
      this.targetImage,
      cmd,
      ...args,
    ]);
  }

  public async inspect(targetImage: string) {
    return await execute("docker", [
      ...this.optionsList,
      "inspect",
      targetImage,
    ]);
  }

  public async catSafe(filename: string) {
    try {
      return await this.run("cat", [filename]);
    } catch (error) {
      const stderr: string = error.stderr;
      if (typeof stderr === "string") {
        if (
          stderr.indexOf("No such file") >= 0 ||
          stderr.indexOf("file not found") >= 0
        ) {
          return { stdout: "", stderr: "" };
        }
      }
      throw error;
    }
  }

  public async save(callback: SaveImageCallback): Promise<any> {
    const tmpobj = fileSync({
      mode: 0o644,
      prefix: "docker-",
      postfix: ".image",
      detachDescriptor: true,
    });
    let err = "";

    try {
      await execute("docker", [
        ...this.optionsList,
        "save",
        "-o",
        tmpobj.name,
        this.targetImage,
      ]);
    } catch (error) {
      const stderr: string = error.stderr;
      if (typeof stderr === "string") {
        if (stderr.indexOf("No such image") >= 0) {
          err = `No such image: ${this.targetImage}`;
        } else {
          err = error;
        }
      }
    }

    if (callback) {
      try {
        return callback(err, tmpobj.name);
      } finally {
        // We don't need the file anymore and could manually call the removeCallback
        tmpobj.removeCallback();
      }
    }
    // if we didn't pass the keep option the file will be deleted on exit
  }

  /**
   * Saves the docker image as a TAR file to a temporary location and extract
   * the specified files from it.
   * @param paths list of files paths to extract from the image
   */
  public async extract(paths: string[]): Promise<{ [key: string]: Buffer }> {
    const result: { [key: string]: Buffer } = {};
    return this.save(async (err, name) => {
      if (err) {
        throw err;
      }

      const extracted: Extracted = await extractFiles(name, paths);

      // No manifest file
      if (!extracted.Manifest) {
        return {};
      }

      const manifest = JSON.parse(extracted.Manifest);
      const layersNames = manifest[0].Layers as string[];

      if (extracted.Layers) {
        // reverse layer order from last to first
        for (const layerName of layersNames.reverse()) {
          // files found for this layer
          if (layerName in extracted.Layers) {
            // go over files found in this layer
            for (const filename of Object.keys(extracted.Layers[layerName])) {
              // file was not found in previous layer
              if (!(filename in result)) {
                result[filename] = extracted.Layers[layerName][filename];
              }
            }
          }
        }
      }

      return result;
    });
  }
}
