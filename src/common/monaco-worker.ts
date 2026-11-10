// SPDX-License-Identifier: Apache-2.0

const workers = new Set<Worker>();
const releases = new Set<() => void>();

/** Workers bootstrap solely from packaged Monaco assets, with no remote URL. */
export function createLocalMonacoWorker(_workerId: string, label: string): Worker {
    const code = "self.MonacoEnvironment = {baseUrl: 'solcord://editor/monaco'}; importScripts('solcord://editor/monaco/vs/base/worker/workerMain.js');";
    const url = URL.createObjectURL(new Blob([code], {type: "text/javascript"}));
    let released = false;
    let worker: Worker;
    const release = () => {
        if (released) return;
        released = true;
        clearTimeout(deadline);
        URL.revokeObjectURL(url);
        worker?.removeEventListener("message", release);
        worker?.removeEventListener("error", release);
        releases.delete(release);
    };
    const deadline = setTimeout(release, 10_000);
    releases.add(release);
    try {worker = new Worker(url, {type: "classic", name: label});}
    catch (error) {release(); throw error;}
    workers.add(worker);
    worker.addEventListener("message", release, {once: true});
    worker.addEventListener("error", release, {once: true});
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {release(); workers.delete(worker); terminate();};
    return worker;
}

window.addEventListener("beforeunload", () => {
    for (const worker of workers) worker.terminate();
    for (const release of releases) release();
});
