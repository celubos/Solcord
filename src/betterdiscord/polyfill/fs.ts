import type * as fs from "node:fs";
import Remote from "./remote";
import {wrapFunction} from "@common/utils/clone";


type WriteOptions = fs.WriteFileOptions & {originalFs: boolean;};
type ErrorOnlyCallback = (err: Error | null) => void;
type CallbackFunction<T extends (...args: any[]) => any, C> =
    ((...args: [...Parameters<T>, C]) => void) &
    (1 extends Parameters<T>["length"] ? (path: Parameters<T>[0], callback: C) => void : unknown);

function wrapFunctionWithCallback<
    T extends (...args: any[]) => any,
    C extends (err: Error | null, data: any) => void
>(func: T) {
    return function (...args: [...Parameters<T>, C]) {
        const params = args.slice(0, -1) as Parameters<T>;
        const callback = args[args.length - 1] as C;
        // Consumer exceptions are outside the I/O error path; never call twice.
        void Promise.resolve().then(() => func(...params)).then(
            result => {queueMicrotask(() => callback(null, result));},
            error => {queueMicrotask(() => callback(error as Error, null));}
        );
    } as CallbackFunction<T, C>;
}

export const readFileSync = wrapFunction(Remote.filesystem.readFile);
export const writeFileSync = wrapFunction(Remote.filesystem.writeFile);
export const readdirSync = wrapFunction(Remote.filesystem.readDirectory);
export const mkdirSync = wrapFunction(Remote.filesystem.createDirectory);
export const rmdirSync = wrapFunction(Remote.filesystem.deleteDirectory);
export const existsSync = wrapFunction(Remote.filesystem.exists);
export const statSync = wrapFunction(Remote.filesystem.getStats);
export const renameSync = wrapFunction(Remote.filesystem.renameSync);
export const rmSync = wrapFunction(Remote.filesystem.rmSync);
export const realpathSync = wrapFunction(Remote.filesystem.getRealPath);
export const unlinkSync = wrapFunction(Remote.filesystem.unlinkSync);
export const watch = wrapFunction(Remote.filesystem.watch);
export const createWriteStream = wrapFunction(Remote.filesystem.createWriteStream);

export const rmdir = wrapFunctionWithCallback<typeof Remote.filesystem.deleteDirectoryAsync, ErrorOnlyCallback>(Remote.filesystem.deleteDirectoryAsync);
export const rm = wrapFunctionWithCallback<typeof Remote.filesystem.rmAsync, ErrorOnlyCallback>(Remote.filesystem.rmAsync);
export const rename = wrapFunctionWithCallback<typeof Remote.filesystem.renameAsync, ErrorOnlyCallback>(Remote.filesystem.renameAsync);
export const unlink = wrapFunctionWithCallback<typeof Remote.filesystem.unlinkAsync, ErrorOnlyCallback>(Remote.filesystem.unlinkAsync);

type ReadFileCallback = (err: Error | null, contents: string | Buffer<ArrayBufferLike> | null) => void;
const readFileBridge = (...args: Parameters<typeof Remote.filesystem.readFileAsync>) => Remote.filesystem.readFileAsync(...args)
    .then(value => typeof value === "string" ? value : Buffer.from(value));
export const readFile = wrapFunctionWithCallback<typeof readFileBridge, ReadFileCallback>(readFileBridge);

type ReaddirCallback = (err: Error | null, result: string[] | Array<Buffer<ArrayBufferLike>> | null) => void;
export const readdir = wrapFunctionWithCallback<typeof Remote.filesystem.readDirectoryAsync, ReaddirCallback>(Remote.filesystem.readDirectoryAsync);

type MkdirCallback = (err: Error | null, path?: string | null) => void;
export const mkdir = wrapFunctionWithCallback<typeof Remote.filesystem.createDirectoryAsync, MkdirCallback>(Remote.filesystem.createDirectoryAsync);

type ExistsCallback = (exists: boolean) => void;
export const exists = (path: fs.PathLike, callback: ExistsCallback) => {
    void Remote.filesystem.existsAsync(path).then(value => queueMicrotask(() => callback(value)));
};

type StatCallback = (err: Error | null, stats: fs.Stats | null) => void;
export const stat = wrapFunctionWithCallback<typeof Remote.filesystem.getStatsAsync, StatCallback>(Remote.filesystem.getStatsAsync);

type RealpathCallback = (err: Error | null, resolvedPath: string | null) => void;
export const realpath = wrapFunctionWithCallback<typeof Remote.filesystem.realpathAsync, RealpathCallback>(Remote.filesystem.realpathAsync);

export const writeFile = function (path: fs.PathOrFileDescriptor, data: string | Uint8Array, options?: WriteOptions | ErrorOnlyCallback, callback?: ErrorOnlyCallback) {
    if (typeof (options) === "function") {
        callback = options;
        options = undefined;
    }

    void Remote.filesystem.writeFileAsync(path, data, options as WriteOptions).then(
        () => queueMicrotask(() => callback?.(null)),
        error => queueMicrotask(() => callback?.(error as Error))
    );
};

export const lstat = wrapFunctionWithCallback<typeof Remote.filesystem.getLinkStatsAsync, StatCallback>(Remote.filesystem.getLinkStatsAsync);
export const lstatSync = wrapFunction(Remote.filesystem.getLinkStats);

export default {
    readFile,
    exists,
    existsSync,
    lstat,
    lstatSync,
    mkdir,
    mkdirSync,
    readFileSync,
    readdir,
    readdirSync,
    realpath,
    realpathSync,
    rename,
    renameSync,
    rm,
    rmSync,
    rmdir,
    rmdirSync,
    stat,
    statSync,
    unlink,
    unlinkSync,
    watch,
    writeFile,
    writeFileSync,
    createWriteStream
};
