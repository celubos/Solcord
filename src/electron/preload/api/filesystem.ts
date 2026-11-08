import * as fs from "fs";
import {ipcRenderer} from "electron";
import * as IPCEvents from "@common/constants/ipcevents";
import {clone} from "@common/utils";
import Logger from "@common/logger";
import {wrapFunction} from "@common/utils/clone";

export const readDirectory = wrapFunction(fs.readdirSync);
export const createDirectory = wrapFunction(fs.mkdirSync);
export const deleteDirectory = wrapFunction(fs.rmdirSync);
export const exists = wrapFunction(fs.existsSync);
export const getRealPath = wrapFunction(fs.realpathSync);
export const renameSync = wrapFunction(fs.renameSync);
export const rmSync = wrapFunction(fs.rmSync);
export const unlinkSync = wrapFunction(fs.unlinkSync);
export const writeAddonFile = (kind: "plugin" | "theme", filename: string, content: string, expectedSha256?: string): Promise<void> =>
    ipcRenderer.invoke(IPCEvents.ADDON_FILE_WRITE, kind, filename, content, expectedSha256);

export function readFile(path: fs.PathOrFileDescriptor, options: Parameters<typeof fs.readFileSync>[1] = "utf-8") {
    return fs.readFileSync(path, options);
}

export function writeFile(path: fs.PathOrFileDescriptor, content: string | Uint8Array, options?: fs.WriteFileOptions & {originalFs: boolean;}) {
    if (content instanceof Uint8Array) {
        content = Buffer.from(content);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const doWriteFile = options?.originalFs ? require("original-fs").writeFileSync : fs.writeFileSync;

    return doWriteFile(path, content, options);
}

export function createWriteStream(...args: Parameters<typeof fs.createWriteStream>) {
    // @ts-expect-error this should be deprecated probably
    return clone(fs.createWriteStream(...args));
}

export function watch(path: string, options: fs.WatchOptions | BufferEncoding | null, listener: fs.WatchListener<string>) {
    const watcher = fs.watch(path, options, (event, filename) => {
        try {
            listener(event, filename!);
        }
        catch (error) {
            Logger.stacktrace("filesystem", "Failed to watch path", error as Error);
        }
    });

    return {
        close: () => {
            watcher.close();
        }
    };
}

export function getStats(path: string, options?: fs.StatSyncOptions & {bigint?: false;}) {
    const stats = fs.statSync(path, options);
    return serializeStats(stats);
}

function serializeStats(stats: fs.Stats) {
    return {
        ...stats,
        isFile: stats.isFile.bind(stats),
        isDirectory: stats.isDirectory.bind(stats),
        isSymbolicLink: stats.isSymbolicLink.bind(stats)
    };
}

export function getLinkStats(path: string, options?: fs.StatSyncOptions & {bigint?: false;}) {
    return serializeStats(fs.lstatSync(path, options));
}

// Callback APIs must not run synchronous filesystem work on the renderer thread.
export const readFileAsync = (file: fs.PathOrFileDescriptor, options: Parameters<typeof fs.readFileSync>[1] = null) =>
    new Promise<string | Buffer>((resolve, reject) => fs.readFile(file, options, (error, data) => error ? reject(error) : resolve(data)));
export const writeFileAsync = (file: fs.PathOrFileDescriptor, data: string | Uint8Array, options?: fs.WriteFileOptions & {originalFs?: boolean;}) =>
    new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const write: typeof fs.writeFile = options?.originalFs ? require("original-fs").writeFile : fs.writeFile;
        write(file, data, options ?? {}, error => error ? reject(error) : resolve());
    });
export const readDirectoryAsync = (directory: string, options?: {encoding?: BufferEncoding | null; withFileTypes?: false;} | BufferEncoding | null) => fs.promises.readdir(directory, options);
export const createDirectoryAsync = (directory: string, options?: fs.MakeDirectoryOptions | number) => fs.promises.mkdir(directory, options);
export const deleteDirectoryAsync = (directory: string, options?: fs.RmDirOptions) => fs.promises.rmdir(directory, options);
export const rmAsync = (target: string, options?: fs.RmOptions) => fs.promises.rm(target, options);
export const renameAsync = (from: string, to: string) => fs.promises.rename(from, to);
export const unlinkAsync = (target: string) => fs.promises.unlink(target);
export const existsAsync = (target: fs.PathLike) => fs.promises.access(target).then(() => true, () => false);
export const realpathAsync = (target: string) => fs.promises.realpath(target);
export const getStatsAsync = async (target: string) => serializeStats(await fs.promises.stat(target));
export const getLinkStatsAsync = async (target: string) => serializeStats(await fs.promises.lstat(target));
