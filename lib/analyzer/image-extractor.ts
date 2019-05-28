import { createReadStream } from "fs";
import { basename } from "path";
import { Readable } from "stream";
import { extract, Extract } from "tar-stream";

export { extractFiles, Extracted, DEFAULT_ENCODING };

const MANIFEST_JSON: string = "manifest.json";
const DEFAULT_ENCODING: string = "utf8";

interface Extracted {
  Manifest?: string;
  Layers?: { [key: string]: { [key: string]: Buffer } };
}

async function streamToString(stream: Readable): Promise<string> {
  const chuncks: string[] = [];
  return new Promise((resolve, reject) => {
    stream.on("end", () => {
      resolve(chuncks.join(""));
    });
    stream.on("error", reject);
    stream.on("data", (chunk) => {
      chuncks.push(chunk.toString(DEFAULT_ENCODING));
    });
  });
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chuncks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("end", () => {
      resolve(Buffer.concat(chuncks));
    });
    stream.on("error", reject);
    stream.on("data", (chunk) => {
      chuncks.push(Buffer.from(chunk));
    });
  });
}

/**
 * Extract the specified files from the associated TAR file.
 * @param imagePath path to image file saved in tar format
 * @param paths list of files paths to extract from the associated TAR file
 * @returns manifest file and files from inner layers as specified
 */
async function extractFiles(
  imagePath: string,
  paths: string[],
): Promise<Extracted> {
  return new Promise((resolve) => {
    const result: Extracted = {};
    const imageExtract: Extract = extract();
    imageExtract.on("entry", (header, stream, next) => {
      if (header.type === "file") {
        if (basename(header.name) === "layer.tar") {
          const layerExtract: Extract = extract();
          const layerName = header.name;
          layerExtract.on("entry", (header, stream, next) => {
            if (paths.includes(header.name)) {
              // initialize layers
              if (!result.Layers) {
                result.Layers = {};
              }
              // initialize specific layer
              if (!(layerName in result.Layers)) {
                result.Layers[layerName] = {};
              }
              streamToBuffer(stream).then((value) => {
                result.Layers![layerName][header.name] = value;
              });
            }
            stream.resume(); // auto drain the stream
            next(); // ready for next entry
          });
          // layerExtract.on("finish", () => {
          //   // all layer level entries read
          // });
          stream.pipe(layerExtract);
        } else if (MANIFEST_JSON === header.name) {
          streamToString(stream).then((value) => {
            result.Manifest = value;
          });
        }
      }
      stream.resume(); // auto drain the stream
      next(); // ready for next entry
    });
    imageExtract.on("finish", () => {
      // all image level entries read
      resolve(result);
    });
    createReadStream(imagePath).pipe(imageExtract);
  });
}
